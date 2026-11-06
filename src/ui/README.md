# UI Module (`src/ui/`)

**Module Owner**: Member 3 (M3)

## 1. Module Purpose
Houses the developer-facing UI components inside VS Code: the inline edit input box (`Cmd+Alt+K`), status bar indicators, and the primary Agent Webview Panel with streaming timelines, context visualizers, budget meters, and approval bars.

## 2. Files Owned by Module
- `inline-edit.ts`: Captures selection range and user instruction via `vscode.window.showInputBox` and forwards to agent turn.
- `panel.ts`: WebviewViewProvider / WebviewPanel managing webview lifecycle and message dispatching.
- `status-bar.ts`: Status bar item displaying connection state and modified files count.
- `messages.ts`: Strict typed message schema for bidirectional communication between extension host and webview iframe.
- `webview/index.html`: Webview skeleton and script mount point.
- `webview/main.ts`: Client-side state machine rendering event streams, tool timeline, and approvals.
- `webview/styles.css`: VS Code themed styling (`var(--vscode-*)`).
- `webview/components/`: Subcomponents:
  - `token-stream.ts`: Real-time streaming token display.
  - `tool-timeline.ts`: Visual execution tree of MCP tool calls.
  - `context-map.ts`: Interactive map of consulted files and line ranges.
  - `budget-meter.ts`: Token and cost consumption gauge.
  - `approval-bar.ts`: One-click allow/deny bar for sensitive tool calls.

## 3. Expected Inputs & Outputs
- **Inputs**: User keyboard shortcuts, typed inputs, webview button clicks; internal `ForgeEvent` stream.
- **Outputs**: Webview HTML renders, typed messages sent to extension host (`postMessage`).

## 4. Shared Contracts Used
- `src/shared/types.ts`: `BudgetState`, `ToolResult`, `ContextEntry`.
- `src/shared/events.ts`: `ForgeEvent`, `TokenEvent`, `ToolCallEvent`, `DoneEvent`.

## 5. Dependencies on Other Modules
- **Depends on**: `src/shared/`, `src/trueforge/` (subscribes to stream), `src/review/` (sends approvals).
- **Depended by**: `src/extension.ts` (registers views and commands).

## 6. Testing Requirements
- Component rendering tests.
- Mock stream validation using `test/helpers/fake-trueforge.ts`.

## 7. Module Completion Criteria
1. Webview loads and renders token stream smoothly without freezing UI thread.
2. Webview strictly adopts VS Code theme colors and responsive layout.
3. Accurate, real-time budget meter updates.
