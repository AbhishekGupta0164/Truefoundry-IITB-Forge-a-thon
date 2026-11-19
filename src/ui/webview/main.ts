import { TokenStreamComponent } from './components/token-stream';
import { ToolTimelineComponent } from './components/tool-timeline';
import { ContextMapComponent } from './components/context-map';
import { BudgetMeterComponent } from './components/budget-meter';
import { ApprovalBarComponent } from './components/approval-bar';
import { ComposerComponent } from './components/composer';
import { StatusLineComponent } from './components/status-line';
import { WebviewOutgoingMessage } from '../messages';

declare const acquireVsCodeApi: any;

export class WebviewApp {
  private vscode: any;
  private tokenStream: TokenStreamComponent;
  private timeline: ToolTimelineComponent;
  private contextMap: ContextMapComponent;
  private budgetMeter: BudgetMeterComponent;
  private approvalBar: ApprovalBarComponent;
  private composer: ComposerComponent;
  private status: StatusLineComponent;

  constructor() {
    this.vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;

    const root = document.getElementById('app') || document.body;

    const composerContainer = document.createElement('div');
    const statusContainer = document.createElement('div');
    const budgetContainer = document.createElement('div');
    const tokenContainer = document.createElement('div');
    const timelineContainer = document.createElement('div');
    const contextContainer = document.createElement('div');
    const approvalContainer = document.createElement('div');

    root.appendChild(composerContainer);
    root.appendChild(statusContainer);
    root.appendChild(budgetContainer);
    root.appendChild(tokenContainer);
    root.appendChild(timelineContainer);
    root.appendChild(contextContainer);
    root.appendChild(approvalContainer);

    this.composer = new ComposerComponent(composerContainer, {
      onRun: (prompt) => this.vscode?.postMessage({ type: 'submit_prompt', prompt }),
      onCancel: () => this.vscode?.postMessage({ type: 'cancel_run' }),
      onUndoTask: () => this.vscode?.postMessage({ type: 'undo_task' })
    });
    this.status = new StatusLineComponent(statusContainer);
    this.budgetMeter = new BudgetMeterComponent(budgetContainer);
    this.tokenStream = new TokenStreamComponent(tokenContainer);
    this.timeline = new ToolTimelineComponent(timelineContainer);
    this.contextMap = new ContextMapComponent(contextContainer);
    this.approvalBar = new ApprovalBarComponent(approvalContainer, (requestId, allow) => {
      if (this.approvalBar.pendingCount() === 0) this.status.setState('running');
      this.vscode?.postMessage({
        type: 'approve_tool',
        requestId,
        decision: {
          hunkId: requestId,
          decision: allow ? 'accept' : 'reject',
          timestamp: Date.now()
        }
      });
    });

    window.addEventListener('message', (event) => {
      this.handleMessage(event.data as WebviewOutgoingMessage);
    });
  }

  private handleMessage(msg: WebviewOutgoingMessage): void {
    switch (msg.type) {
      case 'token':
        this.tokenStream.appendToken(msg.text);
        break;
      case 'tool_call':
        this.timeline.addToolCall(msg.toolCallId, msg.name, msg.arguments);
        break;
      case 'tool_result':
        this.timeline.completeToolCall(msg.result.toolCallId, msg.result.success, msg.result.output);
        break;
      case 'context_update':
        this.contextMap.update(msg.entries, msg.groups, msg.budgetMeter);
        break;
      case 'budget_update':
        this.budgetMeter.update(msg.budget);
        break;
      case 'approval_required':
        this.approvalBar.promptApproval(msg.requestId, msg.toolName, msg.args);
        this.status.setState('awaiting_approval');
        break;
      case 'run_started':
        this.tokenStream.clear();
        this.timeline.clear();
        this.approvalBar.hide();
        this.status.clearErrors();
        this.status.setState('running');
        this.composer.setRunning(true);
        break;
      case 'run_completed':
        this.status.setState(msg.status);
        this.composer.setRunning(false);
        if (msg.status !== 'completed') this.approvalBar.hide();
        break;
      case 'error':
        this.status.addError(msg.message);
        break;
    }
  }
}

// Auto mount if in browser/webview
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    new WebviewApp();
  });
}
