export interface ComposerCallbacks {
  onRun: (prompt: string) => void;
  onCancel: () => void;
  onUndoTask: () => void;
}

/**
 * Prompt box for agent mode. The text is sent exactly as typed; @file / @symbol mentions
 * are resolved by the extension. Ctrl/Cmd+Enter runs, Cancel stops a run mid-flight.
 */
export class ComposerComponent {
  private textarea: HTMLTextAreaElement;
  private runBtn: HTMLButtonElement;
  private cancelBtn: HTMLButtonElement;
  private undoBtn: HTMLButtonElement;

  constructor(container: HTMLElement, callbacks: ComposerCallbacks) {
    const root = document.createElement('div');
    root.className = 'composer';

    this.textarea = document.createElement('textarea');
    this.textarea.className = 'composer-input';
    this.textarea.rows = 4;
    this.textarea.placeholder = 'Describe the change. Mention code with @src/path/file.py or @symbol:name. Ctrl+Enter to run.';
    this.textarea.setAttribute('aria-label', 'Agent instruction');

    const actions = document.createElement('div');
    actions.className = 'composer-actions';
    this.runBtn = this.button('Run', 'btn btn-allow', () => {
      const prompt = this.textarea.value.trim();
      if (prompt) callbacks.onRun(prompt);
    });
    this.cancelBtn = this.button('Cancel', 'btn btn-deny', callbacks.onCancel);
    this.undoBtn = this.button('Undo whole task', 'btn btn-undo-all', callbacks.onUndoTask);
    actions.append(this.runBtn, this.cancelBtn, this.undoBtn);

    this.textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.runBtn.click();
      }
    });

    root.append(this.textarea, actions);
    container.appendChild(root);
    this.setRunning(false);
  }

  private button(label: string, className: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = className;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  public setRunning(running: boolean): void {
    this.runBtn.disabled = running;
    this.textarea.disabled = running;
    this.cancelBtn.disabled = !running;
  }

  public setPrompt(text: string): void {
    this.textarea.value = text;
  }
}
