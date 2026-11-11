export interface ToolTimelineItem {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status: 'running' | 'completed' | 'error';
  output?: string;
  timestamp: number;
}

export class ToolTimelineComponent {
  private element: HTMLElement;
  private items = new Map<string, HTMLElement>();

  constructor(container: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'tool-timeline';
    container.appendChild(this.element);
  }

  public addToolCall(id: string, name: string, args: Record<string, unknown>): void {
    const itemEl = document.createElement('div');
    itemEl.className = 'tool-item running';
    itemEl.id = `tool-${id}`;

    const header = document.createElement('div');
    header.className = 'tool-header';
    header.textContent = `⚙️ ${name} (${Object.keys(args).join(', ')})`;

    itemEl.appendChild(header);
    this.element.appendChild(itemEl);
    this.items.set(id, itemEl);
  }

  public completeToolCall(id: string, success: boolean, output?: string): void {
    const itemEl = this.items.get(id);
    if (!itemEl) return;

    itemEl.className = `tool-item ${success ? 'completed' : 'error'}`;
    if (output) {
      const outEl = document.createElement('pre');
      outEl.className = 'tool-output';
      outEl.textContent = output.slice(0, 300);
      itemEl.appendChild(outEl);
    }
  }

  public clear(): void {
    this.element.innerHTML = '';
    this.items.clear();
  }
}
