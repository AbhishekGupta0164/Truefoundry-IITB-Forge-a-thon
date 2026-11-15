import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { executeProposePatch } from '../../src/mcp/tools/propose_patch';
import { WorkspaceManager } from '../../src/mcp/workspace';
import { PatchStore } from '../../src/review/store';

describe('propose_patch Tool (Item 21)', () => {
  it('prepares and stages a proposed patch in memory without modifying files on disk', async () => {
    const wsManager = new WorkspaceManager();
    const patchStore = new PatchStore();

    const targetFile = 'package.json';
    const absPath = wsManager.resolveSafePath(targetFile);
    const contentBefore = fs.readFileSync(absPath, 'utf-8');

    // Get git status before
    let gitStatusBefore = '';
    try {
      gitStatusBefore = child_process.execSync(`git status --porcelain ${targetFile}`, {
        cwd: wsManager.getRoot(),
        encoding: 'utf-8'
      });
    } catch {
      // ignore
    }

    const samplePatch = `--- a/package.json
+++ b/package.json
@@ -1,3 +1,4 @@
 {
+  "test_addition": true,
   "name": "forge-agent",
`;

    const result = await executeProposePatch(
      {
        target_file: targetFile,
        patch: samplePatch,
        summary: 'Add test field to package.json'
      },
      wsManager,
      patchStore
    );

    // 1. Returns patch ID and hunk IDs
    expect(result.patch_id).toBeDefined();
    expect(result.patch_id).toMatch(/^patch-/);
    expect(result.hunk_ids.length).toBeGreaterThan(0);
    expect(result.hunk_ids[0]).toMatch(/^hunk-/);

    // 2. Staged in store
    const staged = patchStore.getPatch(result.patch_id);
    expect(staged).toBeDefined();
    expect(staged?.hunks.length).toBe(result.hunk_ids.length);

    // 3. File content on disk is completely unchanged
    const contentAfter = fs.readFileSync(absPath, 'utf-8');
    expect(contentAfter).toBe(contentBefore);

    // 4. git status --porcelain remains completely unchanged for targetFile
    let gitStatusAfter = '';
    try {
      gitStatusAfter = child_process.execSync(`git status --porcelain ${targetFile}`, {
        cwd: wsManager.getRoot(),
        encoding: 'utf-8'
      });
    } catch {
      // ignore
    }
    expect(gitStatusAfter).toBe(gitStatusBefore);
  });
});
