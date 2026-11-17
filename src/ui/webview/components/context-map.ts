import { ContextEntry } from '../../../shared/types';
import { WebviewBudgetMeter, WebviewContextGroupItem } from '../../messages';

export class ContextMapComponent {
  private element: HTMLElement;

  constructor(container: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'context-map';
    container.appendChild(this.element);
  }

  public update(
    entries: ContextEntry[],
    groups?: {
      read: WebviewContextGroupItem[];
      searched: WebviewContextGroupItem[];
      skipped: WebviewContextGroupItem[];
    },
    budgetMeter?: WebviewBudgetMeter
  ): void {
    this.element.innerHTML = '<h4>Retrieved Context Map</h4>';

    // Show numbers: 12,000 tokens, 8 files, 30 hits, 200 lines per read (Step 7)
    const meter = budgetMeter || {
      tokens: 0,
      maxTokens: 12000,
      files: 0,
      maxFiles: 8,
      hits: 0,
      maxHits: 30,
      maxLinesPerRead: 200
    };

    const meterDiv = document.createElement('div');
    meterDiv.className = 'context-budget-meter';
    meterDiv.innerHTML = `
      <div class="budget-limits-row" style="font-size: 0.85em; opacity: 0.85; margin-bottom: 8px;">
        <span><strong>Budget Limits:</strong> ${meter.maxTokens.toLocaleString()} tokens | ${meter.maxFiles} files | ${meter.maxHits} hits | ${meter.maxLinesPerRead} lines/read</span>
      </div>
      <div class="budget-usage-row" style="font-size: 0.85em; margin-bottom: 12px;">
        <span><strong>Usage:</strong> ${meter.tokens.toLocaleString()} / ${meter.maxTokens.toLocaleString()} tokens | ${meter.files} / ${meter.maxFiles} files | ${meter.hits} / ${meter.maxHits} hits</span>
      </div>
    `;
    this.element.appendChild(meterDiv);

    if (groups) {
      // Render the three groups: Read, Searched, Skipped (Step 6)
      this.renderGroup('Read', groups.read, 'read');
      this.renderGroup('Searched', groups.searched, 'searched');
      this.renderGroup('Skipped', groups.skipped, 'skipped');
      return;
    }
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

  private renderGroup(title: string, items: WebviewContextGroupItem[], kind: string): void {
    const groupDiv = document.createElement('div');
    groupDiv.className = `context-group context-group-${kind}`;
    groupDiv.innerHTML = `<h5>${title} (${items.length})</h5>`;

    if (items.length === 0) {
      groupDiv.innerHTML += '<p class="empty" style="font-size: 0.8em; opacity: 0.7;">(None)</p>';
    } else {
      const ul = document.createElement('ul');
      ul.style.listStyle = 'none';
      ul.style.paddingLeft = '0';
      for (const item of items) {
        const li = document.createElement('li');
        li.style.fontSize = '0.85em';
        li.style.marginBottom = '4px';
        const rangeStr = item.lineRange ? ` [${item.lineRange}]` : '';
        li.innerHTML = `• <code>${item.path}</code>${rangeStr} : <em>${item.reason}</em>`;
        ul.appendChild(li);
      }
      groupDiv.appendChild(ul);
    }
    this.element.appendChild(groupDiv);
  }

  public clear(): void {
    this.element.innerHTML = '';
  }
}
