# Review Module (`src/review/`)

**Module Owner**: Member 3 (Review Engine & UI), wired with Member 1 (Approvals).

## 1. Module Purpose
Provides the human-in-the-loop review, validation, diff presentation, and undo layer for agent patch proposals:
- Intercepts proposed patches and hunks (`propose_patch`, `propose_edit`).
- Stages changes in memory without modifying working copy or disk.
- Automatically opens native VS Code side-by-side diffs (`vscode.diff`) using custom virtual schemes (`forge-original:` and `forge-proposed:`).
- Displays per-hunk CodeLens actions (`Accept` and `Reject`) with stable unique hunk IDs.
- Detects stale documents/hunks using document version numbers, content hashing, and disk modification timestamps.
- Records fine-grained `InverseEdit` objects to enable reliable whole-task undo (`forge.undoTask`) without destructive whole-file snapshots.
- Coordinates status bar item display showing `Agent-modified files: N` based on distinct files modified by agent edits.
- Integrates with TrueForge approval pause/resume (`tool.approval_required` and `user.tool_approval`) ensuring human decisions accurately resume agent execution.

## 2. Architecture & Files
- `manager.ts`: Core `ReviewManager` tracking proposed patches, hunk review states (`pending`, `accepted`, `rejected`, `stale`, `applied`, `failed`), target files, document versions, original content, applied edits, and status bar updates.
- `diff-view.ts`: Implements `ForgeDiffContentProvider` for `forge-original:` and `forge-proposed:` URI schemes and `openDiffEditor(patch)` to launch native diffs immediately.
- `codelens.ts`: `HunkCodeLensProvider` rendering individual status, Accept (`forge.acceptHunk`), and Reject (`forge.rejectHunk`) CodeLens actions above each hunk.
- `undo.ts`: `UndoManager` implementing fine-grained inverse-edit rollback with conflict detection (no whole-file snapshots) and whole-task reversal.
- `store.ts`: In-memory storage for proposed patches and hunk decisions.
- `validate.ts`: Post-patch syntax verification running AST checks and phantom-symbol detection (invokes Python AST validator).
- `apply.ts`: Applies accepted hunks via `vscode.workspace.applyEdit` (or atomic disk write fallback) and records inverse edits.
- `cancel.ts`: Handles turn cancellation, discards unapplied hunks, and clears pending approvals.

## 3. Review Workflow
1. **Agent Proposes Patch**: When the agent calls `propose_patch` or `propose_edit`, hunks are generated and registered with `ReviewManager.stagePatch()`. Memory holds the proposed state; `git status` remains completely clean.
2. **Native Diff Opens Immediately**: `diff-view.ts` calls `vscode.commands.executeCommand('vscode.diff', originalUri, proposedUri, title)` so reviewers immediately see what changed.
3. **Per-Hunk CodeLens Actions**:
   - `[Accept]`: Applies only that specific hunk using `vscode.WorkspaceEdit`. Recomputes the proposed virtual document, updates status bar modified file count, and records inverse edit.
   - `[Reject]`: Marks the hunk rejected with zero disk writes. The diff view updates to exclude the rejected hunk.
4. **Stale Hunk Detection**: If the target document or file on disk was modified after the patch was proposed, `ReviewManager.checkStale()` marks the hunk as `stale` and prevents application with reason:
   `"Hunk denied because the file changed after the patch was proposed."`
5. **Whole-Task Undo**: `forge.undoTask` retrieves all recorded `InverseEdit` objects for the task and applies them in reverse order. If external modifications conflict with the hunk region, conflicts are detected and reported.
6. **Status Bar Coordination**: `Agent-modified files: N` reflects the exact number of distinct files on disk that contain accepted agent changes.

## 4. TrueForge SDK Approval Pause & Resume Wiring
When `apply_patch_hunk` requires manual approval, the TrueForge agent engine pauses execution:
- **Pause Event**: `tool.approval_required` containing `toolCalls: [{ id, sourceEventId }]`.
- **Approval Matching (`ApprovalMatcher`)**: Connects `toolCall.arguments.patch_id` and `hunk_id` to the staged review state.
- **Resume Payload Shape**:
  ```json
  {
    "input": [
      {
        "type": "user.tool_approval",
        "toolCallId": "call_123",
        "approval": {
          "status": "allow"
        }
      },
      {
        "type": "user.tool_approval",
        "toolCallId": "call_456",
        "approval": {
          "status": "deny",
          "reason": "Hunk denied because the file changed after the patch was proposed."
        }
      }
    ]
  }
  ```
- **SDK Invariant**: Resume turns contain *only* `user.tool_approval` events. Never mix `user.message` and `user.tool_approval` in the same turn stream input.
- **Cancellation**: `client.sessions.cancel(sessionId)` cancels running turns, clears pending approvals, and emits `turn.done` with `status: "cancelled"`.

## 5. S3 Approval Spike Results
Documented in `docs/spikes/s3-report.md`:
- Verified MCP server `127.0.0.1:8765` exposes `apply_patch_hunk`.
- Tested approval pause with `requireApprovalForTools: ["apply_patch_hunk"]`.
- Verified programmatic multi-hunk resume: `h1` allowed (applied to fixture), `h2` denied (not applied).
- Confirmed git diff in `test/fixtures/mini-repo` reflects only `h1`.
- Verified `sessions.cancel()` immediately aborts execution and abandons pending approvals.

## 6. Verification & Test Suite
- `test/unit/stage3-review-engine.test.ts`: 28 unit tests covering all Stage 3 requirements.
- `test/e2e/stage3-e2e.test.ts`: End-to-end verification covering Tests A through E.
- Run tests:
  ```bash
  npm run typecheck
  npm run lint
  npm run test:unit
  npm run build
  ```
