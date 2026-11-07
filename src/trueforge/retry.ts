import { BadCredentialError, ModelUnreachableError, RateLimitedError } from '../shared/errors';

export interface RetryPolicy {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 5000,
  backoffFactor: 2
};

export function classifyError(error: unknown, statusCode?: number): Error {
  if (statusCode === 401 || statusCode === 403) {
    return new BadCredentialError();
  }
  if (statusCode === 429) {
    return new RateLimitedError();
  }
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || statusCode === 502 || statusCode === 503) {
    return new ModelUnreachableError(`TrueForge daemon connection failed: ${msg}`);
  }
  return error instanceof Error ? error : new Error(msg);
}

export function isRetryable(err: Error): boolean {
  if (err instanceof BadCredentialError) {
    return false;
  }
  if (err instanceof RateLimitedError || err instanceof ModelUnreachableError) {
    return true;
  }
  return false;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY
): Promise<T> {
  let attempt = 0;
  let delay = policy.initialDelayMs;

  while (attempt <= policy.maxRetries) {
    try {
      return await fn();
    } catch (err) {
      const classified = classifyError(err);
      attempt++;
      if (attempt > policy.maxRetries || !isRetryable(classified)) {
        throw classified;
      }
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * policy.backoffFactor, policy.maxDelayMs);
    }
  }

  throw new ModelUnreachableError('Max retries exceeded');
}
