import { describe, expect, it } from 'vitest';
import { parseMentions } from '../../src/context/mentions';
import { ContextMap } from '../../src/context/map';
import { RepoMapGenerator } from '../../src/context/repo-map';
import { WorkspaceManager } from '../../src/mcp/workspace';

describe('Stage 5: Context Engine and Mentions', () => {
  it('parses @file and @symbol mentions from prompt', () => {
    const prompt = 'Look at @file:src/flask/cli.py and @symbol:show_server_banner to add @file docs/cli.rst';
    const result = parseMentions(prompt);

    expect(result.files).toContain('src/flask/cli.py');
    expect(result.files).toContain('docs/cli.rst');
    expect(result.symbols).toContain('show_server_banner');
    expect(result.cleanPrompt).not.toContain('@file');
    expect(result.cleanPrompt).not.toContain('@symbol');
  });

  it('records real file reads and skipped candidates in context map', () => {
    const map = new ContextMap();
    map.recordRead({
      path: 'src/flask/cli.py',
      lineStart: 1,
      lineEnd: 50,
      reason: 'Find existing CLI command registrations'
    });

    map.recordSkipped('src/flask/blueprints.py', 'Budget limit reached');

    const entries = map.getEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].path).toBe('src/flask/cli.py');

    const skipped = map.getSkipped();
    expect(skipped.length).toBe(1);
    expect(skipped[0].path).toBe('src/flask/blueprints.py');

    const summary = map.getSummary();
    expect(summary).toContain('src/flask/cli.py');
    expect(summary).toContain('Skipped Candidates');
  });

  it('generates a compact repo map under safety budget', () => {
    const workspace = new WorkspaceManager();
    const generator = new RepoMapGenerator(workspace);
    const repoMap = generator.generateRepoMap({ maxFiles: 10 });

    expect(repoMap).toContain('=== Workspace Map ===');
    expect(repoMap.length).toBeGreaterThan(20);
  });
});
