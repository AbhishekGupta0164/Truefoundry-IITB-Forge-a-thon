export type RunState = 'idle' | 'running' | 'awaiting_approval' | 'completed' | 'cancelled' | 'failed';

const LABELS: Record<RunState, string> = {
  idle: 'Ready',
  running: 'Running…',
  awaiting_approval: 'Waiting for your approval',
  completed: 'Done',
  cancelled: 'Cancelled',
  failed: 'Failed'
};

/** Run state plus any error messages, always as plain text. */
export class StatusLineComponent {
  private stateEl: HTMLElement;
  private errorsEl: HTMLElement;

  constructor(container: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'status-line';
    this.stateEl = document.createElement('div');
    this.stateEl.className = 'status-state';
    this.errorsEl = document.createElement('div');
    this.errorsEl.className = 'status-errors';
    root.append(this.stateEl, this.errorsEl);
    container.appendChild(root);
    this.setState('idle');
  }

  public setState(state: RunState): void {
    this.stateEl.textContent = LABELS[state];
    this.stateEl.dataset.state = state;
  }

  public addError(message: string): void {
    const el = document.createElement('div');
    el.className = 'status-error';
    el.setAttribute('role', 'alert');
    el.textContent = message;
    this.errorsEl.appendChild(el);
  }

  public clearErrors(): void {
    this.errorsEl.textContent = '';
  }
}
