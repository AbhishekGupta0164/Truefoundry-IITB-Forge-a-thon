import type * as vscodeTypes from 'vscode';
import { WebviewIncomingMessage, WebviewOutgoingMessage } from './messages';
import { TrueForgeClient, defaultTrueForgeClient } from '../trueforge/client';
import { PatchStore, defaultPatchStore } from '../review/store';
import { defaultCancelManager } from '../review/cancel';
import { defaultUndoManager } from '../review/undo';
import { ContextLedger, defaultContextLedger } from '../context/ledger';
import { getUserFacingErrorMessage } from '../shared/errors';

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
  private trueforgeClient: TrueForgeClient;
  public readonly contextLedger: ContextLedger;
  constructor(
    public readonly extensionUri?: vscodeTypes.Uri,
    trueforgeClient: TrueForgeClient = defaultTrueForgeClient,
    public readonly patchStore: PatchStore = defaultPatchStore,
    contextLedger: ContextLedger = defaultContextLedger
  ) {
    this.trueforgeClient = trueforgeClient;
    this.contextLedger = contextLedger;

    this.contextLedger.onContextUpdate((_entry, ledger) => {
      this.syncContextLedger(ledger);
    });
  }

  private isSyncing = false;
  public syncContextLedger(ledger: ContextLedger = this.contextLedger): void {
    if (this.isSyncing) {
      return;
    }
    this.isSyncing = true;
    try {
      const groups = ledger.getGroups();
      const budgetMeter = ledger.getBudgetMeter();
      this.postMessage({
        type: 'context_update',
        entries: ledger.getEntries().map((e) => ({
          id: e.id,
          type: e.kind === 'read' ? 'file' : e.kind === 'searched' ? 'snippet' : 'rule',
          uri: e.path,
          content: e.reason,
          tokenCount: e.estimatedTokens
        })),
        groups: {
          read: groups.read.map((r) => ({
            path: r.path,
            lineRange: r.startLine != null && r.endLine != null ? `L${r.startLine}-${r.endLine}` : undefined,
            reason: r.reason
          })),
          searched: groups.searched.map((s) => ({
            path: s.path,
            lineRange: undefined,
            reason: s.reason
          })),
          skipped: groups.skipped.map((sk) => ({
            path: sk.path,
            lineRange: undefined,
            reason: sk.reason
          }))
        },
        budgetMeter
      });
    } finally {
      this.isSyncing = false;
    }
  }

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
    this.syncContextLedger();

    this.panel.webview.onDidReceiveMessage(async (msg: WebviewIncomingMessage) => {
      // Execute any registered custom handlers
      for (const handler of this.messageHandlers) {
        handler(msg);
      }

      // Handle standard webview commands
      await this.handleIncomingMessage(msg);
    });

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  /**
   * Routes raw user request to TrueForge without attaching filenames or selected text.
   * Model discovers files, searches, reads, and proposes edits via MCP.
   */
  public async submitRawPrompt(prompt: string): Promise<void> {
    try {
      this.postMessage({ type: 'budget_update', budget: { maxTokens: 12000, usedTokens: 0, maxCostUsd: 1, usedCostUsd: 0, maxIterations: 20, currentIteration: 1 } });

      const stream = await this.trueforgeClient.runTaskB(prompt);

      for await (const event of stream) {
        switch (event.type) {
          case 'token':
            this.postMessage({ type: 'token', text: event.text });
            break;

          case 'tool_call':
            this.postMessage({
              type: 'tool_call',
              toolCallId: event.toolCallId,
              name: event.name,
              arguments: event.arguments
            });
            break;

          case 'tool_result':
            this.postMessage({ type: 'tool_result', result: event.result });
            break;

          case 'approval':
            this.postMessage({
              type: 'approval_required',
              requestId: event.requestId,
              toolName: event.action,
              args: {}
            });
            break;

          case 'error':
            this.postMessage({ type: 'error', message: getUserFacingErrorMessage(event.message) });
            break;

          case 'done':
            this.postMessage({
              type: 'run_completed',
              status: event.status === 'cancelled' ? 'cancelled' : 'completed'
            });
            break;
        }
      }
    } catch (err: any) {
      const msg = getUserFacingErrorMessage(err);
      this.postMessage({ type: 'error', message: msg });
      this.postMessage({ type: 'run_completed', status: 'failed' });
    }
  }

  public async handleIncomingMessage(msg: WebviewIncomingMessage): Promise<void> {
    switch (msg.type) {
      case 'submit_prompt':
        await this.submitRawPrompt(msg.prompt);
        break;

      case 'cancel_run': {
        const stats = defaultCancelManager.cancelAll();
        this.postMessage({ type: 'run_completed', status: 'cancelled' });
        vscodeModule?.window?.showInformationMessage(stats.message);
        break;
      }

      case 'undo_task': {
        const res = await defaultUndoManager.undoTask();
        vscodeModule?.window?.showInformationMessage(
          `Forge: Whole task undone (${res.revertedFiles.length} file(s) reverted)`
        );
        break;
      }

      case 'approve_tool':
        // Resume TrueForge turn with user's decision
        try {
          await this.trueforgeClient.sendApprovalResume(
            this.trueforgeClient.sessionManager.getSession()?.sessionId || '',
            {
              toolCallId: msg.requestId,
              approved: msg.decision.decision === 'accept',
              decision: msg.decision
            }
          );
        } catch (err: any) {
          this.postMessage({ type: 'error', message: getUserFacingErrorMessage(err) });
        }
        break;

      case 'request_state':
        this.syncContextLedger();
        break;

      default:
        break;
    }
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
