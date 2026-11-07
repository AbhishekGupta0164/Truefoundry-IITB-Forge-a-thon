import { describe, expect, it, beforeEach } from 'vitest';
import { ContextBudgetTracker } from '../../src/context/budget';
import { BudgetReachedError } from '../../src/shared/errors';

describe('Retrieved Context Budget Enforcement (B1 Anchor)', () => {
  let tracker: ContextBudgetTracker;

  beforeEach(() => {
    tracker = new ContextBudgetTracker();
  });

  it('permits up to 8 distinct files and rejects the 9th', () => {
    for (let i = 1; i <= 8; i++) {
      tracker.recordFileRead(`src/file${i}.py`, 10, 50);
    }
    expect(tracker.getSnapshot().filesConsulted).toBe(8);

    // Reading an existing file again is permitted
    tracker.recordFileRead('src/file1.py', 10, 50);
    expect(tracker.getSnapshot().filesConsulted).toBe(8);

    // Reading a 9th file throws BudgetReachedError
    expect(() => {
      tracker.recordFileRead('src/file9.py', 10, 50);
    }).toThrow(BudgetReachedError);
  });

  it('rejects reads exceeding 200 lines per file', () => {
    expect(() => {
      tracker.recordFileRead('src/large.py', 201, 500);
    }).toThrow(BudgetReachedError);
  });

  it('tracks search hits and throws on the 31st hit', () => {
    tracker.recordSearch(20);
    tracker.recordSearch(10);
    expect(tracker.getSnapshot().searchHits).toBe(30);

    expect(() => {
      tracker.recordSearch(1);
    }).toThrow(BudgetReachedError);
  });

  it('enforces 12,000 token limit on retrieved context', () => {
    tracker.recordFileRead('src/chunk1.py', 50, 6000);
    tracker.recordFileRead('src/chunk2.py', 50, 6000);
    expect(tracker.getSnapshot().retrievedTokens).toBe(12000);

    expect(() => {
      tracker.recordFileRead('src/chunk3.py', 10, 100);
    }).toThrow(BudgetReachedError);
  });
});
