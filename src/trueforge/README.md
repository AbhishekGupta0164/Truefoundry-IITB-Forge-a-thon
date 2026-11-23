# TrueForge Module (`src/trueforge/`)

**Module Owner**: Member 1 (M1)

## 1. Module Purpose
The TrueForge module is the single, isolated gateway responsible for all network interactions with the local TrueForge daemon (`http://localhost:8790`). It manages streaming sessions, Server-Sent Events (SSE) ingestion, model turns, cancellation, reconnection, and approval resumes.

## 2. Files Owned by Module
- `client.ts`: TrueForge session lifecycle management (create session, post turn, send cancellation).
- `stream.ts`: SSE / async iterator consumer that translates raw TrueForge event payloads into normalized internal events (`shared/events.ts`).
- `approvals.ts`: Matches pending tool calls awaiting approval to staged hunks and constructs approval resume payloads.
- `session-state.ts`: Persists active session ID, turn ID, and last event sequence in VS Code `workspaceState`.
- `reconnect.ts`: Automatic session reconnection and sequence replay logic.
- `retry.ts`: Exponential backoff with jitter and error classification (differentiating dead ports, bad credentials, and 429 rate limits).
- `config.ts`: Configuration provider reading TrueForge base URL and options from VS Code settings.

## 3. Expected Inputs & Outputs
- **Inputs**: User prompts, selected code context, hunk approval/rejection decisions (`HunkDecision`).
- **Outputs**: Strongly typed stream of `ForgeEvent` (`token`, `tool_call`, `tool_result`, `approval`, `error`, `done`).

## 4. Shared Contracts Used
- `src/shared/types.ts`: `HunkDecision`, `BudgetState`, `ToolResult`.
- `src/shared/events.ts`: `ForgeEvent`, `TokenEvent`, `ToolCallEvent`, `ApprovalEvent`, `ErrorEvent`, `DoneEvent`.
- `src/shared/constants.ts`: `MCP_CONSTANTS`, `DEFAULT_BUDGET_LIMITS`.
- `src/shared/errors.ts`: `ModelUnreachableError`, `BadCredentialError`, `RateLimitedError`, `BudgetReachedError`.

## 5. Dependencies on Other Modules
- **Depends on**: `src/shared/` only.
- **Depended by**: `src/ui/` (subscribes to stream events), `src/review/` (sends approval outcomes).

## 6. Testing Requirements
- Unit tests under `test/unit/` using `vitest`:
  - `retry.test.ts`: Retry on connection drops, immediate failure on `BadCredentialError`.
  - `stage3-review-engine.test.ts` and `sdk-event-mapping.test.ts`: Approval matching, SDK payload shape, and paused-turn resume behavior.
- SDK event and approval tests use `test/helpers/trueforge-sdk-mock.ts`; these verify request/event contracts and are not live daemon evidence.

## 7. Module Completion Criteria
1. Reconnects seamlessly after a transient network drop.
2. Emits 0 direct external API calls (strictly talks to local TrueForge).
3. 100% test pass rate for retry and approval payload generators.
