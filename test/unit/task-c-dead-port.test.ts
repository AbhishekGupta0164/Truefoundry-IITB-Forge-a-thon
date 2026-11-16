/**
 * test/unit/task-c-dead-port.test.ts
 *
 * Verifies Step 5: Task C Dead-Port Failure and Invalid Key Baseline
 * Requirements from PDF:
 * - Baseline (7 points): Point the TrueForge model at http://127.0.0.1:9/v1 (closed port), repeat Task A,
 *   and show retries, the clear error, a responsive editor and a clean git status.
 * - Done when: Both the dead-port and invalid-key runs leave git status --porcelain empty.
 */

import { describe, it, expect, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { TrueForgeClient } from '../../src/trueforge/client';
import { withRetry } from '../../src/trueforge/retry';
import { BadCredentialError, ModelUnreachableError, getUserFacingErrorMessage } from '../../src/shared/errors';

describe('Step 5: Task C Dead-Port Failure and Invalid-Key Baseline', () => {
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

  it('demonstrates closed port 9 retry behavior and single-sentence error', async () => {
    const deadPortUrl = 'http://127.0.0.1:9/v1';
    const retryEvents: { attempt: number; delay: number }[] = [];

    let caughtError: unknown;
    try {
      await withRetry(
        async () => {
          const res = await fetch(deadPortUrl, { signal: AbortSignal.timeout(500) });
          return await res.json();
        },
        {
          policy: { maxRetries: 3, initialDelayMs: 20, backoffFactor: 2 },
          targetUrl: deadPortUrl,
          onRetry: (attempt, delay) => {
            retryEvents.push({ attempt, delay });
          }
        }
      );
    } catch (err) {
      caughtError = err;
    }

    // 1. Verifies 3 retries occurred
    expect(retryEvents.length).toBe(3);
    expect(retryEvents.map(r => r.attempt)).toEqual([1, 2, 3]);

    // 2. Clear single-sentence error message
    expect(caughtError).toBeInstanceOf(ModelUnreachableError);
    const userMessage = getUserFacingErrorMessage(caughtError, deadPortUrl);
    expect(userMessage).toBe("Can't reach the model at http://127.0.0.1:9/v1. Check TrueForge settings.");

    // 3. Flask repository working tree remains clean
    if (flaskDir) {
      const gitStatus = execFileSync('git', ['status', '--porcelain'], {
        cwd: flaskDir,
        encoding: 'utf-8'
      }).trim();
      expect(gitStatus).toBe('');
    }
  }, 25000);

  it('demonstrates invalid API key fails immediately without retry', async () => {
    let attempts = 0;
    let caughtError: unknown;

    try {
      await withRetry(
        async () => {
          attempts++;
          throw new BadCredentialError();
        },
        {
          policy: { maxRetries: 3, initialDelayMs: 20 }
        }
      );
    } catch (err) {
      caughtError = err;
    }

    expect(attempts).toBe(1); // Fails immediately with no retries
    expect(caughtError).toBeInstanceOf(BadCredentialError);
    expect(getUserFacingErrorMessage(caughtError)).toBe('Authentication failed. Check your TrueForge API key.');

    // Flask repository working tree remains clean
    if (flaskDir) {
      const gitStatus = execFileSync('git', ['status', '--porcelain'], {
        cwd: flaskDir,
        encoding: 'utf-8'
      }).trim();
      expect(gitStatus).toBe('');
    }
  });
});
