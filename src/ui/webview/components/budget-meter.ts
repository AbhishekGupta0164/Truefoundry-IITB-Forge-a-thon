import { BudgetState } from '../../../shared/types';

export class BudgetMeterComponent {
  private element: HTMLElement;

  constructor(container: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'budget-meter';
    container.appendChild(this.element);
  }

  public update(budget: BudgetState): void {
    const pct = Math.min(100, Math.round((budget.usedTokens / (budget.maxTokens || 1)) * 100));
    this.element.innerHTML = `
      <div class="budget-label">
        <span>Budget: ${budget.usedTokens} / ${budget.maxTokens} tokens</span>
        <span>${pct}%</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill ${pct > 90 ? 'critical' : pct > 75 ? 'warn' : ''}" style="width: ${pct}%"></div>
      </div>
    `;
  }

  public clear(): void {
    this.element.innerHTML = '';
  }
}
