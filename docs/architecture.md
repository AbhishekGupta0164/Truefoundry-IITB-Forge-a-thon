# Forge-Agent Architecture & System Design

```mermaid
flowchart TD
    User([Developer / VS Code]) -->|Cmd+Alt+K / Webview| UI[UI Module: src/ui]
    UI -->|Events & Approvals| Review[Review Module: src/review]
    UI -->|Prompts & Turns| TF[TrueForge Client: src/trueforge]

    subgraph Backend [Local Daemons]
        TF -->|HTTP / SSE| Daemon[TrueForge Daemon :8790]
        Daemon -->|MCP Protocol| MCP[Workspace MCP Server :8765: src/mcp]
    end

    subgraph Tools [MCP Capabilities]
        MCP --> Search[Search & Read: src/context]
        MCP --> Patch[Hunk Proposal: src/mcp/tools]
        MCP --> Apply[apply_patch_hunk: Only Disk Writer]
    end

    Apply -->|WorkspaceEdit| Workspace[(Workspace Files / Flask Target)]
```

## Data Flow
1. **Trigger**: Developer initiates a turn via inline edit (`Cmd+Alt+K`) or the Agent Panel.
2. **Orchestration**: The TrueForge client creates an execution turn with the local TrueForge daemon.
3. **Context Gathering**: The model issues MCP tool calls (`search_text`, `read_file`, `search_symbols`) to gather scoped workspace context.
4. **Patch Proposal**: Edits are staged in memory as unified diff hunks without mutating disk files.
5. **Human Review**: The Review module presents CodeLens `[Accept]` and `[Reject]` actions alongside native side-by-side diffs.
6. **Application**: On acceptance, `apply_patch_hunk` writes edits atomically and records inverse diffs for complete undoability.
