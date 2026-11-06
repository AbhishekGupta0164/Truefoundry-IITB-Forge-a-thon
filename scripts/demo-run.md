# Forge-Agent Rehearsal Script (Tasks A, B, C)

## Pre-flight Checklist
1. TrueForge running at `http://localhost:8790`.
2. Flask repository pinned at commit `22d92470` in `../flask`.
3. VS Code Extension Development Host launched (<kbd>F5</kbd>) with `../flask` open as workspace.
4. MCP server active on `127.0.0.1:8765`.

---

## Task A: Inline Edit with Context
- **Target**: `demo/app.py` or `src/flask/app.py`.
- **Action**: Highlight function definition, press `Cmd+Alt+K`.
- **Prompt**: `"Add rate limiting header validation and update docstring"`.
- **Expected Flow**:
  1. Input box captures prompt and selection.
  2. MCP `search_text` finds related usages.
  3. `propose_edit` calculates unified diff.
  4. CodeLens appears with `[Accept]` and `[Reject]`.
  5. User accepts; file updates via `apply_patch_hunk`.

---

## Task B: Multi-file Feature Implementation
- **Target**: Add custom CLI command to Flask CLI.
- **Prompt**: `"Add --profile option to the flask run command, updating docs and tests"`.
- **Expected Flow**:
  1. Searches implementation, tests, and documentation.
  2. Generates 3 separate hunks across 3 files.
  3. Context meter shows budget usage within limits.
  4. User reviews hunks in side-by-side diff.
  5. `post-accept` verification runs `pytest`.

---

## Task C: Rollback & Cancellation
- **Prompt**: Propose edit, view staged hunks.
- **Action**: Click `Forge: Undo Whole Task` or `Forge: Cancel Run`.
- **Expected Flow**:
  1. Staged unapproved hunks discarded immediately.
  2. Inverse edits applied for already-committed hunks.
  3. Git tree verified completely clean (`git status`).
