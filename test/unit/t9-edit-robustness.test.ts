import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { WorkspaceManager } from '../../src/mcp/workspace';
import { PatchStore } from '../../src/review/store';
import { executeProposeEdit } from '../../src/mcp/tools/propose_edit';
import { matchAndReplace, repairProposeEditArgs, buildHunkDependencyGraph } from '../../src/review/matcher';

describe('T9: Edit Robustness, Multi-Tier Matcher & Typed Errors', () => {
  const tmpDir = path.resolve(__dirname, '../../test/fixtures/t9-workspace');
  let workspaceManager: WorkspaceManager;
  let patchStore: PatchStore;

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    workspaceManager = new WorkspaceManager(tmpDir);
    patchStore = new PatchStore();
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('Tier 1: Exact unique match replaces code accurately', () => {
    const content = `def hello():\n    print("Hello, world!")\n`;
    const res = matchAndReplace(content, 'print("Hello, world!")', 'print("Hello, TrueForge!")');
    expect(res.matched).toBe(true);
    expect(res.tier).toBe(1);
    expect(res.replacementText).toBe('print("Hello, TrueForge!")');
  });

  it('Tier 1: Detects ambiguous matches with exact line numbers', () => {
    const content = `x = 1\n# middle\nx = 1\n`;
    const res = matchAndReplace(content, 'x = 1', 'x = 2');
    expect(res.matched).toBe(false);
    expect(res.error?.code).toBe('AMBIGUOUS_MATCH');
    expect(res.error?.message).toContain('matched at lines 1 and 3, add context');
  });

  it('Tier 2: Matches with CRLF and trailing whitespace and preserves indentation', () => {
    // Content has CRLF and trailing spaces
    const content = "def compute():\r\n    a = 10   \r\n    b = 20\r\n    return a + b\r\n";
    // Target has LF and no trailing spaces
    const oldStr = "a = 10\nb = 20";
    const newStr = "a = 100\nb = 200";

    const res = matchAndReplace(content, oldStr, newStr);
    expect(res.matched).toBe(true);
    expect(res.tier).toBe(2);
    // Preserves indentation
    expect(res.replacementText).toContain('    a = 100\n    b = 200');
  });

  it('Tier 3: Anchor match tolerates drifted middle lines with >=70% similarity', () => {
    const content = [
      'def process_data(items):',
      '    # start anchor',
      '    cleaned = []',
      '    for item in items:',
      '        if item is not None:',
      '            cleaned.append(item.strip())',
      '    # end anchor',
      '    return cleaned'
    ].join('\n');

    // oldStr has slightly different intermediate comment / formatting but same anchors
    const oldStr = [
      '    # start anchor',
      '    cleaned = []',
      '    for item in items:',
      '        if item:',
      '            cleaned.append(item.strip())',
      '    # end anchor'
    ].join('\n');

    const newStr = '    # optimized\n    return [item.strip() for item in items if item]';

    const res = matchAndReplace(content, oldStr, newStr);
    expect(res.matched).toBe(true);
    expect(res.tier).toBe(3);
    expect(res.replacementText).toBe(newStr);
  });

  it('Failure diagnostics: returns closest match line, 5-line excerpt, and difference hint', () => {
    const content = [
      'def get_flag():',
      '    val = os.environ.get("DEBUG")',
      '    return bool(val and val != "0")'
    ].join('\n');

    const oldStr = [
      'def get_flag():',
      '    val = os.environ.get("WRONG_KEY")',
      '    return bool(val)'
    ].join('\n');

    const res = matchAndReplace(content, oldStr, 'return False');
    expect(res.matched).toBe(false);
    expect(res.error?.code).toBe('MATCH_FAILED');
    expect(res.error?.message).toContain('matched 0 times; closest match at line 1, differs at line 2');
    expect(res.error?.excerpt).toContain('def get_flag():');
  });

  it('Tool-call repair: normalizes stringified JSON, alias keys, and leading slashes', () => {
    const raw = JSON.stringify({
      filePath: '/src/flask/app.py',
      oldStr: 'foo',
      newStr: 'bar'
    });

    const repaired = repairProposeEditArgs(raw);
    expect(repaired.path).toBe('src/flask/app.py'); // Stripped leading slash
    expect(repaired.old_str).toBe('foo');
    expect(repaired.new_str).toBe('bar');
  });

  it('Alternative input: accepts and applies unified diff input', async () => {
    const testFile = 'helper.py';
    const filePath = path.join(tmpDir, testFile);
    fs.writeFileSync(filePath, 'def add(a, b):\n    return a + b\n', 'utf-8');

    const unifiedDiff = [
      '--- helper.py',
      '+++ helper.py',
      '@@ -1,2 +1,2 @@',
      ' def add(a, b):',
      '-    return a + b',
      '+    return a + b + 1'
    ].join('\n');

    const result = await executeProposeEdit(
      { path: testFile, old_str: unifiedDiff, new_str: '' },
      workspaceManager,
      patchStore
    );

    expect(result.ok).toBe(true);
    expect(result.hunks_count).toBeGreaterThan(0);
    expect(result.diff).toContain('+    return a + b + 1');
  });

  it('Hunk dependency graph: links hunks when a subsequent hunk relies on a new import', () => {
    const hunks = [
      {
        id: 'hunk-1',
        content: '+import math\n def helper():\n     pass'
      },
      {
        id: 'hunk-2',
        content: ' def calculate():\n+    return math.sqrt(100)'
      }
    ];

    const graph = buildHunkDependencyGraph(hunks);
    expect(graph.has('hunk-2')).toBe(true);
    expect(graph.get('hunk-2')).toEqual(['hunk-1']);
  });

  it('In-memory validation pipeline: rejects Python syntax errors before staging', async () => {
    const testFile = 'bad_syntax.py';
    const filePath = path.join(tmpDir, testFile);
    fs.writeFileSync(filePath, 'def valid():\n    return 42\n', 'utf-8');

    await expect(
      executeProposeEdit(
        { path: testFile, old_str: 'return 42', new_str: 'return def invalid (' },
        workspaceManager,
        patchStore
      )
    ).rejects.toThrow(/SYNTAX_ERROR/);
  });
});
