import { BadCredentialError, ModelUnreachableError, RateLimitedError, SessionCancelledError } from '../shared/errors';

export interface RetryPolicy {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffFactor: 2
};

export interface RetryOptions {
  policy?: Partial<RetryPolicy>;
  signal?: AbortSignal;
  onRetry?: (attempt: number, delayMs: number, error: Error) => void;
  targetUrl?: string;
}

export function classifyError(error: unknown, statusCode?: number, targetUrl = 'http://localhost:8790'): Error {
  if (error instanceof BadCredentialError || error instanceof RateLimitedError || error instanceof ModelUnreachableError || error instanceof SessionCancelledError) {
    return error;
  }

  if (statusCode === 401 || statusCode === 403) {
    return new BadCredentialError();
  }
  if (statusCode === 429) {
    let retryAfter: number | undefined;
    if (error && typeof error === 'object' && 'retryAfter' in error) {
      retryAfter = Number((error as any).retryAfter);
    }
    return new RateLimitedError(retryAfter);
  }

  const msg = error instanceof Error ? error.message : String(error);
  const lowerMsg = msg.toLowerCase();

  if (
    lowerMsg.includes('unauthorized') ||
    lowerMsg.includes('forbidden') ||
    lowerMsg.includes('invalid api key') ||
    lowerMsg.includes('bad credentials')
  ) {
    return new BadCredentialError();
  }

  if (lowerMsg.includes('rate limit') || lowerMsg.includes('429')) {
    return new RateLimitedError();
  }

  if (
    msg.includes('ECONNREFUSED') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('fetch failed') ||
    statusCode === 502 ||
    statusCode === 503 ||
    statusCode === 504
  ) {
    return new ModelUnreachableError(targetUrl, `Can't reach the model at ${targetUrl}. Check TrueForge settings.`);
  }

  return error instanceof Error ? error : new Error(msg);
}

export function isRetryable(err: Error): boolean {
  if (err instanceof BadCredentialError || err instanceof SessionCancelledError) {
    return false;
  }
  if (err instanceof RateLimitedError || err instanceof ModelUnreachableError) {
    return true;
  }
  const msg = err.message.toLowerCase();
  if (msg.includes('econnrefused') || msg.includes('fetch failed') || msg.includes('timeout')) {
    return true;
  }
  return false;
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  optionsOrPolicy: RetryOptions | RetryPolicy = DEFAULT_RETRY_POLICY
): Promise<T> {
  const options: RetryOptions =
    'maxRetries' in optionsOrPolicy
      ? { policy: optionsOrPolicy }
      : optionsOrPolicy;

  const policy: RetryPolicy = {
    ...DEFAULT_RETRY_POLICY,
    ...(options.policy ?? {})
  };

  let attempt = 0;
  let delay = policy.initialDelayMs;

  while (attempt <= policy.maxRetries) {
    if (options.signal?.aborted) {
      throw new SessionCancelledError();
    }

    try {
      return await fn(attempt);
    } catch (err) {
      const classified = classifyError(err, undefined, options.targetUrl);
      attempt++;

      if (attempt > policy.maxRetries || !isRetryable(classified)) {
        throw classified;
      }

      if (options.signal?.aborted) {
        throw new SessionCancelledError();
      }

      // If RateLimitedError provides a retryAfter duration, honor that duration
      let currentDelay = delay;
      if (classified instanceof RateLimitedError && classified.retryAfterSeconds) {
        currentDelay = classified.retryAfterSeconds * 1000;
      }

      if (options.onRetry) {
        options.onRetry(attempt, currentDelay, classified);
      }

      // Wait with cancellation check
      await new Promise<void>((resolve, reject) => {
        let timer: NodeJS.Timeout | null = null;
        const onAbort = () => {
          if (timer) clearTimeout(timer);
          reject(new SessionCancelledError());
        };

        if (options.signal) {
          options.signal.addEventListener('abort', onAbort, { once: true });
        }

        timer = setTimeout(() => {
          if (options.signal) {
            options.signal.removeEventListener('abort', onAbort);
          }
          resolve();
        }, currentDelay);
      });

      delay = Math.min(delay * policy.backoffFactor, policy.maxDelayMs);
    }
  }

  throw new ModelUnreachableError(options.targetUrl ?? 'http://localhost:8790');
}

