import { ContextEntry } from '../../../shared/types';

export class ContextMapComponent {
  private element: HTMLElement;

  constructor(container: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'context-map';
    container.appendChild(this.element);
  }

  public update(entries: ContextEntry[]): void {
    this.element.innerHTML = '<h4>Retrieved Context Map</h4>';
    if (entries.length === 0) {
      this.element.innerHTML += '<p class="empty">No context consulted yet</p>';
      return;
    }

    const list = document.createElement('ul');
    for (const e of entries) {
      const li = document.createElement('li');
      li.className = `entry entry-${e.type}`;
      li.innerHTML = `<strong>[${e.type}]</strong> ${e.uri} ${e.tokenCount ? `(~${e.tokenCount} tokens)` : ''}`;
      list.appendChild(li);
    }
    this.element.appendChild(list);
  }

  public clear(): void {
    this.element.innerHTML = '';
  }
}
