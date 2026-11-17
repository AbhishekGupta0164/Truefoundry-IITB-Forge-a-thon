import path from 'path';
import { describe, expect, it, beforeEach } from 'vitest';
import { ContextLedger, defaultContextLedger } from '../../src/context/ledger';
import { ContextMap } from '../../src/context/map';
import { ContextBudgetTracker } from '../../src/context/budget';
import { executeReadFile } from '../../src/mcp/tools/read_file';
import { executeSearchText } from '../../src/mcp/tools/search_text';
import { WorkspaceManager } from '../../src/mcp/workspace';
import { BudgetReachedError } from '../../src/shared/errors';
import { AgentPanelProvider } from '../../src/ui/panel';

describe('T3: Context Ledger & Live Context Map', () => {
  let ledger: ContextLedger;
  let tracker: ContextBudgetTracker;
  let wsManager: WorkspaceManager;
  const fixtureDir = path.resolve(__dirname, '../fixtures/mini-repo');

  beforeEach(() => {
    ledger = new ContextLedger();
    tracker = new ContextBudgetTracker();
    wsManager = new WorkspaceManager(fixtureDir);
    defaultContextLedger.clear();
  });

  describe('Ledger recording and deduplication', () => {
    it('records read entries with path, line range, and reason', () => {
      ledger.recordRead('src/flask/cli.py', 1, 50, 'Locating CLI command definitions', 200);

      const entries = ledger.getEntries();
      expect(entries.length).toBe(1);
      expect(entries[0].path).toBe('src/flask/cli.py');
      expect(entries[0].startLine).toBe(1);
      expect(entries[0].endLine).toBe(50);
      expect(entries[0].reason).toBe('Locating CLI command definitions');
      expect(entries[0].kind).toBe('read');
    });

    it('deduplicates identical file reads and returns cached notice charging 0 tokens', async () => {
      const read1 = await executeReadFile(
        { path: 'app.py', start: 1, end: 4, reason: 'Inspect app code' },
        wsManager,
        tracker
      );
      expect(read1.rawText).toContain('1 |');
      const tokensBefore = tracker.getSnapshot().retrievedTokens;

      // Second read of identical range
      const read2 = await executeReadFile(
        { path: 'app.py', start: 1, end: 4, reason: 'Duplicate inspection' },
        wsManager,
        tracker
      );

      expect(read2.rawText).toContain('already read lines 1 to 4 earlier');
      const tokensAfter = tracker.getSnapshot().retrievedTokens;
      expect(tokensAfter).toBe(tokensBefore); // 0 budget charged
    });

    it('deduplicates identical searches and returns notice charging 0 search hits', async () => {
      const search1 = await executeSearchText(
        { query: 'calculate_total', reason: 'Search total calculation' },
        wsManager,
        tracker
      );
      expect(search1.hits.length).toBeGreaterThan(0);
      const hitsBefore = tracker.getSnapshot().searchHits;

      // Repeat identical query
      const search2 = await executeSearchText(
        { query: 'calculate_total', reason: 'Repeated query' },
        wsManager,
        tracker
      );

      expect(search2.hits.length).toBe(0);
      expect(search2.rawText).toContain('already searched for "calculate_total" earlier');
      const hitsAfter = tracker.getSnapshot().searchHits;
      expect(hitsAfter).toBe(hitsBefore); // 0 hits added
    });
  });

  describe('Skipped candidate files tracking', () => {
    it('classifies unread search hits as "matched but not read"', () => {
      ledger.recordSearched('src/cli.ts', 'Found in search');
      ledger.recordSearched('docs/guide.md', 'Found in search');

      const groups = ledger.getGroups();
      expect(groups.skipped.length).toBe(2);

      const skippedPaths = groups.skipped.map(s => s.path);
      expect(skippedPaths).toContain('src/cli.ts');
      expect(skippedPaths).toContain('docs/guide.md');
      expect(groups.skipped[0].reason).toBe('matched but not read');
    });

    it('moves file from skipped to read when read is performed', () => {
      ledger.recordSearched('src/cli.ts', 'Found in search');
      expect(ledger.getGroups().skipped.some(s => s.path === 'src/cli.ts')).toBe(true);

      ledger.recordRead('src/cli.ts', 1, 30, 'Inspecting CLI implementation', 150);

      const groups = ledger.getGroups();
      expect(groups.skipped.some(s => s.path === 'src/cli.ts')).toBe(false);
      expect(groups.read.some(r => r.path === 'src/cli.ts')).toBe(true);
    });
  });

  describe('Budget meter and limits enforcement', () => {
    it('returns exact display meter limits: 12,000 tokens, 8 files, 30 hits, 200 lines per read', () => {
      const meter = ledger.getBudgetMeter();
      expect(meter.maxTokens).toBe(12000);
      expect(meter.maxFiles).toBe(8);
      expect(meter.maxHits).toBe(30);
      expect(meter.maxLinesPerRead).toBe(200);
    });

    it('rejects 9th distinct file with BudgetReachedError', () => {
      for (let i = 1; i <= 8; i++) {
        ledger.recordRead(`src/module${i}.ts`, 1, 20, `Reading module ${i}`, 100);
        tracker.recordFileRead(`src/module${i}.ts`, 20, 100);
      }

      expect(tracker.getSnapshot().filesConsulted).toBe(8);

      expect(() => {
        tracker.recordFileRead('src/module9.ts', 1, 20);
      }).toThrow(BudgetReachedError);
    });

    it('rejects single read exceeding 200 lines', async () => {
      await expect(
        executeReadFile(
          { path: 'app.py', start: 1, end: 201, reason: 'Too many lines' },
          wsManager,
          tracker
        )
      ).rejects.toThrow(/maximum limit of 200 lines/);
    });
  });

  describe('Live Context Map & Panel Integration', () => {
    it('builds ContextMap representations strictly from ContextLedger', () => {
      ledger.recordRead('src/flask/cli.py', 1, 100, 'Investigate CLI commands', 400);
      ledger.recordSearched('tests/test_cli.py', 'Locate CLI unit tests');
      ledger.recordSkipped('docs/cli.rst', 'matched but not read');

      const map = new ContextMap(ledger);
      const output = map.buildMap();
      expect(output).toContain('src/flask/cli.py');
      expect(output).toContain('tests/test_cli.py');
      expect(output).toContain('docs/cli.rst');
      expect(output).toContain('Investigate CLI commands');

      const relevant = map.getRelevantFiles();
      expect(relevant).toContain('src/flask/cli.py');
      expect(relevant).toContain('tests/test_cli.py');
    });

    it('AgentPanelProvider emits context_update with Read, Searched, Skipped groups and reasons', () => {
      let lastPostedMessage: any = null;
      const panel = new AgentPanelProvider(undefined, undefined, undefined, ledger);
      panel.postMessage = (msg: any) => {
        lastPostedMessage = msg;
      };

      // Populate entries matching Acceptance Criteria: src/flask/cli.py, tests/test_cli.py, docs/cli.rst
      ledger.recordRead('src/flask/cli.py', 1, 80, 'Inspect CLI options parsing', 350);
      ledger.recordSearched('tests/test_cli.py', 'Test cases for CLI commands');
      ledger.recordSkipped('docs/cli.rst', 'matched but not read');

      panel.syncContextLedger();

      expect(lastPostedMessage).toBeDefined();
      expect(lastPostedMessage.type).toBe('context_update');

      const groups = lastPostedMessage.groups;
      expect(groups).toBeDefined();

      const readEntry = groups.read.find((r: any) => r.path === 'src/flask/cli.py');
      expect(readEntry).toBeDefined();
      expect(readEntry.reason).toBe('Inspect CLI options parsing');
      expect(readEntry.lineRange).toBe('L1-80');

      const searchEntry = groups.searched.find((s: any) => s.path === 'tests/test_cli.py');
      expect(searchEntry).toBeDefined();
      expect(searchEntry.reason).toBe('Test cases for CLI commands');

      const skippedEntry = groups.skipped.find((sk: any) => sk.path === 'docs/cli.rst');
      expect(skippedEntry).toBeDefined();
      expect(skippedEntry.reason).toBe('matched but not read');

      // Verify budget meter payload
      expect(lastPostedMessage.budgetMeter).toEqual({
        tokens: 350,
        maxTokens: 12000,
        files: 1,
        maxFiles: 8,
        hits: 1,
        maxHits: 30,
        maxLinesPerRead: 200
      });
    });
  });
});
