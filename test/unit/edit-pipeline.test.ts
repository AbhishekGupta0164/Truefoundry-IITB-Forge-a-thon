/**
 * test/unit/edit-pipeline.test.ts
 *
 * Regressions found by running the MCP tools against a real Flask 3.1.3 checkout:
 * - several hunks of one patch must all apply, in any order (later hunks move once
 *   an earlier one adds lines)
 * - propose_edit must apply every entry of `edits`, not only the first
 * - the Python check must not reject files for relative imports or imports they
 *   already had, and must still catch a new import that does not exist
 * - find_related must suggest .rst docs and list each file once
 * - paths outside the workspace (e.g. a sibling ../flask checkout) are never resolved
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceManager } from '../../src/mcp/workspace';
import { PatchStore } from '../../src/review/store';
import { UndoManager } from '../../src/review/undo';
import { CancelManager } from '../../src/review/cancel';
import { ReviewManager } from '../../src/review/manager';
import { executeProposeEdit } from '../../src/mcp/tools/propose_edit';
import { executeApplyPatchHunk } from '../../src/mcp/tools/apply_patch_hunk';
import { executeFindRelated } from '../../src/mcp/tools/find_related';
import { locateHunk } from '../../src/review/apply';
import { validatePythonSource } from '../../src/review/validate';
import { isPathSafe } from '../../src/shared/validation';

// Functions far enough apart that each edit becomes its own hunk (3 lines of diff context)
const filler = (name: string) => Array.from({ length: 8 }, (_, i) => `    # ${name} note ${i}`);
const ORIGINAL = [
  'import os',
  '',
  '',
  'def a():',
  ...filler('a'),
  '    return 1',
  '',
  '',
  'def b():',
  ...filler('b'),
  '    return 2',
  '',
  '',
  'def c():',
  ...filler('c'),
  '    return 3',
  ''
].join('\n');

const EDITS = [
  { old_str: 'import os\n', new_str: 'import os\nimport json\n' },
  { old_str: '    return 2\n', new_str: '    value = 2\n    return value\n' },
  { old_str: '    return 3\n', new_str: '    return json.dumps(3)\n' }
];

const EXPECTED = ORIGINAL
  .replace('import os\n', 'import os\nimport json\n')
  .replace('    return 2\n', '    value = 2\n    return value\n')
  .replace('    return 3\n', '    return json.dumps(3)\n');

let root: string;
let ws: WorkspaceManager;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-pipeline-'));
  fs.mkdirSync(path.join(root, 'pkg'));
  fs.writeFileSync(path.join(root, 'pkg', 'mod.py'), ORIGINAL);
  ws = new WorkspaceManager(root);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

async function proposeMulti(store: PatchStore) {
  const result = await executeProposeEdit({ path: 'pkg/mod.py', edits: EDITS, reason: 'multi' }, ws, store);
  const patch = store.getAllPatches().find((p) => p.id === result.patch_id)!;
  return { result, hunks: patch.hunks };
}

describe('propose_edit with several edits', () => {
  it('applies every edit to the proposal and writes nothing', async () => {
    const store = new PatchStore();
    const { result, hunks } = await proposeMulti(store);
    expect(hunks.length).toBe(3);
    expect(result.diff).toContain('+import json');
    expect(result.diff).toContain('+    value = 2');
    expect(result.diff).toContain('+    return json.dumps(3)');
    expect(fs.readFileSync(path.join(root, 'pkg', 'mod.py'), 'utf-8')).toBe(ORIGINAL);
  });

  it('names the edit that does not match and stages nothing', async () => {
    const store = new PatchStore();
    await expect(
      executeProposeEdit({ path: 'pkg/mod.py', edits: [EDITS[0], { old_str: 'def missing():', new_str: 'x' }] }, ws, store)
    ).rejects.toThrow(/edits\[1\]/);
    expect(store.getAllPatches()).toHaveLength(0);
  });
});

describe('applying several hunks of one patch', () => {
  it.each([
    ['in order', [0, 1, 2]],
    ['in reverse order', [2, 1, 0]],
    ['out of order', [1, 0, 2]]
  ])('apply_patch_hunk applies all hunks %s', async (_label, order) => {
    const store = new PatchStore();
    const { result, hunks } = await proposeMulti(store);
    for (const i of order as number[]) {
      await executeApplyPatchHunk({ patch_id: result.patch_id, hunk_id: hunks[i].id }, ws, store, new UndoManager(), new CancelManager());
    }
    expect(fs.readFileSync(path.join(root, 'pkg', 'mod.py'), 'utf-8')).toBe(EXPECTED);
  });

  it('ReviewManager (CodeLens Accept) applies all hunks after the first moved them', async () => {
    const store = new PatchStore();
    const { result, hunks } = await proposeMulti(store);
    const review = new ReviewManager(ws, new UndoManager());
    review.stagePatch({
      id: result.patch_id,
      targetFile: 'pkg/mod.py',
      summary: 'multi',
      createdAt: Date.now(),
      initialContent: ORIGINAL,
      hunks: hunks.map((h) => ({ ...h, status: 'pending' as const }))
    } as any);
    for (const h of hunks) {
      await review.acceptHunk(result.patch_id, h.id);
    }
    expect(fs.readFileSync(path.join(root, 'pkg', 'mod.py'), 'utf-8')).toBe(EXPECTED);
  });

  it('still denies a hunk whose own lines the user changed', async () => {
    const store = new PatchStore();
    const { result, hunks } = await proposeMulti(store);
    const file = path.join(root, 'pkg', 'mod.py');
    fs.writeFileSync(file, ORIGINAL.replace('    return 2\n', '    return 22  # user\n'));
    await expect(
      executeApplyPatchHunk({ patch_id: result.patch_id, hunk_id: hunks[1].id }, ws, store, new UndoManager(), new CancelManager())
    ).rejects.toThrow(/Stale hunk/);
    expect(fs.readFileSync(file, 'utf-8')).toContain('return 22  # user');
  });
});

describe('locateHunk', () => {
  const lines = ['a', 'b', 'c', 'd', 'b', 'c'];
  it('prefers the expected position', () => expect(locateHunk(lines, ['b', 'c'], 4)).toBe(4));
  it('finds a unique block that moved', () => expect(locateHunk(lines, ['c', 'd'], 0)).toBe(2));
  it('refuses an ambiguous block away from its expected position', () => expect(locateHunk(lines, ['b', 'c'], 0)).toBe(-1));
  it('returns -1 when the lines are gone', () => expect(locateHunk(lines, ['x'], 0)).toBe(-1));
});

describe('Python check', () => {
  it('accepts relative imports and imports the file already had', () => {
    const before = 'from .globals import current_app\nimport some_vendored_pkg\n\ndef f():\n    return 1\n';
    const after = before.replace('return 1', 'return 2');
    const res = validatePythonSource(after, root, before);
    expect(res).toMatchObject({ valid: true, errors: [] });
  });

  it('accepts a new standard-library import', () => {
    expect(validatePythonSource('import json\nprint(json.dumps(1))\n', root, '').valid).toBe(true);
  });

  it('rejects a new import that does not resolve', () => {
    const res = validatePythonSource('import os\nimport totally_missing_pkg_xyz\n', root, 'import os\n');
    expect(res.valid).toBe(false);
    expect(res.errors.join(' ')).toMatch(/totally_missing_pkg_xyz/);
  });

  it('rejects a syntax error', () => {
    expect(validatePythonSource('def broken(:\n    pass\n', root).valid).toBe(false);
  });

  it('gives the same answer whatever the process working directory is', () => {
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(os.tmpdir());
    try {
      expect(validatePythonSource('from .x import y\n', root, 'from .x import y\n').valid).toBe(true);
      expect(validatePythonSource('import totally_missing_pkg_xyz\n', root, '').valid).toBe(false);
    } finally {
      cwd.mockRestore();
    }
  });
});

describe('find_related', () => {
  it('suggests a docs page named after the module (.rst) and lists each file once', async () => {
    fs.mkdirSync(path.join(root, 'tests'));
    fs.mkdirSync(path.join(root, 'docs'));
    fs.mkdirSync(path.join(root, 'src', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'pkg', 'cli.py'), 'x = 1\n');
    fs.writeFileSync(path.join(root, 'tests', 'test_cli.py'), 'def test(): pass\n');
    fs.writeFileSync(path.join(root, 'docs', 'cli.rst'), 'CLI\n===\n');
    fs.writeFileSync(path.join(root, 'docs', 'api.rst'), '.. automodule:: pkg.cli\n');

    const res = await executeFindRelated({ path: 'src/pkg/cli.py', reason: 'pairing' }, ws);
    const paths = res.related.map((r) => r.path);
    expect(paths).toEqual(expect.arrayContaining(['tests/test_cli.py', 'docs/cli.rst', 'docs/api.rst']));
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('workspace confinement', () => {
  it('does not resolve files from a sibling checkout next to the workspace', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-sibling-'));
    try {
      const workspace = path.join(parent, 'workspace');
      const sibling = path.join(parent, 'flask');
      fs.mkdirSync(workspace);
      fs.mkdirSync(path.join(sibling, 'src'), { recursive: true });
      fs.writeFileSync(path.join(sibling, 'src', 'only_in_sibling.py'), 'secret = 1\n');
      const manager = new WorkspaceManager(workspace);

      expect(manager.resolveSafePath('src/only_in_sibling.py')).toBe(path.join(workspace, 'src', 'only_in_sibling.py'));
      expect(isPathSafe(path.join(sibling, 'src', 'only_in_sibling.py'), workspace)).toBe(false);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });
});
