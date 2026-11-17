/**
 * src/context/ledger.ts
 *
 * Context Ledger & Live Context Map — Step 1 & 2 (Task T3)
 * Tracks all tool reads, searches, and skipped candidate files.
 * Enforces deduplication on (tool + path + range), emitting context_update events.
 */

import * as crypto from 'crypto';
import { RETRIEVED_CONTEXT_BUDGET } from '../shared/constants';

export type LedgerEntryKind = 'read' | 'searched' | 'skipped';

export interface LedgerEntry {
  id: string;
  tool: string;
  path: string;
  startLine?: number;
  endLine?: number;
  reason: string;
  estimatedTokens: number;
  kind: LedgerEntryKind;
  timestamp: number;
}

export interface BudgetMeterSnapshot {
  tokens: number;
  maxTokens: number;
  files: number;
  maxFiles: number;
  hits: number;
  maxHits: number;
  maxLinesPerRead: number;
}

export type ContextUpdateListener = (entry: LedgerEntry, ledger: ContextLedger) => void;

export class ContextLedger {
  private entries: LedgerEntry[] = [];
  private seenKeys = new Map<string, LedgerEntry>();
  private listeners: ContextUpdateListener[] = [];
  private searchedFiles = new Map<string, { tool: string; reason: string }>();
  private readFiles = new Set<string>();

  public onContextUpdate(listener: ContextUpdateListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx !== -1) {
        this.listeners.splice(idx, 1);
      }
    };
  }

  private notify(entry: LedgerEntry): void {
    for (const listener of this.listeners) {
      try {
        listener(entry, this);
      } catch (err) {
        console.error('ContextLedger listener error:', err);
      }
    }
  }

  public getDedupKey(tool: string, path: string, startLine?: number, endLine?: number): string {
    const range = startLine !== undefined && endLine !== undefined ? `${startLine}-${endLine}` : 'all';
    return `${tool}:${path}:${range}`;
  }

  public checkDuplicate(tool: string, path: string, startLine?: number, endLine?: number): LedgerEntry | undefined {
    const key = this.getDedupKey(tool, path, startLine, endLine);
    return this.seenKeys.get(key);
  }

  public recordEntry(params: {
    tool: string;
    path: string;
    startLine?: number;
    endLine?: number;
    reason: string;
    estimatedTokens: number;
    kind: LedgerEntryKind;
  }): LedgerEntry {
    const entry: LedgerEntry = {
      id: `ledger-${crypto.randomUUID()}`,
      tool: params.tool,
      path: params.path,
      startLine: params.startLine,
      endLine: params.endLine,
      reason: params.reason,
      estimatedTokens: params.estimatedTokens,
      kind: params.kind,
      timestamp: Date.now()
    };

    this.entries.push(entry);
    const key = this.getDedupKey(entry.tool, entry.path, entry.startLine, entry.endLine);
    this.seenKeys.set(key, entry);

    if (entry.kind === 'read') {
      this.readFiles.add(entry.path);
    } else if (entry.kind === 'searched') {
      this.searchedFiles.set(entry.path, { tool: entry.tool, reason: entry.reason });
    }

    this.notify(entry);
    return entry;
  }

  public recordRead(
    path: string,
    startLine: number,
    endLine: number,
    reason: string,
    estimatedTokens: number,
    tool = 'read_file'
  ): LedgerEntry {
    return this.recordEntry({
      tool,
      path,
      startLine,
      endLine,
      reason,
      estimatedTokens,
      kind: 'read'
    });
  }

  public recordSearched(
    path: string,
    reason: string,
    tool = 'search_text',
    estimatedTokens = 0
  ): LedgerEntry {
    return this.recordEntry({
      tool,
      path,
      reason,
      estimatedTokens,
      kind: 'searched'
    });
  }

  public recordSkipped(path: string, reason = 'matched but not read', tool = 'search'): LedgerEntry {
    return this.recordEntry({
      tool,
      path,
      reason,
      estimatedTokens: 0,
      kind: 'skipped'
    });
  }

  /**
   * When a search returns files that are never read, marks them as skipped
   * with the reason 'matched but not read'.
   */
  public evaluateSkipped(): LedgerEntry[] {
    const newlySkipped: LedgerEntry[] = [];
    for (const [filePath, info] of this.searchedFiles.entries()) {
      if (!this.readFiles.has(filePath)) {
        const skippedKey = this.getDedupKey('skipped', filePath);
        if (!this.seenKeys.has(skippedKey)) {
          const entry: LedgerEntry = {
            id: `ledger-${crypto.randomUUID()}`,
            tool: info.tool,
            path: filePath,
            reason: 'matched but not read',
            estimatedTokens: 0,
            kind: 'skipped',
            timestamp: Date.now()
          };
          this.entries.push(entry);
          this.seenKeys.set(skippedKey, entry);
          newlySkipped.push(entry);
        }
      }
    }
    return newlySkipped;
  }

  public getEntries(): LedgerEntry[] {
    return [...this.entries];
  }

  public getEntriesByKind(kind: LedgerEntryKind): LedgerEntry[] {
    return this.entries.filter(e => e.kind === kind);
  }

  public getGroups(): { read: LedgerEntry[]; searched: LedgerEntry[]; skipped: LedgerEntry[] } {
    this.evaluateSkipped();
    return {
      read: this.getEntriesByKind('read'),
      searched: this.getEntriesByKind('searched'),
      skipped: this.getEntriesByKind('skipped').filter((sk) => !this.readFiles.has(sk.path))
    };
  }

  public getBudgetMeter(totalTokens?: number, searchHits?: number): BudgetMeterSnapshot {
    const calculatedTokens =
      totalTokens !== undefined
        ? totalTokens
        : this.entries.reduce((sum, e) => sum + (e.estimatedTokens || 0), 0);
    const calculatedHits =
      searchHits !== undefined ? searchHits : this.searchedFiles.size;
    return {
      tokens: calculatedTokens,
      maxTokens: RETRIEVED_CONTEXT_BUDGET.MAX_TOKENS, // 12,000
      files: this.readFiles.size,
      maxFiles: RETRIEVED_CONTEXT_BUDGET.MAX_FILES, // 8
      hits: calculatedHits,
      maxHits: RETRIEVED_CONTEXT_BUDGET.MAX_SEARCH_HITS, // 30
      maxLinesPerRead: RETRIEVED_CONTEXT_BUDGET.MAX_LINES_PER_READ // 200
    };
  }

  public clear(): void {
    this.entries = [];
    this.seenKeys.clear();
    this.searchedFiles.clear();
    this.readFiles.clear();
  }
}

export const defaultContextLedger = new ContextLedger();
