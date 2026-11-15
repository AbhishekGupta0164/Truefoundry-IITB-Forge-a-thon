# MCP Module (`src/mcp/`)

## 1. Architecture Overview
The Forge MCP module hosts a local Model Context Protocol (MCP) server that exposes workspace tools, inspection capabilities, and safe patch staging to AI agents (e.g. TrueForge or Claude Desktop / MCP Inspector).

```
                      +-----------------------------+
                      |       TrueForge / Client    |
                      +-----------------------------+
                                     |  HTTP POST / GET
                                     |  Bearer <token>
                                     v
                      +-----------------------------+
                      | MCPServerManager (server.ts)|
                      |    127.0.0.1:8765/mcp       |
                      +-----------------------------+
                                     |
               +---------------------+---------------------+
               |                     |                     |
               v                     v                     v
      +-----------------+   +-----------------+   +-----------------+
      |  Auth Layer     |   |  Streamable HTTP|   | Tool Registry   |
      |  (auth.ts)      |   |  Transport      |   | (registry.ts)   |
      +-----------------+   +-----------------+   +-----------------+
                                                           |
               +-------------------------------------------+
               |
               v
      +-------------------------------------------------------------+
      | Tools: search_text, search_symbols, read_file, find_related,|
      | propose_patch, propose_edit, apply_patch_hunk, run_cmd, ping|
      +-------------------------------------------------------------+
               |                                           |
               v                                           v
      +-----------------+                         +-----------------+
      | WorkspaceManager|                         |  Context Budget |
      | (Confinement)   |                         |  Tracker        |
      +-----------------+                         +-----------------+
```

## 2. Server Startup and Lifecycle
- **Host & Port**: Binds strictly to `127.0.0.1:8765` (never `0.0.0.0`).
- **Endpoint**: `/mcp` (Streamable HTTP transport, conforming to protocol version `2024-11-05`).
- **Startup**: Triggered during VS Code extension activation in `src/extension.ts` via `MCPServerManager.start({ port })`.
- **Shutdown**: Gracefully stops the HTTP server, closes open sessions, and cleans up transports during extension deactivation in `deactivate()`.
- **Duplicate Prevention**: `MCPServerManager` maintains a singleton runtime state; duplicate start requests return the active server info without port collision.

## 3. Authentication & Bearer Tokens
- **Mechanism**: All MCP HTTP requests must supply an `Authorization: Bearer <token>` header (or `?token=<token>` query parameter).
- **Storage**: The bearer token is generated as a cryptographically secure 256-bit random hex string (`crypto.randomBytes(32).toString('hex')`) and persisted in VS Code's `SecretStorage`.
- **Validation**: Token comparisons use constant-time `crypto.timingSafeEqual` in `src/mcp/auth.ts`.
- **Rejection**: Any unauthenticated or invalid request is answered with HTTP 401 Unauthorized (`WWW-Authenticate: Bearer error="invalid_token"`).
- **Token Privacy**: Tokens are never logged to console, disk, or error messages.

## 4. Workspace Confinement & Security
Every file operation is resolved and verified by `WorkspaceManager.resolveSafePath`:
- **Directory Traversal**: Rejects `..`, relative traversal attempts, and null bytes.
- **Absolute Paths**: Rejects paths outside the workspace root and Windows drive letters pointing outside.
- **UNC Paths**: Explicitly blocks `\\` network shares.
- **Symlink Escapes**: Verifies real paths via `fs.realpathSync`. Escaping symlinks are rejected.
- **Parent Directory Escapes**: For nonexistent target paths, walks parent directories to detect symlinked parent directories escaping the workspace boundary.
- **Blocked Files**:
  - Environment variables: `.env`, `.env.local`, `.env.production`, etc.
  - Git repositories: `.git` directories and all files within (`.git/config`, `.git/HEAD`, etc.).
  - Secrets & Credentials: `.forge-secrets*`, `*.key`, `*.pem`, `*.pkcs12`, `*.pfx`, `id_rsa`, `id_ed25519`.

## 5. Tool Specifications & Schemas

