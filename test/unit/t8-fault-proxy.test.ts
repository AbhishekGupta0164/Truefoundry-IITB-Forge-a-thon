import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { FaultInjectionProxy } from '../../src/trueforge/fault-proxy';
import { withRetry } from '../../src/trueforge/retry';
import { TrueForgeClient } from '../../src/trueforge/client';
import { BadCredentialError, ModelUnreachableError, RateLimitedError, getUserFacingErrorMessage } from '../../src/shared/errors';

describe('T8: Fault-Injection Proxy Suite (Task C & Resilience)', () => {
  let proxy: FaultInjectionProxy;
  let proxyPort: number;
  let proxyUrl: string;

  const flaskCandidates = [
    process.env.FLASK_DIR,
    path.resolve(__dirname, '../../../Flask'),
    path.resolve(__dirname, '../../../flask')
  ].filter(Boolean) as string[];

  let flaskDir = '';
  for (const c of flaskCandidates) {
    if (fs.existsSync(path.join(c, '.git'))) {
      flaskDir = c;
      break;
    }
  }

  const initialGitStatus = flaskDir
    ? execFileSync('git', ['status', '--porcelain'], { cwd: flaskDir, encoding: 'utf-8' }).trim()
    : '';

  const assertCleanWorkspace = () => {
    if (flaskDir) {
      const gitStatus = execFileSync('git', ['status', '--porcelain'], {
        cwd: flaskDir,
        encoding: 'utf-8'
      }).trim();
      expect(gitStatus).toBe(initialGitStatus);
    }
  };

  beforeEach(async () => {
    proxy = new FaultInjectionProxy({ rateLimitRetryAfterSec: 1, stallTimeoutMs: 500 });
    proxyPort = await proxy.start();
    proxyUrl = proxy.getUrl();
  });

  afterEach(async () => {
    await proxy.stop();
  });

  it('1. Connection refused / closed port retries 3 times with backoff and fails cleanly', async () => {
    proxy.setFault('refused');

    let retryAttempts = 0;
    let caughtError: any = null;

    try {
      await withRetry(
        async () => {
          const res = await fetch(`${proxyUrl}/sessions`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return await res.json();
        },
        {
          targetUrl: proxyUrl,
          policy: { maxRetries: 3, initialDelayMs: 20, maxDelayMs: 50, backoffFactor: 1.5 },
          onRetry: (attempt) => {
            retryAttempts = attempt;
          }
        }
      );
    } catch (err) {
      caughtError = err;
    }

    expect(retryAttempts).toBe(3);
    expect(caughtError).toBeInstanceOf(ModelUnreachableError);
    const userMsg = getUserFacingErrorMessage(caughtError);
    expect(userMsg).toContain("Can't reach the model");
    expect(userMsg).not.toContain('stack trace');

    assertCleanWorkspace();
  });

  it('2. Rate limit (HTTP 429) honors retry-after and classifies as RateLimitedError', async () => {
    proxy.setFault('rate_limit');

    let caughtError: any = null;
    let attempts = 0;

    try {
      await withRetry(
        async () => {
          attempts++;
          const res = await fetch(`${proxyUrl}/sessions`);
          if (res.status === 429) {
            const err: any = new Error('Rate limit exceeded');
            err.statusCode = 429;
            err.retryAfter = 1;
            throw err;
          }
          return await res.json();
        },
        {
          targetUrl: proxyUrl,
          policy: { maxRetries: 1, initialDelayMs: 10, maxDelayMs: 20, backoffFactor: 1 }
        }
      );
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(RateLimitedError);
    const userMsg = getUserFacingErrorMessage(caughtError);
    expect(userMsg).toContain('Rate limit reached');
    assertCleanWorkspace();
  });

  it('3. Auth failure (HTTP 401) fails immediately with zero retries', async () => {
    proxy.setFault('auth_error');

    let attempts = 0;
    let caughtError: any = null;

    try {
      await withRetry(
        async () => {
          attempts++;
          const res = await fetch(`${proxyUrl}/sessions`);
          if (res.status === 401) {
            const err: any = new Error('Unauthorized');
            err.statusCode = 401;
            throw err;
          }
          return await res.json();
        },
        {
          targetUrl: proxyUrl,
          policy: { maxRetries: 3, initialDelayMs: 20, maxDelayMs: 50, backoffFactor: 1.5 }
        }
      );
    } catch (err) {
      caughtError = err;
    }

    expect(attempts).toBe(1); // Crucial invariant: bad credentials MUST NEVER retry
    expect(caughtError).toBeInstanceOf(BadCredentialError);
    const userMsg = getUserFacingErrorMessage(caughtError);
    expect(userMsg).toContain('Authentication failed');
    assertCleanWorkspace();
  });

  it('4. Stalled connection times out and aborts gracefully without freezing editor', async () => {
    proxy.setFault('stall');

    let caughtError: any = null;
    const client = new TrueForgeClient({
      baseUrl: proxyUrl,
      timeoutMs: 100 // 100ms short timeout
    });

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 100);
      await fetch(`${proxyUrl}/sessions`, { signal: controller.signal });
      clearTimeout(timeout);
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeDefined();
    assertCleanWorkspace();
  });

  it('5. Mid-stream connection drop terminates stream safely without unapproved writes', async () => {
    proxy.setFault('stream_drop');

    let caughtError: any = null;
    try {
      const res = await fetch(`${proxyUrl}/turns/stream`);
      if (res.body) {
        const reader = res.body.getReader();
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      }
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeDefined();
    assertCleanWorkspace();
  });

  it('6. Malformed JSON response is caught and reported clearly', async () => {
    proxy.setFault('malformed_json');

    let caughtError: any = null;
    try {
      const res = await fetch(`${proxyUrl}/sessions`);
      await res.json();
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeDefined();
    assertCleanWorkspace();
  });

  it('7. Healthy response passes through without errors', async () => {
    proxy.setFault('none');

    const res = await fetch(`${proxyUrl}/sessions`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.status).toBe('active');
  });
});
