# Context Module (`src/context/`)

**Module Owner**: Member 2 (M2)

## 1. Module Purpose
Manages retrieval budget accounting, context mapping, explicit `@file`/`@symbol` mention parsing, and codebase repo-map generation. It prevents context window bloat and guarantees searches stay within token and cost limits.

## 2. Files Owned by Module
- `budget.ts`: Per-turn and per-task counters tracking line reads, hits, tokens, and cost against `DEFAULT_BUDGET_LIMITS`.
- `map.ts`: Audit record of real search and read operations (file path, line range, rationale, skipped entries).
- `mentions.ts`: Parses explicit user context mentions (`@file:path/to/file`, `@symbol:FunctionName`) into verified context snippets.
- `symbol-index.ts`: Executes `scripts/symbols.py` and maintains an in-memory symbol cache keyed by file `mtime`.
- `repo-map.ts`: Generates a compact structural overview of signatures and classes (~1–2K tokens).

## 3. Expected Inputs & Outputs
- **Inputs**: Workspace files, search queries, user prompt tokens, file read requests.
- **Outputs**: Ordered, budget-validated context entries (`ContextEntry[]`) and budget state updates (`BudgetState`).

## 4. Shared Contracts Used
- `src/shared/types.ts`: `ContextEntry`, `BudgetState`.
- `src/shared/constants.ts`: `DEFAULT_BUDGET_LIMITS`.
- `src/shared/errors.ts`: `BudgetReachedError`.

## 5. Dependencies on Other Modules
- **Depends on**: `src/shared/`.
- **Depended by**: `src/mcp/` (consults budget before executing read/search tools), `src/ui/` (renders context map).

## 6. Testing Requirements
- Unit tests under `test/unit/`:
  - `budget.test.ts`: Verify 31st search hit or 201st line read triggers budget cap.
  - `mentions.test.ts`: Parsing valid and invalid `@file` / `@symbol` mentions.

## 7. Module Completion Criteria
1. Rejects queries that exceed maximum limits without unhandled crashes.
2. Generates repo-map under 2,000 tokens for the Flask codebase.
3. Accurate token & cost bookkeeping.
