/**
 * Standardized error classes for TrueForge and Forge-Agent
 */

export class ForgeBaseError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ModelUnreachableError extends ForgeBaseError {
  constructor(public readonly url = 'http://localhost:8790', message?: string) {
    super(
      message ?? `Can't reach the model at ${url}. Check TrueForge settings.`,
      'MODEL_UNREACHABLE'
    );
  }
}

export class BadCredentialError extends ForgeBaseError {
  constructor(message = 'Authentication failed. Check your TrueForge API key.') {
    super(message, 'BAD_CREDENTIAL');
  }
}

export class RateLimitedError extends ForgeBaseError {
  constructor(
    public readonly retryAfterSeconds?: number,
    message?: string
  ) {
    const text = retryAfterSeconds
      ? `Rate limit reached. Please retry after ${retryAfterSeconds}s.`
      : 'Rate limit reached. Please retry after the indicated delay.';
    super(message ?? text, 'RATE_LIMITED');
  }
}

export class BudgetReachedError extends ForgeBaseError {
  constructor(message = 'Execution budget limit reached (token, file, or search cap exceeded).') {
    super(message, 'BUDGET_REACHED');
  }
}

export class StaleHunkError extends ForgeBaseError {
  constructor(hunkId: string, message?: string) {
    super(
      message ?? `Hunk denied because the file changed after the patch was proposed. (${hunkId})`,
      'STALE_HUNK'
    );
  }
}

export class LoopGuardError extends ForgeBaseError {
  constructor(
    public readonly reason: 'max_calls' | 'repeated_call',
    public readonly toolName?: string,
    message?: string
  ) {
    const defaultMsg =
      reason === 'repeated_call'
        ? `Agent execution stopped: tool call '${toolName ?? 'unknown'}' repeated 3 times in a row.`
        : 'Agent execution stopped: exceeded maximum safety cap of 20 tool calls.';
    super(message ?? defaultMsg, 'LOOP_GUARD_TRIGGERED');
  }
}

export class SessionCancelledError extends ForgeBaseError {
  constructor(message = 'Session was cancelled by user.') {
    super(message, 'SESSION_CANCELLED');
  }
}

/**
 * Returns a clean, single-sentence user-facing error message.
 * Never leaks stack traces, sensitive file paths, or credentials.
 */
export function getUserFacingErrorMessage(error: unknown, fallbackUrl = 'http://localhost:8790'): string {
  if (error instanceof ModelUnreachableError) {
    return `Can't reach the model at ${error.url || fallbackUrl}. Check TrueForge settings.`;
  }
  if (error instanceof BadCredentialError) {
    return 'Authentication failed. Check your TrueForge API key.';
  }
  if (error instanceof RateLimitedError) {
    return error.retryAfterSeconds
      ? `Rate limit reached. Please retry after ${error.retryAfterSeconds}s.`
      : 'Rate limit reached. Please retry after the indicated delay.';
  }
  if (error instanceof LoopGuardError) {
    return error.message;
  }
  if (error instanceof SessionCancelledError) {
    return 'Session was cancelled by user.';
  }
  if (error instanceof BudgetReachedError) {
    return 'Execution budget limit reached. No further context or files will be loaded.';
  }
  if (error instanceof StaleHunkError) {
    return error.message;
  }

  const rawMsg = error instanceof Error ? error.message : String(error);
  if (rawMsg.includes('ECONNREFUSED') || rawMsg.includes('ENOTFOUND') || rawMsg.includes('fetch failed')) {
    return `Can't reach the model at ${fallbackUrl}. Check TrueForge settings.`;
  }
  if (rawMsg.includes('401') || rawMsg.includes('403') || rawMsg.toLowerCase().includes('unauthorized')) {
    return 'Authentication failed. Check your TrueForge API key.';
  }
  if (rawMsg.includes('429')) {
    return 'Rate limit reached. Please retry after the indicated delay.';
  }

  // Sanitize any potential stack trace or multiline text down to first sentence
  const firstLine = rawMsg.split('\n')[0].replace(/^Error:\s*/, '').trim();
  return firstLine.endsWith('.') ? firstLine : `${firstLine}.`;
}

