import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { executeApplyPatchHunk } from '../../src/mcp/tools/apply_patch_hunk';
import { WorkspaceManager } from '../../src/mcp/workspace';
import { PatchStore, StagedHunk, StagedPatch } from '../../src/review/store';
import { StaleHunkError } from '../../src/shared/errors';

describe('apply_patch_hunk and Staleness Validation (Items 23-25)', () => {
  let tempWorkspace: string;
  let workspaceManager: WorkspaceManager;
  let patchStore: PatchStore;

  beforeAll(() => {
    tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-apply-test-'));
    workspaceManager = new WorkspaceManager(tempWorkspace);
    patchStore = new PatchStore();

    // Create a target file
    fs.writeFileSync(
      path.join(tempWorkspace, 'target.txt'),
      'line 1\nline 2: original text\nline 3\n'
    );
  });

  afterAll(() => {
    try {
      fs.rmSync(tempWorkspace, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('rejects invalid patch and hunk IDs (Item 25)', async () => {
    await expect(
      executeApplyPatchHunk(
        { patch_id: 'nonexistent-patch', hunk_id: 'nonexistent-hunk' },
        workspaceManager,
        patchStore
      )
    ).rejects.toThrow(/Invalid patch_id/);
  });

  it('rejects stale hunks when target file content has changed (Item 24)', async () => {
    // Stage a hunk expecting 'line 2: different text'
    const staleHunk: StagedHunk = {
      id: 'hunk-stale-1',
      file: 'target.txt',
      oldStart: 2,
      oldLines: 1,
      newStart: 2,
      newLines: 1,
      content: '@@ -2,1 +2,1 @@\n-line 2: different text\n+line 2: updated text\n'
    };
    const patch: StagedPatch = {
      id: 'patch-stale-1',
      targetFile: 'target.txt',
      hunks: [staleHunk],
      summary: 'Stale test',
      createdAt: Date.now()
    };
    patchStore.stagePatch(patch);

    await expect(
      executeApplyPatchHunk(
        { patch_id: 'patch-stale-1', hunk_id: 'hunk-stale-1' },
        workspaceManager,
        patchStore
      )
    ).rejects.toThrow(StaleHunkError);
  });

  it('successfully applies a valid staged hunk to disk (Item 23)', async () => {
    const validHunk: StagedHunk = {
      id: 'hunk-valid-1',
      file: 'target.txt',
      oldStart: 2,
      oldLines: 1,
      newStart: 2,
      newLines: 1,
      content: '@@ -2,1 +2,1 @@\n-line 2: original text\n+line 2: modified successfully\n'
    };
    const patch: StagedPatch = {
      id: 'patch-valid-1',
      targetFile: 'target.txt',
      hunks: [validHunk],
      summary: 'Valid edit',
      createdAt: Date.now()
    };
    patchStore.stagePatch(patch);

    const result = await executeApplyPatchHunk(
      { patch_id: 'patch-valid-1', hunk_id: 'hunk-valid-1' },
      workspaceManager,
      patchStore
    );

    expect(result.success).toBe(true);
    expect(result.patch_id).toBe('patch-valid-1');
    expect(result.hunk_id).toBe('hunk-valid-1');

    // Confirm file was updated on disk
    const updatedContent = fs.readFileSync(path.join(tempWorkspace, 'target.txt'), 'utf-8');
    expect(updatedContent).toContain('line 2: modified successfully');
  });
});
