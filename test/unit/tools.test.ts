import { describe, expect, it } from 'vitest';
import { executeSearchText } from '../../src/mcp/tools/search_text';
import { executeSearchSymbols } from '../../src/mcp/tools/search_symbols';
import { executeReadFile } from '../../src/mcp/tools/read_file';
import { executeFindRelated } from '../../src/mcp/tools/find_related';
import { WorkspaceManager } from '../../src/mcp/workspace';
import { ContextBudgetTracker } from '../../src/context/budget';
import { BudgetReachedError } from '../../src/shared/errors';

describe('MCP Search, Inspection, and Navigation Tools (Items 14-16, 19-20)', () => {
  const wsManager = new WorkspaceManager();

  it('search_text returns correct line numbers and snippets (Item 14)', async () => {
    const tracker = new ContextBudgetTracker();
    const result = await executeSearchText(
      { query: 'forge-agent' },
      wsManager,
      tracker
    );

    expect(result.hits.length).toBeGreaterThan(0);
    const hit = result.hits.find(h => h.file === 'package.json');
    expect(hit).toBeDefined();
    expect(hit?.snippet).toContain('forge-agent');
    expect(hit?.line).toBeGreaterThan(0);
    expect(result.rawText).toContain('<!-- Untrusted Tool Output Begin -->');
  });

  it('search_text results never exceed 30 hits and 31st hit is cut with budget message (Item 15)', async () => {
    const tracker = new ContextBudgetTracker();
    const result = await executeSearchText(
      { query: 'e' }, // Very broad query
      wsManager,
      tracker
    );

    expect(result.hits.length).toBeLessThanOrEqual(30);

    // Explicit check: recording a 31st hit throws BudgetReachedError with clear budget message
    expect(() => {
      tracker.recordSearch(1);
    }).toThrow(/Search hits budget exceeded: 31 > 30 hits/);
  });

  it('read_file reads workspace files with line numbers (Item 16)', async () => {
    const tracker = new ContextBudgetTracker();
    const result = await executeReadFile(
      { path: 'package.json', start: 1, end: 10 },
      wsManager,
      tracker
    );

    expect(result.filePath).toBe('package.json');
    expect(result.startLine).toBe(1);
    expect(result.endLine).toBe(10);
    expect(result.lines.length).toBe(10);
    expect(result.rawText).toContain('1 |');
  });

  it('read_file rejects traversal ../../etc/passwd', async () => {
    const tracker = new ContextBudgetTracker();
    await expect(
      executeReadFile(
        { path: '../../etc/passwd' },
        wsManager,
        tracker
      )
    ).rejects.toThrow(/Security violation/);
  });

  it('read_file rejects 201st line with budget message', async () => {
    const tracker = new ContextBudgetTracker();
    await expect(
      executeReadFile(
        { path: 'package.json', start: 1, end: 201 },
        wsManager,
        tracker
      )
    ).rejects.toThrow(/maximum limit of 200 lines/);
  });

  it('search_symbols returns functions, classes, and signatures (Item 19)', async () => {
    const result = await executeSearchSymbols(
      { query: 'WorkspaceManager' },
      wsManager
    );

    expect(result.symbols.length).toBeGreaterThan(0);
    const sym = result.symbols.find(s => s.name === 'WorkspaceManager');
    expect(sym).toBeDefined();
    expect(sym?.type).toBe('class');
    expect(sym?.file).toContain('workspace.ts');
  });

  it('find_related suggests relevant tests and documentation (Item 20)', async () => {
    const result = await executeFindRelated(
      { path: 'src/mcp/server.ts' },
      wsManager
    );

    expect(result.related.length).toBeGreaterThan(0);
    const hasDocOrTest = result.related.some(r => r.type === 'doc' || r.type === 'test');
    expect(hasDocOrTest).toBe(true);
  });
});
