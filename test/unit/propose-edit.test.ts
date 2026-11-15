import { describe, expect, it } from 'vitest';
import { executeProposeEdit } from '../../src/mcp/tools/propose_edit';
import { WorkspaceManager } from '../../src/mcp/workspace';
import { PatchStore } from '../../src/review/store';
import * as path from 'path';

describe('Propose Edit Tool', () => {
  const fixtureDir = path.resolve(__dirname, '../fixtures/mini-repo');
  const workspace = new WorkspaceManager(fixtureDir);

  it('proposes in-memory replacement into hunks', () => {
    const store = new PatchStore();
    const res = executeProposeEdit(
      {
        file_path: 'app.py',
        old_str: 'return sum(prices) * (1 + tax_rate)',
        new_str: 'return round(sum(prices) * (1 + tax_rate), 2)',
        summary: 'test edit'
      },
      workspace,
      store
    );

    expect(res.success).toBe(true);
    expect(res.patchId).toBeDefined();
    expect(res.hunks?.length).toBeGreaterThan(0);
    expect(store.getAllPatches().length).toBe(1);
  });

  it('fails if old_str is not present', () => {
    const store = new PatchStore();
    const res = executeProposeEdit(
      {
        file_path: 'app.py',
        old_str: 'non_existent_old_string',
        new_str: 'replacement'
      },
      workspace,
      store
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain('old_str was not found');
  });
});
