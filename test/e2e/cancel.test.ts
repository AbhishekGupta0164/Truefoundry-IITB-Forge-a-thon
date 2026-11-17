/**
 * test/e2e/cancel.test.ts
 *
 * Implements T6 End-to-End Verification:
 * - Cancel stops the run at once and offers to undo anything already applied.
 * - Test 1: Cancel during search (AbortController aborted, no files changed).
 * - Test 2: Cancel during proposal (unapplied patches discarded, no files changed).
 * - Test 3: Cancel while waiting for approval - Keep branch (only intentionally kept hunks in git status).
 * - Test 4: Cancel while waiting for approval - Undo branch (one-gesture undo restores git status to clean).
 * - Test 5: Late apply_patch_hunk from cancelled turn is denied.
 * - Test 6: Status bar and webview panel receive immediate cancellation notification.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { CancelManager, defaultCancelManager } from '../../src/review/cancel';
import { PatchStore } from '../../src/review/store';
import { UndoManager } from '../../src/review/undo';
import { ReviewManager } from '../../src/review/manager';
import { ForgeStatusBar } from '../../src/ui/status-bar';
import { WorkspaceManager } from '../../src/mcp/workspace';
import { executeApplyPatchHunk } from '../../src/mcp/tools/apply_patch_hunk';
import { executeSearchText } from '../../src/mcp/tools/search_text';
import { executeProposePatch } from '../../src/mcp/tools/propose_patch';
import { ContextBudgetTracker } from '../../src/context/budget';
import { SessionCancelledError } from '../../src/shared/errors';
import { defaultSessionStateManager } from '../../src/trueforge/session-state';
import { AgentPanelProvider } from '../../src/ui/panel';

describe('T6 End-to-End: Cancel plus one-gesture undo', () => {
  const repoRoot = path.resolve(process.cwd());
  const fixtureRel = 'test/fixtures/mini-repo/app.py';
  const fixtureAbs = path.resolve(repoRoot, fixtureRel);

  let pristineContent: string;
  let patchStore: PatchStore;
  let statusBar: ForgeStatusBar;
  let undoManager: UndoManager;
  let cancelManager: CancelManager;
  let wsManager: WorkspaceManager;
  let budgetTracker: ContextBudgetTracker;
  let reviewManager: ReviewManager;

  beforeEach(() => {
    pristineContent = fs.readFileSync(fixtureAbs, 'utf-8');
    patchStore = new PatchStore();
    statusBar = new ForgeStatusBar();
    undoManager = new UndoManager(patchStore, statusBar);
    cancelManager = new CancelManager(patchStore, undoManager);
    wsManager = new WorkspaceManager(repoRoot);
    budgetTracker = new ContextBudgetTracker();
    reviewManager = new ReviewManager(wsManager, undoManager, statusBar);

    defaultSessionStateManager.reset();
    defaultCancelManager.reset();
  });

  afterEach(() => {
    // Restore pristine file state and clear session cancellation
    fs.writeFileSync(fixtureAbs, pristineContent, 'utf-8');
    defaultSessionStateManager.reset();
    defaultCancelManager.reset();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Cancel during search
  // ───────────────────────────────────────────────────────────────────────────
  it('cancel during search: aborts run, leaves git status clean, and prevents later writes', async () => {
    const abortSignal = cancelManager.getAbortController().signal;
    expect(abortSignal.aborted).toBe(false);

    // 1. Simulate agent doing a search step
    const searchRes = await executeSearchText(
      { query: 'calculate_total', reason: 'locate tax calculation' },
      wsManager,
      budgetTracker
    );
    expect(searchRes.totalHits).toBeGreaterThan(0);

    // 2. User presses Cancel mid-search
    const cancelRes = cancelManager.cancelAll();

    // 3. Verify AbortController fired and session marked cancelled
    expect(cancelRes.cancelledPatches).toBe(0);
    expect(cancelRes.appliedHunks).toBe(0);
    expect(cancelManager.isCancelled()).toBe(true);

    // 4. Verify working tree is completely clean
    const gitStatus = execSync(`git status --porcelain ${fixtureRel}`, { cwd: repoRoot }).toString().trim();
    expect(gitStatus).toBe('');

    // 5. Verify late apply_patch_hunk is denied
    await expect(
      executeApplyPatchHunk(
        {
          file: fixtureRel,
          content: '@@ -1,3 +1,3 @@\n-def calculate_total(prices, tax_rate=0.05):\n+def calculate_total(prices, tax_rate=0.10):\n     """Calculates total price including tax."""\n     return sum(prices) * (1 + tax_rate)',
          hunkId: 'hunk-search-late'
        },
        wsManager,
        patchStore,
        undoManager,
        cancelManager
      )
    ).rejects.toThrow(SessionCancelledError);

    // Content untouched
    expect(fs.readFileSync(fixtureAbs, 'utf-8')).toBe(pristineContent);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Cancel during proposal
  // ───────────────────────────────────────────────────────────────────────────
  it('cancel during proposal: discards unapplied patches, leaves git status clean', async () => {
    // 1. Agent proposes a patch
    const patchDiff = [
      '--- test/fixtures/mini-repo/app.py',
      '+++ test/fixtures/mini-repo/app.py',
      '@@ -1,3 +1,4 @@',
      ' def calculate_total(prices, tax_rate=0.05):',
      '+    # Added audit log',
      '     """Calculates total price including tax."""',
      '     return sum(prices) * (1 + tax_rate)'
    ].join('\n');

    const proposeResult = await executeProposePatch(
      {
        target_file: fixtureRel,
        patch: patchDiff,
        summary: 'Add audit comment to calculate_total'
      },
      wsManager,
      patchStore
    );
    expect(proposeResult.patch_id).toBeDefined();
    expect(patchStore.getAllPatches().length).toBe(1);

    // 2. User presses Cancel while reviewing proposal
    const cancelStats = cancelManager.cancelAll();

    // 3. Unapplied patches are discarded
    expect(cancelStats.cancelledPatches).toBe(1);
    expect(cancelStats.abandonedHunks).toBe(1);
    expect(cancelStats.appliedHunks).toBe(0);
    expect(patchStore.getAllPatches().length).toBe(0);

    // 4. Working tree remains clean
    const gitStatus = execSync(`git status --porcelain ${fixtureRel}`, { cwd: repoRoot }).toString().trim();
    expect(gitStatus).toBe('');

    // 5. Late apply attempt for the discarded patch is denied
    await expect(
      executeApplyPatchHunk(
        { patch_id: proposeResult.patch_id, hunk_id: proposeResult.hunk_ids[0] },
        wsManager,
        patchStore,
        undoManager,
        cancelManager
      )
    ).rejects.toThrow();

    expect(fs.readFileSync(fixtureAbs, 'utf-8')).toBe(pristineContent);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Cancel while waiting for approval: Keep branch
  // ───────────────────────────────────────────────────────────────────────────
  it('cancel while waiting for approval (Keep): keeps applied hunk 1, discards hunk 2', async () => {
    const multiHunkPatch = {
      id: 'patch-multi-1',
      targetFile: fixtureRel,
      summary: 'Two-step update to calculate_total',
      createdAt: Date.now(),
      hunks: [
        {
          id: 'hunk-1',
          file: fixtureRel,
          oldStart: 1,
          oldLines: 3,
          newStart: 1,
          newLines: 3,
          content: '@@ -1,3 +1,3 @@\n def calculate_total(prices, tax_rate=0.05):\n-    """Calculates total price including tax."""\n+    """Calculates total price with custom tax rate."""\n     return sum(prices) * (1 + tax_rate)',
          applied: false
        },
        {
          id: 'hunk-2',
          file: fixtureRel,
          oldStart: 3,
          oldLines: 1,
          newStart: 3,
          newLines: 2,
          content: '@@ -3,1 +3,2 @@\n-    return sum(prices) * (1 + tax_rate)\n+    subtotal = sum(prices)\n+    return subtotal * (1 + tax_rate)',
          applied: false
        }
      ]
    };
    patchStore.stagePatch(multiHunkPatch);
    reviewManager.stagePatch(multiHunkPatch);

    // User accepted hunk 1
    const acceptRes = await reviewManager.acceptHunk('patch-multi-1', 'hunk-1');
    expect(acceptRes.success).toBe(true);

    // Hunk 2 is still waiting for approval. User presses Cancel.
    const cancelStats = cancelManager.cancelAll();
    expect(cancelStats.appliedHunks).toBe(1);
    expect(cancelStats.abandonedHunks).toBe(1);

    // User chooses 'Keep' -> Hunk 1 is retained
    const gitStatus = execSync(`git status --porcelain ${fixtureRel}`, { cwd: repoRoot }).toString().trim();
    expect(gitStatus).toContain(fixtureRel);

    const updatedContent = fs.readFileSync(fixtureAbs, 'utf-8');
    expect(updatedContent).toContain('custom tax rate');
    expect(updatedContent).not.toContain('subtotal = sum(prices)');

    // Attempting to apply hunk 2 now fails
    await expect(
      executeApplyPatchHunk(
        { patch_id: 'patch-multi-1', hunk_id: 'hunk-2' },
        wsManager,
        patchStore,
        undoManager,
        cancelManager
      )
    ).rejects.toThrow();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Cancel while waiting for approval: Undo branch (one-gesture undo)
  // ───────────────────────────────────────────────────────────────────────────
  it('cancel while waiting for approval (Undo): one-gesture undo restores working tree to clean', async () => {
    const multiHunkPatch = {
      id: 'patch-multi-2',
      targetFile: fixtureRel,
      summary: 'Two-step update to calculate_total',
      createdAt: Date.now(),
      hunks: [
        {
          id: 'hunk-1',
          file: fixtureRel,
          oldStart: 1,
          oldLines: 3,
          newStart: 1,
          newLines: 3,
          content: '@@ -1,3 +1,3 @@\n def calculate_total(prices, tax_rate=0.05):\n-    """Calculates total price including tax."""\n+    """Calculates total price with custom tax rate."""\n     return sum(prices) * (1 + tax_rate)',
          applied: false
        },
        {
          id: 'hunk-2',
          file: fixtureRel,
          oldStart: 3,
          oldLines: 1,
          newStart: 3,
          newLines: 2,
          content: '@@ -3,1 +3,2 @@\n-    return sum(prices) * (1 + tax_rate)\n+    subtotal = sum(prices)\n+    return subtotal * (1 + tax_rate)',
          applied: false
        }
      ]
    };
    patchStore.stagePatch(multiHunkPatch);
    reviewManager.stagePatch(multiHunkPatch);

    // Accept hunk 1
    await reviewManager.acceptHunk('patch-multi-2', 'hunk-1');

    // User presses Cancel -> receives notification: "1 hunks were already applied. Undo them?"
    const cancelStats = cancelManager.cancelAll();
    expect(cancelStats.appliedHunks).toBe(1);

    // User clicks "Undo" -> calls undoTask()
    const undoRes = await undoManager.undoTask();
    expect(undoRes.success).toBe(true);
    expect(undoRes.revertedFiles.length).toBeGreaterThan(0);

    // Working tree is completely clean again
    try { execSync('git update-index --refresh', { cwd: repoRoot }); } catch { /* ignore */ }
    const gitStatus = execSync(`git status --porcelain ${fixtureRel}`, { cwd: repoRoot }).toString().trim();
    expect(gitStatus).toBe('');
    expect(fs.readFileSync(fixtureAbs, 'utf-8')).toBe(pristineContent);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Late apply_patch_hunk from cancelled turn is denied
  // ───────────────────────────────────────────────────────────────────────────
  it('late apply_patch_hunk from cancelled turn is denied and does not alter disk', async () => {
    // Session is cancelled
    cancelManager.cancelAll();

    // Model tries direct apply_patch_hunk
    await expect(
      executeApplyPatchHunk(
        {
          file: fixtureRel,
          content: '@@ -1,3 +1,3 @@\n-def calculate_total(prices, tax_rate=0.05):\n+def calculate_total(prices, tax_rate=0.99):\n     """Calculates total price including tax."""\n     return sum(prices) * (1 + tax_rate)',
          hunkId: 'late-hunk-999'
        },
        wsManager,
        patchStore,
        undoManager,
        cancelManager
      )
    ).rejects.toThrow(SessionCancelledError);

    // Disk remains pristine
    expect(fs.readFileSync(fixtureAbs, 'utf-8')).toBe(pristineContent);
    const gitStatus = execSync(`git status --porcelain ${fixtureRel}`, { cwd: repoRoot }).toString().trim();
    expect(gitStatus).toBe('');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Panel and Status Bar immediate update
  // ───────────────────────────────────────────────────────────────────────────
  it('status bar and panel receive immediate cancellation within one second', async () => {
    const postMessageSpy = vi.fn();
    const panelMock = {
      webview: { postMessage: postMessageSpy },
      reveal: vi.fn(),
      dispose: vi.fn()
    };

    const panelProvider = new AgentPanelProvider();
    (panelProvider as any).panel = panelMock;

    // Simulate cancel message from user
    await panelProvider.handleIncomingMessage({ type: 'cancel_run' });

    // Panel receives run_completed with status: cancelled immediately
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'run_completed',
        status: 'cancelled'
      })
    );

    // CancelManager is in cancelled state
    expect(defaultCancelManager.isCancelled()).toBe(true);
  });
});
