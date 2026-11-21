/**
 * Modern Chat UI for Forge Agent
 */

import { WebviewOutgoingMessage } from '../messages';
import { escapeHtml } from './components/html';

declare const acquireVsCodeApi: any;

export class WebviewApp {
  private vscode: any;
  private root: HTMLElement;

  // DOM elements
  private stopBtn!: HTMLButtonElement;
  private undoBtn!: HTMLButtonElement;
  private openSessionBtn!: HTMLButtonElement;
  private messagesContainer!: HTMLElement;
  private textarea!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;

  // Current active agent message card
  private currentAgentCard: HTMLElement | null = null;
  private currentStreamEl: HTMLElement | null = null;
  private currentSourcesEl: HTMLElement | null = null;
  private currentTimelineEl: HTMLElement | null = null;
  private currentStatusBadge: HTMLElement | null = null;
  private currentBudgetEl: HTMLElement | null = null;
  private currentApprovalContainer: HTMLElement | null = null;

  // State
  private isRunning = false;
  private streamBuffer = '';
  private discoveredSources = new Set<string>();

  constructor() {
    this.vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
    this.root = document.getElementById('app') || document.body;
    this.renderLayout();
    this.bindEvents();

    window.addEventListener('message', (event) => {
      this.handleMessage(event.data as WebviewOutgoingMessage);
    });
  }

  private renderLayout(): void {
    this.root.innerHTML = `
      <!-- 1. Header -->
      <header class="chat-header">
        <div class="header-status">
          <span class="status-dot"></span>
          <span>TRUEFORGE HTTP://LOCALHOST:8790</span>
        </div>
        <div class="header-title-row">
          <h1 class="header-title">Forge Agent</h1>
          <button class="btn-stop" id="stopBtn" disabled>⏹ Stop</button>
        </div>
        <div class="header-models-row">
          <span>Models:</span>
          <span class="model-name">ollama/llama-3-2-3b</span>
          <span>→</span>
          <span class="model-name">google-gemini/gemini-flash</span>
          <span style="opacity: 0.6;">(fallback in order)</span>
        </div>
        <div class="header-toolbar">
          <button class="btn-pill" id="undoBtn">Undo last change</button>
          <button class="btn-pill" id="openSessionBtn">Open TrueForge session</button>
        </div>
      </header>

      <!-- 2. Scrollable Messages Area -->
      <main class="chat-messages" id="messagesContainer">
        <div class="welcome-card">
          <div class="welcome-title">A coding agent that shows its sources and never writes without you.</div>
          <div class="welcome-sub">
            Ask for a change below, or select code and press <code>Cmd+Alt+K</code> for an inline edit.
          </div>
        </div>
      </main>

      <!-- 3. Pinned Bottom Composer -->
      <footer class="chat-composer">
        <div class="composer-box">
          <textarea
            class="composer-textarea"
            id="composerInput"
            rows="2"
            placeholder="Ask for a change. @file or @symbol to pin context. Enter to send, Shift+Enter for a new line."
            aria-label="Ask for a change"
          ></textarea>
          <div class="composer-footer">
            <span class="composer-hint">Agent mode: one request, Forge Agent finds the files.</span>
            <button class="btn-send" id="sendBtn">Send</button>
          </div>
        </div>
      </footer>
    `;

    this.stopBtn = this.root.querySelector('#stopBtn') as HTMLButtonElement;
    this.undoBtn = this.root.querySelector('#undoBtn') as HTMLButtonElement;
    this.openSessionBtn = this.root.querySelector('#openSessionBtn') as HTMLButtonElement;
    this.messagesContainer = this.root.querySelector('#messagesContainer') as HTMLElement;
    this.textarea = this.root.querySelector('#composerInput') as HTMLTextAreaElement;
    this.sendBtn = this.root.querySelector('#sendBtn') as HTMLButtonElement;
  }

