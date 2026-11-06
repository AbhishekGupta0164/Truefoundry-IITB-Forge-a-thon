import { describe, expect, it } from 'vitest';
import { MCP_CONSTANTS, DEFAULT_BUDGET_LIMITS } from '../../src/shared/constants';
import { ModelUnreachableError, BudgetReachedError } from '../../src/shared/errors';

describe('Forge foundation', () => {
  it('runs the unit test framework', () => {
    expect(true).toBe(true);
  });

  it('provides valid MCP constants', () => {
    expect(MCP_CONSTANTS.HOST).toBe('127.0.0.1');
    expect(MCP_CONSTANTS.DEFAULT_PORT).toBe(8765);
  });

  it('defines realistic default budget limits', () => {
    expect(DEFAULT_BUDGET_LIMITS.MAX_TOKENS).toBeGreaterThan(0);
    expect(DEFAULT_BUDGET_LIMITS.MAX_COST_USD).toBeGreaterThan(0);
  });

  it('instantiates custom errors correctly with error codes', () => {
    const err = new ModelUnreachableError();
    expect(err.code).toBe('MODEL_UNREACHABLE');
    expect(err.name).toBe('ModelUnreachableError');

    const budgetErr = new BudgetReachedError();
    expect(budgetErr.code).toBe('BUDGET_REACHED');
  });
});
