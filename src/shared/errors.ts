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
  constructor(message = 'TrueForge model backend is unreachable') {
    super(message, 'MODEL_UNREACHABLE');
  }
}

export class BadCredentialError extends ForgeBaseError {
  constructor(message = 'Invalid or missing authentication credentials') {
    super(message, 'BAD_CREDENTIAL');
  }
}

export class RateLimitedError extends ForgeBaseError {
  constructor(message = 'Model request rate limit exceeded. Please back off.') {
    super(message, 'RATE_LIMITED');
  }
}

export class BudgetReachedError extends ForgeBaseError {
  constructor(message = 'Execution budget limit (tokens/cost/iterations) reached') {
    super(message, 'BUDGET_REACHED');
  }
}

export class StaleHunkError extends ForgeBaseError {
  constructor(hunkId: string, message = `Hunk ${hunkId} cannot be applied: target content is stale or modified`) {
    super(message, 'STALE_HUNK');
  }
}
