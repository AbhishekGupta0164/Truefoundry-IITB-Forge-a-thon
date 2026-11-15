import { RetrievedBudgetSnapshot } from './budget';

export interface ContextMapEntry {
  path: string;
  lineStart: number;
  lineEnd: number;
  reason?: string;
  timestamp: number;
}

export interface SkippedCandidate {
  path: string;
  reason: string;
  timestamp: number;
}

export class ContextMap {
  private entries: ContextMapEntry[] = [];
  private skipped: SkippedCandidate[] = [];

  public recordRead(entry: Omit<ContextMapEntry, 'timestamp'>): void {
    this.entries.push({
      ...entry,
      timestamp: Date.now()
    });
  }

  public recordSkipped(path: string, reason: string): void {
    this.skipped.push({
      path,
      reason,
      timestamp: Date.now()
    });
  }

  public getEntries(): ContextMapEntry[] {
    return [...this.entries];
  }

  public getSkipped(): SkippedCandidate[] {
    return [...this.skipped];
  }

  public getSummary(budgetSnapshot?: RetrievedBudgetSnapshot): string {
    const lines = ['=== Context Map ==='];
    if (this.entries.length === 0) {
      lines.push('(No files consulted yet)');
    } else {
      for (const e of this.entries) {
        lines.push(`• ${e.path} [L${e.lineStart}-${e.lineEnd}] : ${e.reason || 'inspection'}`);
      }
    }

    if (this.skipped.length > 0) {
      lines.push('--- Skipped Candidates ---');
      for (const s of this.skipped) {
        lines.push(`• ${s.path} (${s.reason})`);
      }
    }

    if (budgetSnapshot) {
      lines.push(
        `--- Budget Meter: ${budgetSnapshot.retrievedTokens}/${budgetSnapshot.maxRetrievedTokens} tokens | ${budgetSnapshot.filesConsulted}/${budgetSnapshot.maxFiles} files ---`
      );
    }

    return lines.join('\n');
  }

  public clear(): void {
    this.entries = [];
    this.skipped = [];
  }
}

export const defaultContextMap = new ContextMap();
