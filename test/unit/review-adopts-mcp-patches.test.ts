/**
 * test/unit/review-adopts-mcp-patches.test.ts
 *
 * Task A flow: the model calls propose_edit over MCP, which stages the patch in the
 * PatchStore; the user then clicks CodeLens Accept / Reject, which goes through the
 * ReviewManager. The ReviewManager must find those patches, or Accept fails with
 * "Invalid patch ID".
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceManager } from '../../src/mcp/workspace';
import { PatchStore } from '../../src/review/store';
import { UndoManager } from '../../src/review/undo';
import { ReviewManager } from '../../src/review/manager';
import { CancelManager } from '../../src/review/cancel';
import { defaultStatusBar } from '../../src/ui/status-bar';
import { executeProposeEdit } from '../../src/mcp/tools/propose_edit';
import { executeApplyPatchHunk } from '../../src/mcp/tools/apply_patch_hunk';

const SOURCE = [
  'import os',
  '',
  '',
  'def get_debug_flag() -> bool:',
  '    """Get whether debug mode should be enabled."""',
  '    val = os.environ.get("FLASK_DEBUG")',
  '    return bool(val and val.lower() not in {"0", "false", "no"})',
  ''
].join('\n');

let root: string;
let ws: WorkspaceManager;
let store: PatchStore;
let review: ReviewManager;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-adopt-'));
  fs.writeFileSync(path.join(root, 'helpers.py'), SOURCE);
  ws = new WorkspaceManager(root);
  store = new PatchStore();
  review = new ReviewManager(ws, new UndoManager(), defaultStatusBar, store);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const propose = () =>
  executeProposeEdit(
    {
      path: 'helpers.py',
      old_str: '{"0", "false", "no"}',
      new_str: '{"0", "false", "no", "off", "n"}',
      reason: 'treat off and n as false'
    },
    ws,
    store
  );

describe('ReviewManager reviews patches proposed over MCP', () => {
  it('CodeLens Accept applies a hunk that only the PatchStore knew about', async () => {
    const { patch_id, hunk_ids } = await propose();
    expect(fs.readFileSync(path.join(root, 'helpers.py'), 'utf-8')).toBe(SOURCE);

    const res = await review.acceptHunk(patch_id, hunk_ids[0]);

    expect(res.success).toBe(true);
    expect(fs.readFileSync(path.join(root, 'helpers.py'), 'utf-8')).toContain('"off", "n"');
  });

  it('CodeLens Reject marks the hunk rejected and writes nothing', async () => {
    const { patch_id, hunk_ids } = await propose();

    review.rejectHunk(patch_id, hunk_ids[0]);

    expect(review.getHunk(patch_id, hunk_ids[0])?.hunk.status).toBe('rejected');
    expect(fs.readFileSync(path.join(root, 'helpers.py'), 'utf-8')).toBe(SOURCE);
  });

  it('lists MCP patches once and shares applied state with apply_patch_hunk', async () => {
    const { patch_id, hunk_ids } = await propose();
    expect(review.getAllPatches().map((p) => p.id)).toEqual([patch_id]);
    expect(review.getAllPatches()).toHaveLength(1);

    await executeApplyPatchHunk({ patch_id, hunk_id: hunk_ids[0] }, ws, store, new UndoManager(), new CancelManager());
    const again = await review.acceptHunk(patch_id, hunk_ids[0]);

    expect(again.message).toMatch(/already applied/);
    expect(fs.readFileSync(path.join(root, 'helpers.py'), 'utf-8').match(/"off", "n"/g)).toHaveLength(1);
  });
});
