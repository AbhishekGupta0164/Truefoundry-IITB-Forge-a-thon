# AI Agent Operating Guidelines & Invariants

This document establishes the non-negotiable architectural and safety invariants for all human and AI contributors (Cursor, Antigravity, Copilot, etc.) working on the TrueFoundry Forge-a-thon codebase.

## Core Architectural Invariants

1. **No Direct Model API Calls**: The VS Code extension must never invoke external model APIs (OpenAI, Anthropic, Gemini, etc.) directly.
2. **TrueForge Proxy**: All LLM queries and model orchestration must route exclusively through the local TrueForge server.
3. **Restricted File Writes**: No arbitrary file system mutations are allowed. All file modifications must occur via `apply_patch_hunk` after verification.
4. **Human Review Before Application**: Patch hunks must be reviewed or explicit approval granted before changes are written to the workspace.
5. **Strict Command Allowlist**: Shell command execution is prohibited unless the command exactly matches the security allowlist (`ALLOWED_COMMANDS`).
6. **Workspace Confinement**: All file reads, writes, and operations must be constrained strictly within `${workspaceFolder}`. Absolute paths outside the workspace are rejected.
7. **Local MCP Binding**: The MCP (Model Context Protocol) server must bind strictly to `127.0.0.1` (default port `8765`), never `0.0.0.0` or external network interfaces.
8. **Zero Secret Leaks**: Secrets, tokens, and API credentials must never be committed to Git. Gitleaks pre-commit/CI scans must pass cleanly at all times.
9. **Mandatory Test Coverage**: Every newly implemented module or contract change must include corresponding unit tests in `test/unit/`.
