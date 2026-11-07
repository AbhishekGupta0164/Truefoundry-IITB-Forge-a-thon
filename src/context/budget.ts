import { RETRIEVED_CONTEXT_BUDGET, TOTAL_RUN_SAFETY_CAP } from '../shared/constants';
import { BudgetReachedError } from '../shared/errors';

export interface RetrievedBudgetSnapshot {
  retrievedTokens: number;
  maxRetrievedTokens: number;
  filesConsulted: number;
  maxFiles: number;
  searchHits: number;
  maxSearchHits: number;
  isExceeded: boolean;
  exceededReason?: string;
}

export class ContextBudgetTracker {
  private consultedFiles = new Set<string>();
  private retrievedTokens = 0;
  private searchHits = 0;

  constructor(
    private readonly limits = RETRIEVED_CONTEXT_BUDGET,
    private readonly safetyCap = TOTAL_RUN_SAFETY_CAP
  ) {}

  public recordFileRead(filePath: string, lineCount: number, tokenCount?: number): void {
    if (lineCount > this.limits.MAX_LINES_PER_READ) {
      throw new BudgetReachedError(
        `Read of ${filePath} (${lineCount} lines) exceeds per-read limit of ${this.limits.MAX_LINES_PER_READ} lines`
      );
    }

    if (!this.consultedFiles.has(filePath) && this.consultedFiles.size >= this.limits.MAX_FILES) {
      throw new BudgetReachedError(
        `File budget exceeded: cannot inspect '${filePath}'. Already consulted ${this.limits.MAX_FILES} files.`
      );
    }

    this.consultedFiles.add(filePath);

    // Approximate ~4 chars per token if tokenCount not explicitly supplied
    const tokens = tokenCount ?? Math.ceil(lineCount * 8);
    this.retrievedTokens += tokens;

    if (this.retrievedTokens > this.limits.MAX_TOKENS) {
      throw new BudgetReachedError(
        `Retrieved context token budget exceeded: ${this.retrievedTokens} > ${this.limits.MAX_TOKENS} tokens`
      );
    }
  }

  public recordSearch(hitCount: number): void {
    this.searchHits += hitCount;
    if (this.searchHits > this.limits.MAX_SEARCH_HITS) {
      throw new BudgetReachedError(
        `Search hits budget exceeded: ${this.searchHits} > ${this.limits.MAX_SEARCH_HITS} hits`
      );
    }
  }

  public getSnapshot(): RetrievedBudgetSnapshot {
    let exceeded = false;
    let reason: string | undefined;

    if (this.retrievedTokens > this.limits.MAX_TOKENS) {
      exceeded = true;
      reason = `Exceeded max retrieved tokens (${this.retrievedTokens}/${this.limits.MAX_TOKENS})`;
    } else if (this.consultedFiles.size > this.limits.MAX_FILES) {
      exceeded = true;
      reason = `Exceeded max files (${this.consultedFiles.size}/${this.limits.MAX_FILES})`;
    } else if (this.searchHits > this.limits.MAX_SEARCH_HITS) {
      exceeded = true;
      reason = `Exceeded max search hits (${this.searchHits}/${this.limits.MAX_SEARCH_HITS})`;
    }

    return {
      retrievedTokens: this.retrievedTokens,
      maxRetrievedTokens: this.limits.MAX_TOKENS,
      filesConsulted: this.consultedFiles.size,
      maxFiles: this.limits.MAX_FILES,
      searchHits: this.searchHits,
      maxSearchHits: this.limits.MAX_SEARCH_HITS,
      isExceeded: exceeded,
      exceededReason: reason
    };
  }

  public reset(): void {
    this.consultedFiles.clear();
    this.retrievedTokens = 0;
    this.searchHits = 0;
  }
}
