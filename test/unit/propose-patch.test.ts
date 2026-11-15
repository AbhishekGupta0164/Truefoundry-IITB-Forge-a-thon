import { describe, expect, it } from 'vitest';
import { executeProposePatch } from '../../src/mcp/tools/propose_patch';
import { WorkspaceManager } from '../../src/mcp/workspace';
import { PatchStore } from '../../src/review/store';
import * as path from 'path';

describe('Propose Patch Tool', () => {
  const fixtureDir = path.resolve(__dirname, '../fixtures/mini-repo');
  const workspace = new WorkspaceManager(fixtureDir);

  it('stages unified diff in memory without writing to disk', () => {
    const store = new PatchStore();
    const patchDiff = `--- a/app.py
+++ b/app.py
@@ -1,3 +1,4 @@
 def hello():
-    return "old"
+    return "new"
+    # note
`;

    const res = executeProposePatch({ patch_content: patchDiff, summary: 'test patch' }, workspace, store);
    expect(res.success).toBe(true);
    expect(res.patchId).toBeDefined();
    expect(res.hunks?.length).toBe(1);

    const staged = store.getPatch(res.patchId!);
    expect(staged).toBeDefined();
    expect(staged?.hunks[0].file).toBe('app.py');
  });

  it('rejects patch containing path traversal', () => {
    const store = new PatchStore();
    const traversalDiff = `--- a/../secret.txt
+++ b/../secret.txt
@@ -1,1 +1,1 @@
-old
+new
`;

    const res = executeProposePatch({ patch_content: traversalDiff }, workspace, store);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Security violation/);
  });
});
