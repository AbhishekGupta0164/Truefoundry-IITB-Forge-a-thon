# MCP Module (`src/mcp/`)

**Module Owner**: Member 2 (M2)

## 1. Module Purpose
Hosts the local Model Context Protocol (MCP) server over SSE/HTTP on `127.0.0.1:8765`. It exposes workspace tools to TrueForge, enforcing workspace confinement, access authorization, and safe hunk-based file modification.

## 2. Files Owned by Module
- `server.ts`: Streamable HTTP server binding strictly to `127.0.0.1:8765`.
- `auth.ts`: Bearer token validation using tokens stored in VS Code `SecretStorage`.
- `workspace.ts`: Safe path resolution enforcing `${workspaceFolder}` boundaries, denying `..`, symlinks, `.env`, `.git`, and secret files.
- `registry.ts`: MCP tool registry and definition provider with approval annotations.
- `sanitize.ts`: Output truncation and wrapping for untrusted tool results.
- `tools/search_text.ts`: Search workspace files (≤30 hits, requiring reason).
- `tools/search_symbols.ts`: Symbol extraction calling `scripts/symbols.py`.
- `tools/read_file.ts`: Read workspace file (≤200 lines, requiring reason).
- `tools/find_related.ts`: Discovers corresponding tests and documentation.
- `tools/propose_patch.ts`: Validates and stages unified diff in memory without disk writes.
- `tools/propose_edit.ts`: Translates `{old_str, new_str}` replacements into hunks.
- `tools/apply_patch_hunk.ts`: The ONLY disk-writing tool; performs atomic WorkspaceEdit after version check.
- `tools/run_terminal_command.ts`: Executes commands matching the exact allowlist (no raw shell strings).

## 3. Expected Inputs & Outputs
- **Inputs**: MCP RPC JSON requests with tool names and arguments from TrueForge.
- **Outputs**: Formatted, sanitized JSON MCP tool results conforming to MCP schema.

## 4. Shared Contracts Used
- `src/shared/types.ts`: `Patch`, `Hunk`, `ToolResult`.
- `src/shared/constants.ts`: `MCP_CONSTANTS`, `SECURITY_ALLOWLIST`.
- `src/shared/errors.ts`: `StaleHunkError`.
- `src/shared/validation.ts`: `isPathSafe`, `isCommandAllowed`, `validateHunk`.

## 5. Dependencies on Other Modules
- **Depends on**: `src/shared/`, `src/context/` (for budget recording).
- **Depended by**: `src/extension.ts` (starts/stops MCP server).

## 6. Testing Requirements
- Unit tests under `test/unit/`:
  - `workspace.test.ts`: Verify `..`, symlink escapes, and secret files are rejected.
  - `terminal-allowlist.test.ts`: Verify non-allowlisted shell commands are rejected.
  - `propose-patch.test.ts`: Verify staging in memory without writing to disk.
- Integration tests under `test/mcp/server.test.ts`.

## 7. Module Completion Criteria
1. MCP server binds strictly to `127.0.0.1:8765`.
2. Reject unauthenticated requests with HTTP 401.
3. No file writes outside `apply_patch_hunk.ts`.
4. Zero path escapes permitted.
