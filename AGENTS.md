# Agent Invariants

- Never write a model-proposed change until the matching hunk is approved. Hunk writes go through `executeApplyPatchHunk` (`src/mcp/tools/apply_patch_hunk.ts`), whether approval resumes a TrueForge tool call or comes from the explicit CodeLens Accept action. Whole-task Undo is permitted only as the user's explicit reversal action.
- Never call a model provider from this repo. Only the TrueForge SDK/HTTP API.
- MCP server binds to 127.0.0.1 on the fixed port only. Never a random port.
- All paths workspace-relative; reject .. and symlink escapes; deny .env/.git/key files.
- run_terminal_command takes an argv array and an exact allowlist. No shell strings.
- Never commit keys, tokens, or SecretStorage values.
- Shared types live in src/shared; change them only via a PR all three review.
- Every module ships with unit tests. Run npm run typecheck && npm run lint && npm run test:unit.
