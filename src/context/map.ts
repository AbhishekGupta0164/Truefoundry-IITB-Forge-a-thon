/**
 * src/context/map.ts
 *
 * Context Map (Stage 5 / Step 5 of Task T3)
 * Builds its output strictly from the ContextLedger.
 */

import { RetrievedBudgetSnapshot } from './budget';
import { ContextLedger, defaultContextLedger } from './ledger';

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
  constructor(private readonly ledger: ContextLedger = defaultContextLedger) {}

  public recordRead(entry: Omit<ContextMapEntry, 'timestamp'>): void {
    const start = entry.lineStart || 1;
    const end = entry.lineEnd || start;
    const estimatedTokens = Math.ceil((end - start + 1) * 8);
    this.ledger.recordRead(entry.path, start, end, entry.reason || 'inspection', estimatedTokens);
  }

  public recordSkipped(path: string, reason = 'matched but not read'): void {
    this.ledger.recordSkipped(path, reason);
  }

  public getEntries(): ContextMapEntry[] {
    return this.ledger.getEntriesByKind('read').map(e => ({
      path: e.path,
      lineStart: e.startLine || 1,
      lineEnd: e.endLine || 1,
      reason: e.reason,
      timestamp: e.timestamp
    }));
  }

  public getSkipped(): SkippedCandidate[] {
    this.ledger.evaluateSkipped();
    return this.ledger.getEntriesByKind('skipped').map(e => ({
      path: e.path,
      reason: e.reason,
      timestamp: e.timestamp
    }));
  }

  public getSummary(budgetSnapshot?: RetrievedBudgetSnapshot): string {
    this.ledger.evaluateSkipped();
    const reads = this.ledger.getEntriesByKind('read');
    const skipped = this.ledger.getEntriesByKind('skipped');

    const lines = ['=== Context Map ==='];
    if (reads.length === 0) {
      lines.push('(No files consulted yet)');
    } else {
      for (const e of reads) {
        lines.push(`• ${e.path} [L${e.startLine}-${e.endLine}] : ${e.reason || 'inspection'}`);
      }
    }

    if (skipped.length > 0) {
      lines.push('--- Skipped Candidates ---');
      for (const s of skipped) {
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

  public buildMap(budgetSnapshot?: RetrievedBudgetSnapshot): string {
    return this.getSummary(budgetSnapshot);
  }

  public getRelevantFiles(): string[] {
    return Array.from(new Set(this.ledger.getEntries().map((e) => e.path)));
  }

  public clear(): void {
    this.ledger.clear();
  }
}

export const defaultContextMap = new ContextMap();
