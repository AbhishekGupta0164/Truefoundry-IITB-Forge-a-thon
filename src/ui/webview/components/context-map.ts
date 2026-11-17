import { ContextEntry } from '../../../shared/types';

export class ContextMapComponent {
  private element: HTMLElement;

  constructor(container: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'context-map';
    container.appendChild(this.element);
  }

  public update(entries: ContextEntry[]): void {
    this.element.innerHTML = '<h4>Retrieved Context Map (Task B)</h4>';
    if (entries.length === 0) {
      this.element.innerHTML += '<p class="empty">No context consulted yet</p>';
      return;
    }

    // Graph / Flow visualization showing relationship sequence e.g. cli.py -> test_cli.py -> cli.rst
    const graphContainer = document.createElement('div');
    graphContainer.className = 'context-graph-flow';
    const flowItems = entries.map((e, idx) => {
      const cleanName = e.uri.split(/[/\\]/).pop() || e.uri;
      const arrow = idx < entries.length - 1 ? '<span class="flow-arrow">â†’</span>' : '';
      return `<span class="flow-node" title="${e.uri} (${e.metadata?.reason || e.type})">${cleanName}</span> ${arrow}`;
    });
    graphContainer.innerHTML = `<div class="flow-title">Navigation Flow:</div><div class="flow-chain">${flowItems.join(' ')}</div>`;
    this.element.appendChild(graphContainer);

    const list = document.createElement('ul');
    list.className = 'context-entries-list';
    for (const e of entries) {
      const li = document.createElement('li');
      li.className = `entry entry-${e.type}`;
      const reasonBadge = e.metadata?.reason ? `<span class="entry-reason">"<em>${e.metadata.reason}</em>"</span>` : '';
      li.innerHTML = `<strong>[${e.type}]</strong> <span class="entry-uri">${e.uri}</span> ${e.tokenCount ? `<span class="entry-tokens">(~${e.tokenCount} tokens)</span>` : ''} ${reasonBadge}`;
      list.appendChild(li);
    }
    this.element.appendChild(list);
  }

  public clear(): void {
    this.element.innerHTML = '';
  }
}
