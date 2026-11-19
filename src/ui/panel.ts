import type * as vscodeTypes from 'vscode';
import { WebviewIncomingMessage, WebviewOutgoingMessage } from './messages';
import { TrueForgeClient, defaultTrueForgeClient } from '../trueforge/client';
import { PatchStore, defaultPatchStore } from '../review/store';
import { defaultCancelManager } from '../review/cancel';
import { defaultUndoManager } from '../review/undo';
import { ContextLedger, defaultContextLedger } from '../context/ledger';
import { getUserFacingErrorMessage } from '../shared/errors';
import { ContextEntry } from '../shared/types';
import { ForgeEvent } from '../shared/events';

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

      this.accumulatedContext = [];
      const stream = await this.trueforgeClient.runTaskB(prompt);
      await this.consumeStream(stream);
    } catch (err: any) {
      const msg = getUserFacingErrorMessage(err);
      this.postMessage({ type: 'error', message: msg });
      this.postMessage({ type: 'run_completed', status: 'failed' });
    }
  }

  private accumulatedContext: ContextEntry[] = [];

  /**
   * Render one TrueForge event stream (a first turn or a resumed approval turn)
   * into the webview: tokens, tool timeline, context map, approvals, completion.
   */
  public async consumeStream(stream: AsyncIterable<ForgeEvent>): Promise<void> {

    for await (const event of stream) {
      switch (event.type) {
        case 'token':
          this.postMessage({ type: 'token', text: event.text });
          break;

        case 'tool_call': {
          this.postMessage({
            type: 'tool_call',
            toolCallId: event.toolCallId,
            name: event.name,
            arguments: event.arguments
          });

          // Track discovered files and context for map visualization (Task B visible flow)
          if (['read_file', 'search_text', 'find_related', 'search_symbols'].includes(event.name)) {
            const args = (event.arguments || {}) as Record<string, unknown>;
            const targetUri = String(args.path || args.filePath || args.targetPath || args.query || args.name || 'workspace');
            const reason = String(args.reason || args.explanation || `Tool invocation: ${event.name}`);

            let entryType: ContextEntry['type'] = 'file';
            if (event.name === 'search_text') entryType = 'snippet';
            else if (event.name === 'find_related' || event.name === 'search_symbols') entryType = 'symbol';

            const existingIdx = this.accumulatedContext.findIndex(e => e.uri === targetUri);
            if (existingIdx >= 0) {
              this.accumulatedContext[existingIdx].metadata = {
                ...this.accumulatedContext[existingIdx].metadata,
                reason
              };
            } else {
              this.accumulatedContext.push({
                id: `ctx-${Date.now()}-${this.accumulatedContext.length}`,
                type: entryType,
                uri: targetUri,
                content: '',
                metadata: {
                  tool: event.name,
                  reason
                }
              });
            }
            this.postMessage({ type: 'context_update', entries: [...this.accumulatedContext] });
          }
          break;
        }

        case 'tool_result': {
          this.postMessage({ type: 'tool_result', result: event.result });
          if (event.result.output && this.accumulatedContext.length > 0) {
            const last = this.accumulatedContext[this.accumulatedContext.length - 1];
            last.tokenCount = Math.ceil(event.result.output.length / 4);
            this.postMessage({ type: 'context_update', entries: [...this.accumulatedContext] });
          }
          break;
        }

        case 'approval':
          this.postMessage({
            type: 'approval_required',
            requestId: event.requestId,
            toolName: event.action,
            args: this.trueforgeClient.getToolCallInfo(event.requestId)?.arguments ?? {}
          });
          break;

        case 'error':
          this.postMessage({ type: 'error', message: getUserFacingErrorMessage(event.message) });
          break;

        case 'done':
          // A turn paused on tool.approval_required also ends with turn.done; the run
          // is not finished until the paused calls are decided and the turn resumes.
          if (event.status === 'completed' && this.trueforgeClient.getPendingApprovalIds().length > 0) {
            break;
          }
          this.postMessage({
            type: 'run_completed',
            status: event.status === 'cancelled' ? 'cancelled' : 'completed'
          });
          break;
      }
    }
  }

  /**
   * Apply a user decision to a paused tool call. When the whole approval batch is
   * decided, TrueForge resumes and the resumed stream is rendered like the first one.
   * Returns false when no tool call with that id is waiting.
   */
  public async decideToolApproval(toolCallId: string, decision: 'accept' | 'reject', reason?: string): Promise<boolean> {
    if (!this.trueforgeClient.getPendingApprovalIds().includes(toolCallId)) {
      return false;
    }
    try {
      const sessionId = this.trueforgeClient.sessionManager.getSession()?.sessionId ?? '';
      const resumed = await this.trueforgeClient.decideApproval(sessionId, toolCallId, decision, reason);
      if (resumed) {
        await this.consumeStream(resumed);
      }
    } catch (err: any) {
      this.postMessage({ type: 'error', message: getUserFacingErrorMessage(err) });
      this.postMessage({ type: 'run_completed', status: 'failed' });
    }
    return true;
  }

  /**
   * CodeLens Accept/Reject on a hunk the agent is waiting to apply: route the decision
   * to TrueForge's paused apply_patch_hunk call instead of writing from the extension.
   * Returns false when no paused call targets this hunk.
   */
  public async decideHunkApproval(patchId: string, hunkId: string, decision: 'accept' | 'reject'): Promise<boolean> {
    for (const id of this.trueforgeClient.getPendingApprovalIds()) {
      const info = this.trueforgeClient.getToolCallInfo(id);
      if (info?.name !== 'apply_patch_hunk') continue;
      const args = info.arguments;
      const p = args.patch_id ?? args.patchId;
      const h = args.hunk_id ?? args.hunkId;
      if (p === patchId && h === hunkId) {
        return this.decideToolApproval(id, decision);
      }
    }
    return false;
  }

  public async handleIncomingMessage(msg: WebviewIncomingMessage): Promise<void> {
    switch (msg.type) {
      case 'submit_prompt':
        await this.submitRawPrompt(msg.prompt);
        break;

      case 'cancel_run': {
        this.postMessage({ type: 'run_completed', status: 'cancelled' });
        if (vscodeModule?.commands?.executeCommand) {
          await vscodeModule.commands.executeCommand('forge.cancel');
        } else {
          const stats = defaultCancelManager.cancelAll();
          vscodeModule?.window?.showInformationMessage(stats.message);
        }
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
        // Resume the paused TrueForge turn with the user's decision (user.tool_approval).
        await this.decideToolApproval(msg.requestId, msg.decision.decision === 'accept' ? 'accept' : 'reject');
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
