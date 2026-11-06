# Review Module (`src/review/`)

**Module Owner**: Member 3 (M3)

## 1. Module Purpose
Provides the human-in-the-loop review, validation, and undo layer. It intercepts proposed hunks, presents native diffs with CodeLens accept/reject actions, validates post-patch syntax, serializes file writes, and maintains inverse edits to enable whole-task and per-hunk undos.

## 2. Files Owned by Module
- `store.ts`: In-memory and persisted storage for proposed patches, hunks, decisions, document version numbers, and inverse edits.
- `validate.ts`: Post-patch verification running AST checks and phantom-symbol detection (invokes `scripts/check_py.py`).
- `diff-view.ts`: Opens VS Code's native side-by-side diff editor and renders inline hunk decorations.
- `codelens.ts`: Registers CodeLens providers rendering `Accept` and `Reject` buttons directly above staged hunks.
- `apply.ts`: Serializes file mutations, verifies document version to avoid race conditions, and writes inverse edits.
- `undo.ts`: Implements per-hunk reversal and `forge.undoTask` (reverting all applied changes from the task).
- `cancel.ts`: Discards unapproved staged patches, cancels active turns, and reports applied vs abandoned hunks.

## 3. Expected Inputs & Outputs
- **Inputs**: Staged patches (`Patch`), user review actions (Accept, Reject, Undo, Cancel).
- **Outputs**: Document edits committed via VS Code API, `HunkDecision` events emitted to TrueForge, rollback diffs.

## 4. Shared Contracts Used
- `src/shared/types.ts`: `Patch`, `Hunk`, `HunkDecision`.
- `src/shared/events.ts`: `ApprovalEvent`.
- `src/shared/errors.ts`: `StaleHunkError`.

## 5. Dependencies on Other Modules
- **Depends on**: `src/shared/`.
- **Depended by**: `src/ui/` (triggers review UI), `src/mcp/tools/apply_patch_hunk.ts` (delegates to `store.ts` and `apply.ts`).

## 6. Testing Requirements
- Unit tests under `test/unit/`:
  - `stale-hunk.test.ts`: Detects modified file versions and rejects stale hunks.
  - `propose-edit.test.ts`: Hunk generation and inverse edit calculation.
- E2E tests under `test/e2e/`:
  - `review-flow.test.ts`: Accept hunk 1, reject hunk 2, trigger undo.
  - `cancel.test.ts`: Cancellation leaves clean working tree.

## 7. Module Completion Criteria
1. No unreviewed patch is applied to disk.
2. Full task rollback (`forge.undoTask`) returns workspace to exact initial state.
3. Stale documents reject hunks cleanly without file corruption.
