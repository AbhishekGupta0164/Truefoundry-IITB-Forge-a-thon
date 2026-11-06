# Agent Invariants

- Never write to disk except inside apply_patch_hunk (`src/mcp/tools/apply_patch_hunk.ts`).
- Never call a model provider from this repo. Only the TrueForge SDK/HTTP API.
- MCP server binds to 127.0.0.1 on the fixed port only. Never a random port.
- All paths workspace-relative; reject .. and symlink escapes; deny .env/.git/key files.
- run_terminal_command takes an argv array and an exact allowlist. No shell strings.
- Never commit keys, tokens, or SecretStorage values.
- Shared types live in src/shared; change them only via a PR all three review.
- Every module ships with unit tests. Run npm run typecheck && npm run lint && npm run test:unit.
