/**
 * Global constants and configuration defaults for Forge-Agent
 */

export const MCP_CONSTANTS = {
  DEFAULT_PORT: 8765,
  HOST: '127.0.0.1',
  PROTOCOL_VERSION: '2024-11-05',
  SERVER_NAME: 'forge-workspace'
} as const;

/**
 * Stage 0/1 Visible Retrieved Context Budget (B1 Anchor):
 * Strictly enforced in src/context/budget.ts per task run.
 */
export const RETRIEVED_CONTEXT_BUDGET = {
  MAX_TOKENS: 12_000,
  MAX_FILES: 8,
  MAX_SEARCH_HITS: 30,
  MAX_LINES_PER_READ: 200
} as const;

/**
 * Hard safety caps to prevent runaway execution / spending.
 */
export const TOTAL_RUN_SAFETY_CAP = {
  MAX_TOKENS: 100_000,
  MAX_COST_USD: 2.00,
  MAX_ITERATIONS: 30
} as const;

export const DEFAULT_BUDGET_LIMITS = {
  ...RETRIEVED_CONTEXT_BUDGET,
  ...TOTAL_RUN_SAFETY_CAP
} as const;

export const SECURITY_ALLOWLIST = {
  ALLOWED_COMMANDS: [
    'pytest',
    'python -m pytest',
    'npm test',
    'git diff',
    'git status'
  ],
  ALLOWED_HOST: '127.0.0.1'
} as const;
