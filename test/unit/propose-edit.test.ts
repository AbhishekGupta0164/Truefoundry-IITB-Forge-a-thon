import * as fs from 'fs';
import { describe, expect, it } from 'vitest';
import { executeProposeEdit } from '../../src/mcp/tools/propose_edit';
import { WorkspaceManager } from '../../src/mcp/workspace';
import { PatchStore } from '../../src/review/store';

describe('propose_edit Tool (Item 22)', () => {
  it('stages an edit in memory and never modifies files on disk', async () => {
    const wsManager = new WorkspaceManager();
    const patchStore = new PatchStore();

    const targetFile = 'package.json';
    const absPath = wsManager.resolveSafePath(targetFile);
    const contentBefore = fs.readFileSync(absPath, 'utf-8');

    const result = await executeProposeEdit(
      {
        path: targetFile,
        old_str: '"name": "forge-agent"',
        new_str: '"name": "forge-agent-edited"',
        summary: 'Rename agent in package.json'
      },
      wsManager,
      patchStore
    );

    expect(result.patch_id).toBeDefined();
    expect(result.patch_id).toMatch(/^patch-/);
    expect(result.hunk_ids.length).toBeGreaterThan(0);
    expect(result.diff).toContain('--- package.json');
    expect(result.diff).toContain('+++ package.json');
    expect(result.diff).toContain('"name": "forge-agent"');
    expect(result.diff).toContain('"name": "forge-agent-edited"');

    // Staged in patchStore
    const staged = patchStore.getPatch(result.patch_id);
    expect(staged).toBeDefined();

    // File on disk remains untouched
    const contentAfter = fs.readFileSync(absPath, 'utf-8');
    expect(contentAfter).toBe(contentBefore);
  });

  it('rejects propose_edit when old_str is not found', async () => {
    const wsManager = new WorkspaceManager();
    const patchStore = new PatchStore();

    await expect(
      executeProposeEdit(
        {
          path: 'package.json',
          old_str: 'THIS_STRING_DEFINITELY_DOES_NOT_EXIST_ANYWHERE_12345',
          new_str: 'new string'
        },
        wsManager,
        patchStore
      )
    ).rejects.toThrow(/not found/);
  });

  it('rejects propose_edit when old_str is ambiguous', async () => {
    const wsManager = new WorkspaceManager();
    const patchStore = new PatchStore();

    // Common character or string occurring multiple times
    await expect(
      executeProposeEdit(
        {
          path: 'package.json',
          old_str: '": "',
          new_str: '": "replacement"'
        },
        wsManager,
        patchStore
      )
    ).rejects.toThrow(/ambiguous/);
  });
});
