import { describe, expect, it, vi } from 'vitest';
import { withRetry, classifyError, isRetryable } from '../../src/trueforge/retry';
import { BadCredentialError, ModelUnreachableError, RateLimitedError, SessionCancelledError } from '../../src/shared/errors';

describe('trueforge/retry', () => {
  it('classifies HTTP status codes accurately', () => {
    expect(classifyError(new Error('fail'), 401)).toBeInstanceOf(BadCredentialError);
    expect(classifyError(new Error('fail'), 403)).toBeInstanceOf(BadCredentialError);
    expect(classifyError(new Error('fail'), 429)).toBeInstanceOf(RateLimitedError);
    expect(classifyError(new Error('ECONNREFUSED'))).toBeInstanceOf(ModelUnreachableError);
  });

  it('identifies retryable vs permanent errors', () => {
    expect(isRetryable(new BadCredentialError())).toBe(false);
    expect(isRetryable(new SessionCancelledError())).toBe(false);
    expect(isRetryable(new ModelUnreachableError())).toBe(true);
    expect(isRetryable(new RateLimitedError())).toBe(true);
  });

  it('performs exponential backoff across 3 retries', async () => {
    let callCount = 0;
    const delays: number[] = [];

    const result = await withRetry(
      async () => {
        callCount++;
        if (callCount <= 3) {
          throw new Error('temporary connection reset: fetch failed');
        }
        return 'recovered';
      },
      {
        policy: { maxRetries: 3, initialDelayMs: 15, backoffFactor: 2 },
        onRetry: (_attempt, delay) => delays.push(delay)
      }
    );

    expect(result).toBe('recovered');
    expect(callCount).toBe(4);
    expect(delays).toEqual([15, 30, 60]);
  });

  it('stops immediately when AbortSignal aborts during retry wait', async () => {
    const controller = new AbortController();

    const slowOp = vi.fn().mockImplementation(async () => {
      throw new Error('fetch failed');
    });

    const promise = withRetry(slowOp, {
      policy: { maxRetries: 3, initialDelayMs: 200 },
      signal: controller.signal
    });

    setTimeout(() => {
      controller.abort();
    }, 50);

    await expect(promise).rejects.toThrow(SessionCancelledError);
  });
});
