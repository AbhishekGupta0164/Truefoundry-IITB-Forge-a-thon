export class ApprovalBarComponent {
  private element: HTMLElement;
  private onDecision?: (requestId: string, allow: boolean) => void;

  constructor(container: HTMLElement, onDecision?: (requestId: string, allow: boolean) => void) {
    this.element = document.createElement('div');
    this.element.className = 'approval-bar hidden';
    this.onDecision = onDecision;
    container.appendChild(this.element);
  }

  public promptApproval(requestId: string, toolName: string, args: Record<string, unknown>): void {
    this.element.className = 'approval-bar visible';
    this.element.innerHTML = `
      <div class="approval-header">Approval Required: <strong>${toolName}</strong></div>
      <pre class="approval-args">${JSON.stringify(args, null, 2).slice(0, 200)}</pre>
      <div class="approval-actions">
        <button class="btn btn-allow">Allow</button>
        <button class="btn btn-deny">Deny</button>
      </div>
    `;

    const allowBtn = this.element.querySelector('.btn-allow');
    const denyBtn = this.element.querySelector('.btn-deny');

    allowBtn?.addEventListener('click', () => {
      this.hide();
      this.onDecision?.(requestId, true);
    });

    denyBtn?.addEventListener('click', () => {
      this.hide();
      this.onDecision?.(requestId, false);
    });
  }

  public hide(): void {
    this.element.className = 'approval-bar hidden';
    this.element.innerHTML = '';
  }
}
