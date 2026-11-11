import type * as vscodeTypes from 'vscode';
import { WebviewIncomingMessage, WebviewOutgoingMessage } from './messages';

let vscodeModule: typeof vscodeTypes | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  vscodeModule = require('vscode');
} catch {
  // Running outside VS Code
}

export class AgentPanelProvider {
  public static readonly viewType = 'forge.agentPanel';
  private panel?: vscodeTypes.WebviewPanel;
  private messageHandlers: ((msg: WebviewIncomingMessage) => void)[] = [];

  constructor(public readonly extensionUri?: vscodeTypes.Uri) {}

  public show(): void {
    if (!vscodeModule?.window?.createWebviewPanel) {
      return;
    }

    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscodeModule.window.createWebviewPanel(
      AgentPanelProvider.viewType,
      'Forge Agent',
      vscodeModule.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    this.panel.webview.html = this.getHtml();

    this.panel.webview.onDidReceiveMessage((msg: WebviewIncomingMessage) => {
      for (const handler of this.messageHandlers) {
        handler(msg);
      }
    });

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  public postMessage(msg: WebviewOutgoingMessage): void {
    this.panel?.webview?.postMessage(msg);
  }

  public onMessage(handler: (msg: WebviewIncomingMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Forge Agent</title>
  <style>
    body { font-family: var(--vscode-font-family, sans-serif); color: var(--vscode-foreground); background-color: var(--vscode-editor-background); padding: 16px; }
    .header { font-size: 1.2em; font-weight: bold; margin-bottom: 12px; }
    .status { padding: 8px; border-radius: 4px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); display: inline-block; margin-bottom: 12px; }
    .chat-box { width: 100%; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); padding: 8px; box-sizing: border-box; }
  </style>
</head>
<body>
  <div class="header">Forge Agent</div>
  <div class="status">Connected to TrueForge</div>
  <div id="timeline"></div>
</body>
</html>`;
  }

  public dispose(): void {
    this.panel?.dispose();
  }
}

export const defaultAgentPanel = new AgentPanelProvider();