| Tool Name | Type / Hint | Description |
| :--- | :--- | :--- |
| `search_text` | `readOnlyHint: true` | Search text across workspace files. Limit 30 hits. Tracks search context budget. |
| `search_symbols` | `readOnlyHint: true` | Extracts classes, functions, methods, and docstrings. Uses `scripts/symbols.py`. |
| `read_file` | `readOnlyHint: true` | Reads up to 200 lines with line numbers. Enforces 8-file & 12,000 token context budget. |
| `find_related` | `readOnlyHint: true` | Discovers corresponding test files and documentation based on project conventions. |
| `propose_patch` | In-memory only | Parses and stages a unified diff in `PatchStore`. Generates patch/hunk IDs. Never writes to disk. |
| `propose_edit` | In-memory only | Computes a diff for unambiguous `{old_str, new_str}` replacement. Stages in `PatchStore`. Never writes to disk. |
| `apply_patch_hunk` | `destructiveHint: true` | **The ONLY disk-writing tool.** Validates hunk content against target file, rejects stale hunks, and applies changes via VS Code `WorkspaceEdit`. |
| `run_terminal_command` | Strict allowlist | Executes strictly allowlisted commands (`argv` array only, no shell strings, no redirection, no shell interpreters). |
| `ping` | `readOnlyHint: true` | Health check tool returning `pong` inside untrusted output wrapper. |

## 6. Output Sanitization & Untrusted Output Protection
All tool outputs are sanitized and wrapped using `sanitizeToolOutput` in `src/mcp/sanitize.ts`:
- Output length is capped at 20,000 characters to prevent context stuffing and runaway token consumption.
- Outputs are enclosed within clear boundary markers:
  ```
  <!-- Untrusted Tool Output Begin -->
  ...
  <!-- Untrusted Tool Output End -->
  ```
- Tool output is treated strictly as passive data, never interpreted as instructions.

## 7. Terminal Command Allowlist
`run_terminal_command` accepts an argument array (`argv: string[]`). It enforces:
- `shell: false` always (never invokes `sh`, `bash`, `cmd`, or `powershell`).
- Rejection of redirection (`>`, `<`) and shell control operators (`|`, `&`, `;`, `$`, `` ` ``).
- Approved commands:
  - `git status`
  - `git diff`
  - `pytest tests/test_cli.py -q`
  - `python -m pytest ...`
  - `python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"` (Task A check)
  - `flask --help`
  - `flask --app <safe_app> config`
  - `npm test`
- All other commands or executables (e.g. `rm`, `curl`, `git apply`, `git commit`) are strictly rejected.

## 8. MCP Inspector Connection Instructions
To inspect and test the MCP server using the official MCP Inspector:

1. **Start the Extension or Smoke Test Spike**:
   ```bash
   npx tsx spikes/s2-mcp.ts
   ```
   Or launch the VS Code Extension via `F5` (Extension Development Host).

2. **Copy Configuration**:
   In VS Code, run command `Forge: Copy MCP Connector Settings` (`forge.copyMcpConfig`).
   This copies the configuration to your clipboard:
   ```json
   {
     "mcpServers": {
       "forge-workspace": {
         "url": "http://127.0.0.1:8765/mcp",
         "headers": {
           "Authorization": "Bearer <YOUR_SECRET_TOKEN>"
         }
       }
     }
   }
   ```

3. **Launch MCP Inspector**:
   ```bash
   npx @modelcontextprotocol/inspector http://127.0.0.1:8765/mcp
   ```
   Or open the Inspector web UI, choose **Streamable HTTP** (or SSE), configure the endpoint `http://127.0.0.1:8765/mcp`, and provide the bearer token in the `Authorization` header.

4. **Verify Connectivity**:
   - The Inspector will initialize and list all 9 registered tools.
   - Run the `ping` tool in the Inspector to receive `pong`.

## 9. Verification & Testing
Run all verification checks from the repository root:
```bash
# Typecheck
npm run typecheck

# Linter
npm run lint

# Unit and Integration Tests
npm run test:unit

# Build Extension Bundle
npm run build
```
