import type * as vscodeTypes from 'vscode';
import { WebviewIncomingMessage, WebviewOutgoingMessage } from './messages';
import { TrueForgeClient, defaultTrueForgeClient } from '../trueforge/client';
import { PatchStore, defaultPatchStore } from '../review/store';
import { defaultCancelManager } from '../review/cancel';
import { defaultUndoManager } from '../review/undo';
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
  constructor(
    public readonly extensionUri?: vscodeTypes.Uri,
    trueforgeClient: TrueForgeClient = defaultTrueForgeClient,
    public readonly patchStore: PatchStore = defaultPatchStore
  ) {
    this.trueforgeClient = trueforgeClient;
  }

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
