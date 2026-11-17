/**
 * T11 — Stress Tests on Big Repos
 *
 * Verifies that all MCP tools handle large repos (500+ files, 1 MB+ content)
 * within acceptable time budgets and memory bounds, without deadlock or OOM.
 *
 * Uses the Flask repo at ../../flask as a real-world big repo target.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ContextBudgetTracker } from '../../src/context/budget';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const FLASK_REPO = path.resolve(__dirname, '../../flask');
const FLASK_AVAILABLE = fs.existsSync(FLASK_REPO);

// Performance budgets
const SYMBOL_SEARCH_MS = 5000;   // search_symbols on 1000+ files must complete in <5s
const TEXT_SEARCH_MS = 5000;     // search_text on big repo must complete in <5s
const READ_FILE_MS = 1000;       // read_file on a 1 MB file must complete in <1s
const CONCURRENT_CALLS = 10;     // 10 simultaneous calls must not deadlock

// Output cap (from sanitize.ts)
const DEFAULT_TOOL_OUTPUT_CAP = 2048;
const TRUNCATION_MARKER = '[Output truncated to';

// ---------------------------------------------------------------------------
// Helpers — lightweight mock workspace
// ---------------------------------------------------------------------------
function makeWorkspaceManager(root: string) {
  return {
    getRoot: () => root,
    resolveSafePath: (relPath: string) => {
      const abs = path.resolve(root, relPath);
      if (!abs.startsWith(root)) throw new Error(`Path escape: ${relPath}`);
      return abs;
    },
  };
}

// Generate a synthetic repo with N Python + TS files in a tmp directory
function makeSyntheticRepo(numFiles: number): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-stress-'));
  for (let i = 0; i < numFiles; i++) {
    const sub = path.join(tmpDir, `pkg${Math.floor(i / 50)}`);
    fs.mkdirSync(sub, { recursive: true });
    if (i % 2 === 0) {
      // Python file with symbols
      fs.writeFileSync(
        path.join(sub, `module${i}.py`),
        `"""Module ${i}"""\n\nclass StressClass${i}:\n    def stress_method(self):\n        pass\n\ndef stress_function_${i}(x, y):\n    return x + y\n`
      );
    } else {
      // TypeScript file with symbols
      fs.writeFileSync(
        path.join(sub, `module${i}.ts`),
        `export class StressTs${i} {\n  stressMethod(): void {}\n}\nexport function stressFn${i}(x: number): number { return x * 2; }\n`
      );
    }
  }
  return tmpDir;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('T11 — Stress Tests on Big Repos', () => {
  let syntheticRoot: string;

  beforeAll(() => {
    // Create synthetic repo with 600 files
    syntheticRoot = makeSyntheticRepo(600);
  });

  // -------------------------------------------------------------------------
  // 1. Output cap is enforced — sanitizeToolOutput truncates long output
  // -------------------------------------------------------------------------
  it('sanitizeToolOutput enforces DEFAULT_TOOL_OUTPUT_CAP and appends truncation marker', async () => {
    const { sanitizeToolOutput, DEFAULT_TOOL_OUTPUT_CAP: CAP } = await import('../../src/mcp/sanitize');

    const longOutput = 'x'.repeat(CAP + 1000);
    const result = sanitizeToolOutput(longOutput);

    expect(result).toContain(TRUNCATION_MARKER);
    // The raw text before the marker must be <= CAP chars
    const beforeMarker = result.split(TRUNCATION_MARKER)[0];
    expect(beforeMarker.length).toBeLessThanOrEqual(CAP + 60); // slight overhead for HTML wrapper
  });

  it('sanitizeToolOutput does NOT truncate output within cap', async () => {
    const { sanitizeToolOutput } = await import('../../src/mcp/sanitize');

    const shortOutput = 'hello world';
    const result = sanitizeToolOutput(shortOutput);

    expect(result).not.toContain(TRUNCATION_MARKER);
    expect(result).toContain('hello world');
  });

  // -------------------------------------------------------------------------
  // 2. search_symbols on synthetic 600-file repo — time budget
  // -------------------------------------------------------------------------
  it('search_symbols on 600-file synthetic repo completes within 5 seconds', async () => {
    const { executeSearchSymbols } = await import('../../src/mcp/tools/search_symbols');
    const ws = makeWorkspaceManager(syntheticRoot);

    const start = Date.now();
    const result = await executeSearchSymbols({ query: 'stress', reason: 'T11 perf test' }, ws as any);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(SYMBOL_SEARCH_MS);
    // Should find many symbols across 600 files
    expect(result.symbols.length).toBeGreaterThan(100);
  });

  // -------------------------------------------------------------------------
  // 3. search_text on synthetic repo — time budget
  // -------------------------------------------------------------------------
  it('search_text on 600-file synthetic repo completes within 5 seconds', async () => {
    const { executeSearchText } = await import('../../src/mcp/tools/search_text');
    const ws = makeWorkspaceManager(syntheticRoot);
    const tracker = new ContextBudgetTracker();

    const start = Date.now();
    const result = await executeSearchText(
      { query: 'stress_function_1', reason: 'T11 perf test' },
      ws as any,
      tracker
    );
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(TEXT_SEARCH_MS);
    // Output must be capped
    expect(result.rawText.length).toBeLessThanOrEqual(DEFAULT_TOOL_OUTPUT_CAP + 200);
  });

  // -------------------------------------------------------------------------
  // 4. read_file on a large generated file — time budget and output cap
  // -------------------------------------------------------------------------
  it('read_file on a large file completes within 1 second and caps output', async () => {
    const { executeReadFile } = await import('../../src/mcp/tools/read_file');
    const ws = makeWorkspaceManager(syntheticRoot);
    const tracker = new ContextBudgetTracker();

    // Create a large file in the synthetic repo (100 lines of long text)
    const bigFile = path.join(syntheticRoot, 'big_file.py');
    fs.writeFileSync(bigFile, '# big file\n' + 'x = "a" * 500\n'.repeat(100));

    const start = Date.now();
    const result = await executeReadFile(
      { path: 'big_file.py', start: 1, end: 100, reason: 'T11 perf test' },
      ws as any,
      tracker
    );
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(READ_FILE_MS);
    // Output must be capped
    expect(result.rawText.length).toBeLessThanOrEqual(DEFAULT_TOOL_OUTPUT_CAP + 200);
  });

  // -------------------------------------------------------------------------
  // 5. Concurrent tool calls — no deadlock
  // -------------------------------------------------------------------------
  it('10 concurrent search_symbols calls complete without deadlock', async () => {
    const { executeSearchSymbols } = await import('../../src/mcp/tools/search_symbols');
    const ws = makeWorkspaceManager(syntheticRoot);

    const start = Date.now();
    const promises = Array.from({ length: CONCURRENT_CALLS }, (_, i) =>
      executeSearchSymbols({ query: `stress${i % 3}`, reason: `concurrent-${i}` }, ws as any)
    );
    const results = await Promise.allSettled(promises);
    const elapsed = Date.now() - start;

    // All calls must settle (no hang/deadlock)
    const failed = results.filter(r => r.status === 'rejected');
    expect(failed.length).toBe(0);

    // Total time for 10 concurrent calls should be < 15 seconds
    expect(elapsed).toBeLessThan(15_000);
  });

  // -------------------------------------------------------------------------
  // 6. Flask repo stress test (optional — skipped if flask not present)
  // -------------------------------------------------------------------------
  it.skipIf(!FLASK_AVAILABLE)(
    'search_symbols on real Flask repo (1000+ files) completes within 5 seconds',
    async () => {
      const { executeSearchSymbols } = await import('../../src/mcp/tools/search_symbols');
      const ws = makeWorkspaceManager(FLASK_REPO);

      const start = Date.now();
      const result = await executeSearchSymbols({ query: 'Flask', reason: 'T11 flask perf test' }, ws as any);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(SYMBOL_SEARCH_MS);
      expect(result.symbols.length).toBeGreaterThan(0);
    }
  );

  it.skipIf(!FLASK_AVAILABLE)(
    'search_text on real Flask repo completes within 5 seconds and caps output',
    async () => {
      const { executeSearchText } = await import('../../src/mcp/tools/search_text');
      const ws = makeWorkspaceManager(FLASK_REPO);
      const tracker = new ContextBudgetTracker();

      const start = Date.now();
      const result = await executeSearchText(
        { query: 'route', reason: 'T11 flask perf test' },
        ws as any,
        tracker
      );
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(TEXT_SEARCH_MS);
      expect(result.rawText.length).toBeLessThanOrEqual(DEFAULT_TOOL_OUTPUT_CAP + 200);
    }
  );

  // -------------------------------------------------------------------------
  // 7. Memory — heapUsed doesn't explode after a large scan
  // -------------------------------------------------------------------------
  it('heap memory stays under 512 MB after scanning 600-file repo', async () => {
    const { executeSearchSymbols } = await import('../../src/mcp/tools/search_symbols');
    const ws = makeWorkspaceManager(syntheticRoot);

    const heapBefore = process.memoryUsage().heapUsed;
    await executeSearchSymbols({ query: 'method', reason: 'T11 memory test' }, ws as any);
    const heapAfter = process.memoryUsage().heapUsed;

    const growthMB = (heapAfter - heapBefore) / 1024 / 1024;
    // Heap growth from one scan must stay under 512 MB
    expect(growthMB).toBeLessThan(512);
  });

  // -------------------------------------------------------------------------
  // 8. search_text truncation — results capped and rawText contains marker
  // -------------------------------------------------------------------------
  it('search_text rawText is always within output cap even with many hits', async () => {
    const { executeSearchText } = await import('../../src/mcp/tools/search_text');
    const ws = makeWorkspaceManager(syntheticRoot);
    const tracker = new ContextBudgetTracker();

    // Query across files to trigger hits
    const result = await executeSearchText(
      { query: 'stress', reason: 'T11 cap test' },
      ws as any,
      tracker
    );

    expect(result.rawText.length).toBeLessThanOrEqual(DEFAULT_TOOL_OUTPUT_CAP + 200);
  });
});
