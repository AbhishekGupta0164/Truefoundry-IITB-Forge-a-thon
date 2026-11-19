import { escapeHtml } from './html';

/**
 * Pending tool approvals. TrueForge can pause several tool calls at once and only resumes
 * when every one of them is decided, so each request gets its own card.
 */
export class ApprovalBarComponent {
  private element: HTMLElement;
  private onDecision?: (requestId: string, allow: boolean) => void;
  private cards = new Map<string, HTMLElement>();

  constructor(container: HTMLElement, onDecision?: (requestId: string, allow: boolean) => void) {
    this.element = document.createElement('div');
    this.element.className = 'approval-bar hidden';
    this.onDecision = onDecision;
    container.appendChild(this.element);
  }

  public promptApproval(requestId: string, toolName: string, args: Record<string, unknown>): void {
    if (this.cards.has(requestId)) return;
    const card = document.createElement('div');
    card.className = 'approval-card';
    card.innerHTML = `
      <div class="approval-header">Approval required: <strong>${escapeHtml(toolName)}</strong></div>
      <pre class="approval-args">${escapeHtml(JSON.stringify(args, null, 2).slice(0, 400))}</pre>
      <div class="approval-actions">
        <button class="btn btn-allow">Allow</button>
        <button class="btn btn-deny">Deny</button>
      </div>
    `;
    card.querySelector('.btn-allow')?.addEventListener('click', () => this.decide(requestId, true));
    card.querySelector('.btn-deny')?.addEventListener('click', () => this.decide(requestId, false));
    this.cards.set(requestId, card);
    this.element.appendChild(card);
    this.element.className = 'approval-bar visible';
  }

  public pendingCount(): number {
    return this.cards.size;
  }

  private decide(requestId: string, allow: boolean): void {
    this.cards.get(requestId)?.remove();
    this.cards.delete(requestId);
    if (this.cards.size === 0) this.element.className = 'approval-bar hidden';
    this.onDecision?.(requestId, allow);
  }

  public hide(): void {
    this.cards.clear();
    this.element.className = 'approval-bar hidden';
    this.element.innerHTML = '';
  }
}
