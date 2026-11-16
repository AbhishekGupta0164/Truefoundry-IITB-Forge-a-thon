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

    const distUri = this.extensionUri && vscodeModule ? vscodeModule.Uri.joinPath(this.extensionUri, 'dist') : undefined;

    this.panel = vscodeModule.window.createWebviewPanel(
      AgentPanelProvider.viewType,
      'Forge Agent',
      vscodeModule.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: distUri ? [distUri] : []
      }
    );

    this.panel.webview.html = this.getHtml(this.panel.webview);

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

  private getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  private getHtml(webview?: vscodeTypes.Webview): string {
    const nonce = this.getNonce();
    let scriptUri = '';
    let styleUri = '';
    const cspSource = webview?.cspSource || "'self'";

    if (this.extensionUri && vscodeModule && webview) {
      try {
        scriptUri = webview.asWebviewUri(vscodeModule.Uri.joinPath(this.extensionUri, 'dist', 'webview.js')).toString();
        styleUri = webview.asWebviewUri(vscodeModule.Uri.joinPath(this.extensionUri, 'dist', 'styles.css')).toString();
      } catch {
        // Fallback for mocked environments
      }
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Forge Agent</title>
  ${styleUri ? `<link rel="stylesheet" href="${styleUri}">` : ''}
  <style>
    body { font-family: var(--vscode-font-family, sans-serif); color: var(--vscode-foreground); background-color: var(--vscode-editor-background); padding: 12px; }
  </style>
</head>
<body>
  <div id="app"></div>
  ${scriptUri ? `<script nonce="${nonce}" src="${scriptUri}"></script>` : ''}
</body>
</html>`;
  }

  public dispose(): void {
    this.panel?.dispose();
  }
}

export const defaultAgentPanel = new AgentPanelProvider();