  private bindEvents(): void {
    this.sendBtn.addEventListener('click', () => this.submitPrompt());
    this.stopBtn.addEventListener('click', () => {
      this.vscode?.postMessage({ type: 'cancel_run' });
      this.setRunning(false);
    });
    this.undoBtn.addEventListener('click', () => {
      this.vscode?.postMessage({ type: 'undo_task' });
    });
    this.openSessionBtn.addEventListener('click', () => {
      this.vscode?.postMessage({ type: 'open_session' });
    });

    this.textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.submitPrompt();
      }
    });
  }

  private submitPrompt(): void {
    const prompt = this.textarea.value.trim();
    if (!prompt || this.isRunning) return;

    this.textarea.value = '';
    this.appendUserMessage(prompt);
    this.initAgentResponse();
    this.setRunning(true);

    this.vscode?.postMessage({ type: 'submit_prompt', prompt });
  }

  private setRunning(running: boolean): void {
    this.isRunning = running;
    this.sendBtn.disabled = running;
    this.stopBtn.disabled = !running;
    if (running) {
      this.updateStatus('running');
    }
  }

  private appendUserMessage(text: string): void {
    const msg = document.createElement('div');
    msg.className = 'chat-message user';
    msg.innerHTML = `<div class="message-bubble">${escapeHtml(text)}</div>`;
    this.messagesContainer.appendChild(msg);
    this.scrollToBottom();
  }

  private initAgentResponse(): void {
    this.streamBuffer = '';
    this.discoveredSources.clear();

    const agentMsg = document.createElement('div');
    agentMsg.className = 'chat-message agent';

    const card = document.createElement('div');
    card.className = 'agent-response-card';

    // Status & Meta header
    const statusRow = document.createElement('div');
    statusRow.className = 'response-meta';
    statusRow.innerHTML = `
      <div class="meta-budget" id="cardBudget">⚡ Budget: 0 / 12,000 tokens (0%)</div>
      <span class="status-badge running" id="cardStatus">Running…</span>
    `;

    // Discovered sources card (hidden until files found)
    const sourcesCard = document.createElement('div');
    sourcesCard.className = 'sources-card';
    sourcesCard.style.display = 'none';
    sourcesCard.innerHTML = `
      <div class="sources-label">Sources & Discovered Files</div>
      <div class="sources-chips" id="sourcesChips"></div>
    `;

    // Tool timeline steps
    const timeline = document.createElement('div');
    timeline.className = 'tools-timeline';

    // Token stream pre-wrap
    const stream = document.createElement('div');
    stream.className = 'token-stream';
    stream.style.display = 'none';

    // Approvals container
    const approvals = document.createElement('div');
    approvals.className = 'approval-container';

    card.append(statusRow, sourcesCard, timeline, stream, approvals);
    agentMsg.appendChild(card);
    this.messagesContainer.appendChild(agentMsg);

    this.currentAgentCard = card;
    this.currentStreamEl = stream;
    this.currentSourcesEl = sourcesCard.querySelector('#sourcesChips');
    this.currentTimelineEl = timeline;
    this.currentStatusBadge = statusRow.querySelector('#cardStatus');
    this.currentBudgetEl = statusRow.querySelector('#cardBudget');
    this.currentApprovalContainer = approvals;

    this.scrollToBottom();
  }

  private handleMessage(msg: WebviewOutgoingMessage): void {
    switch (msg.type) {
      case 'token':
        if (this.currentStreamEl) {
          this.currentStreamEl.style.display = 'block';
          this.streamBuffer += msg.text;
          this.currentStreamEl.textContent = this.streamBuffer;
          this.scrollToBottom();
        }
        break;

      case 'tool_call':
        this.addToolStep(msg.toolCallId, msg.name, msg.arguments);
        break;

      case 'tool_result':
        this.completeToolStep(msg.result.toolCallId, msg.result.success);
        break;

      case 'context_update':
        this.updateSources(msg.entries || []);
        break;

      case 'budget_update':
        this.updateBudget(msg.budget);
        break;

      case 'approval_required':
        this.promptApproval(msg.requestId, msg.toolName, msg.args);
        break;

      case 'diff_card':
        this.renderDiffCard(msg.id, msg.file, msg.newCode, msg.oldCode, msg.status);
        break;

      case 'run_started':
        this.setRunning(true);
        break;

      case 'run_completed':
        this.setRunning(false);
        this.updateStatus(msg.status);
        break;

      case 'error':
        this.renderError(msg.message);
        this.setRunning(false);
        this.updateStatus('failed');
        break;
    }
  }

  private addToolStep(id: string, name: string, args: Record<string, unknown>): void {
    if (!this.currentTimelineEl) return;
    const step = document.createElement('div');
    step.className = 'tool-step running';
    step.id = `tool-${id}`;

    let label = name;
    if (name === 'search_text') label = `search_text "${args.query || ''}"`;
    else if (name === 'read_file') label = `read_file ${args.path || ''}`;
    else if (name === 'propose_edit' || name === 'propose_patch') label = `propose_diff ${args.path || ''}`;
    else if (name === 'apply_patch_hunk') label = `apply_patch_hunk (${args.hunkId || args.hunk_id || ''})`;

    step.innerHTML = `<span>⚡</span> <span>${escapeHtml(label)}</span>`;
    this.currentTimelineEl.appendChild(step);
    this.scrollToBottom();

    // Check if path is a file source
    const path = String(args.path || args.filePath || '');
    if (path && (path.endsWith('.py') || path.endsWith('.rst'))) {
      this.addSourceChip(path);
    }
  }

  private completeToolStep(id: string, success: boolean): void {
    const el = this.currentTimelineEl?.querySelector(`#tool-${id}`);
    if (el) {
      el.className = `tool-step ${success ? 'done' : 'error'}`;
      const icon = el.querySelector('span');
      if (icon) icon.textContent = success ? '✓' : '✗';
    }
  }

  private updateSources(entries: any[]): void {
    for (const e of entries) {
      if (e.uri && (e.uri.endsWith('.py') || e.uri.endsWith('.rst'))) {
        this.addSourceChip(e.uri);
      }
    }
  }

  private addSourceChip(path: string): void {
    if (this.discoveredSources.has(path) || !this.currentSourcesEl) return;
    this.discoveredSources.add(path);

    const parent = this.currentSourcesEl.parentElement;
    if (parent) parent.style.display = 'block';

    const chip = document.createElement('span');
    chip.className = 'source-chip';
    chip.innerHTML = `<span>📄</span> ${escapeHtml(path)}`;
    this.currentSourcesEl.appendChild(chip);
    this.scrollToBottom();
  }

  private updateBudget(budget: any): void {
    if (!this.currentBudgetEl || !budget) return;
    const pct = Math.min(100, Math.round((budget.usedTokens / (budget.maxTokens || 1)) * 100));
    this.currentBudgetEl.textContent = `⚡ Budget: ${budget.usedTokens.toLocaleString()} / ${budget.maxTokens.toLocaleString()} tokens (${pct}%)`;
  }

  private updateStatus(status: string): void {
    if (!this.currentStatusBadge) return;
    this.currentStatusBadge.className = `status-badge ${status}`;
    if (status === 'running') this.currentStatusBadge.textContent = 'Running…';
    else if (status === 'completed') this.currentStatusBadge.textContent = '✓ Done';
    else if (status === 'failed') this.currentStatusBadge.textContent = 'Failed';
    else if (status === 'cancelled') this.currentStatusBadge.textContent = 'Cancelled';
    else if (status === 'awaiting_approval') this.currentStatusBadge.textContent = 'Waiting for Approval';
  }

  private promptApproval(requestId: string, toolName: string, args: Record<string, unknown>): void {
    if (!this.currentApprovalContainer) return;
    this.updateStatus('awaiting_approval');

    const card = document.createElement('div');
    card.className = 'approval-card';
    card.innerHTML = `
      <div class="approval-header">Approval required: <strong>${escapeHtml(toolName)}</strong></div>
      <pre class="approval-args">${escapeHtml(JSON.stringify(args, null, 2).slice(0, 400))}</pre>
      <div class="approval-actions">
        <button class="btn-allow">Allow</button>
        <button class="btn-deny">Deny</button>
      </div>
    `;

    card.querySelector('.btn-allow')?.addEventListener('click', () => {
      card.remove();
      this.updateStatus('running');
      this.vscode?.postMessage({
        type: 'approve_tool',
        requestId,
        decision: { hunkId: requestId, decision: 'accept', timestamp: Date.now() }
      });
    });

    card.querySelector('.btn-deny')?.addEventListener('click', () => {
      card.remove();
      this.vscode?.postMessage({
        type: 'approve_tool',
        requestId,
        decision: { hunkId: requestId, decision: 'reject', timestamp: Date.now() }
      });
    });

    this.currentApprovalContainer.appendChild(card);
    this.scrollToBottom();
  }

  private renderDiffCard(
    id: string,
    file: string,
    newCode: string,
    _oldCode?: string,
    status?: 'pending' | 'applied' | 'rejected'
  ): void {
    if (!this.currentApprovalContainer) return;
    this.updateStatus('awaiting_approval');

    const card = document.createElement('div');
    card.className = 'diff-card';
    card.id = `diff-card-${id}`;

    const isApplied = status === 'applied';

    card.innerHTML = `
      <div class="diff-card-header">
        <span class="diff-card-file">${escapeHtml(file)}</span>
        <span class="diff-card-action">Edit in ${escapeHtml(file)}</span>
      </div>
      <div class="diff-card-code">${escapeHtml(newCode)}</div>
      <div class="diff-card-buttons">
        <button class="btn-applied ${isApplied ? 'done' : ''}">${isApplied ? 'Applied ✓' : 'Applied ✓'}</button>
        <button class="btn-reject">✗ Reject</button>
      </div>
    `;

    const applyBtn = card.querySelector('.btn-applied') as HTMLButtonElement;
    const rejectBtn = card.querySelector('.btn-reject') as HTMLButtonElement;

    applyBtn?.addEventListener('click', () => {
      applyBtn.textContent = 'Applied ✓';
      applyBtn.classList.add('done');
      this.vscode?.postMessage({
        type: 'apply_diff_card',
        id,
        file,
        decision: 'accept'
      });
    });

    rejectBtn?.addEventListener('click', () => {
      card.remove();
      this.vscode?.postMessage({
        type: 'apply_diff_card',
        id,
        file,
        decision: 'reject'
      });
    });

    this.currentApprovalContainer.appendChild(card);
    this.scrollToBottom();
  }

  private renderError(message: string): void {
    if (!this.currentAgentCard) return;
    const alert = document.createElement('div');
    alert.className = 'alert-error';
    alert.innerHTML = `<strong>Error:</strong> ${escapeHtml(message)}`;
    this.currentAgentCard.appendChild(alert);
    this.scrollToBottom();
  }

  private scrollToBottom(): void {
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }
}

// Auto mount on load
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    new WebviewApp();
  });
}
