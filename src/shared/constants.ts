/**
 * Global constants and configuration defaults for Forge-Agent
 */

export const MCP_CONSTANTS = {
  DEFAULT_PORT: 8765,
  HOST: '127.0.0.1',
  PROTOCOL_VERSION: '2024-11-05',
  SERVER_NAME: 'trueforge-mcp'
} as const;

export const DEFAULT_BUDGET_LIMITS = {
  MAX_TOKENS: 100_000,
  MAX_COST_USD: 2.00,
  MAX_ITERATIONS: 30,
  MAX_PATCH_HUNKS: 50,
  MAX_CONTEXT_ENTRIES: 100
} as const;

export const SECURITY_ALLOWLIST = {
  ALLOWED_COMMANDS: ['python -m pytest', 'npm test', 'git diff', 'git status'],
  ALLOWED_HOST: '127.0.0.1'
} as const;
