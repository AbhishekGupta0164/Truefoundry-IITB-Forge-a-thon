/**
 * test/e2e/stage3-e2e.test.ts
 *
 * Implements Stage 3 Section 13: Required End-to-End Verification.
 * - Test A: Reject a hunk (git diff is clean)
 * - Test B: Accept hunk 1 and reject hunk 2 (only hunk 1 in git diff)
 * - Test C: Undo Whole Task (git diff returns to pristine)
 * - Test D: Manual edit and stale approval (denied, manual edit untouched)
 * - Test E: Approval pause (S3 spike execution)
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { ReviewManager } from '../../src/review/manager';
import { UndoManager } from '../../src/review/undo';
import { ForgeStatusBar } from '../../src/ui/status-bar';
import { WorkspaceManager } from '../../src/mcp/workspace';
import { ReviewPatch } from '../../src/shared/types';
import { StaleHunkError } from '../../src/shared/errors';
import { runS3Spike } from '../../spikes/s3-approval';

describe('Stage 3 End-to-End Verification (Section 13: Tests A - E)', () => {
  const repoRoot = path.resolve(process.cwd());
  const fixtureDir = path.resolve(repoRoot, 'test/fixtures/mini-repo');
  const targetRel = 'test/fixtures/mini-repo/app.py';
  const targetAbs = path.resolve(repoRoot, targetRel);

  let pristineContent: string;
  let wsManager: WorkspaceManager;
  let statusBar: ForgeStatusBar;
  let undoManager: UndoManager;
  let reviewManager: ReviewManager;

  beforeEach(() => {
    pristineContent = fs.readFileSync(targetAbs, 'utf-8');
    wsManager = new WorkspaceManager(repoRoot);
    statusBar = new ForgeStatusBar();
    undoManager = new UndoManager(undefined, statusBar);
    reviewManager = new ReviewManager(wsManager, undoManager, statusBar);
  });

  afterEach(() => {
    // Restore pristine file state
    fs.writeFileSync(targetAbs, pristineContent, 'utf-8');
    const scratch = path.join(fixtureDir, 'scratch_patch.txt');
    if (fs.existsSync(scratch)) {
      fs.unlinkSync(scratch);
    }
  });

  it('Test A: Reject a hunk and verify git diff is empty', async () => {
    const patch: ReviewPatch = {
      id: 'e2e-patch-a',
      targetFile: targetRel,
      summary: 'Test A Reject',
      createdAt: Date.now(),
      initialContent: pristineContent,
      hunks: [
        {
          id: 'e2e-h-a',
          file: targetRel,
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          content: '-def calculate_total(prices, tax_rate=0.05):\n+def calculate_total(prices, tax_rate=0.10):',
          status: 'pending'
        }
      ]
    };

    reviewManager.stagePatch(patch);
    const rejectRes = reviewManager.rejectHunk('e2e-patch-a', 'e2e-h-a');
    expect(rejectRes.success).toBe(true);

    const diff = execSync(`git diff ${targetRel}`, { encoding: 'utf-8' });
    expect(diff.trim()).toBe('');
  });

  it('Test B: Accept hunk 1 and reject hunk 2, verify git diff --stat shows only hunk 1', async () => {
    // Setup file with two distinct regions to edit
    const twoRegionContent = 'def calculate_total(prices, tax_rate=0.05):\n    """Calculates total price including tax."""\n    return sum(prices) * (1 + tax_rate)\n\ndef unused():\n    return False\n';
    fs.writeFileSync(targetAbs, twoRegionContent, 'utf-8');

    const patch: ReviewPatch = {
      id: 'e2e-patch-b',
      targetFile: targetRel,
      summary: 'Test B 2 Hunks',
      createdAt: Date.now(),
      initialContent: twoRegionContent,
      hunks: [
        {
          id: 'hunk-b1',
          file: targetRel,
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          content: '-def calculate_total(prices, tax_rate=0.05):\n+def calculate_total(prices, tax_rate=0.08):',
          status: 'pending'
        },
        {
          id: 'hunk-b2',
          file: targetRel,
          oldStart: 5,
          oldLines: 1,
          newStart: 5,
          newLines: 1,
          content: '-    return False\n+    return True',
          status: 'pending'
        }
      ]
    };

    reviewManager.stagePatch(patch);
    await reviewManager.acceptHunk('e2e-patch-b', 'hunk-b1');
    reviewManager.rejectHunk('e2e-patch-b', 'hunk-b2');

    const diff = execSync(`git diff ${targetRel}`, { encoding: 'utf-8' });
    expect(diff).toContain('tax_rate=0.08');
    expect(diff).not.toContain('return True');
  });

  it('Test C: Undo restores git diff to clean state', async () => {
    const taskId = 'e2e-task-c';
    const patch: ReviewPatch = {
      id: 'e2e-patch-c',
      targetFile: targetRel,
      summary: 'Test C Undo',
      createdAt: Date.now(),
      initialContent: pristineContent,
      taskId,
      hunks: [
        {
          id: 'hunk-c1',
          file: targetRel,
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          content: '-def calculate_total(prices, tax_rate=0.05):\n+def calculate_total(prices, tax_rate=0.20):',
          status: 'pending'
        }
      ]
    };

    reviewManager.stagePatch(patch);
    await reviewManager.acceptHunk('e2e-patch-c', 'hunk-c1', taskId);

    // Verify git diff is dirty
    const dirtyDiff = execSync(`git diff ${targetRel}`, { encoding: 'utf-8' });
    expect(dirtyDiff).toContain('tax_rate=0.20');

    // Run Undo
    const undoRes = await undoManager.undoTask(taskId);
    expect(undoRes.success).toBe(true);

    // Verify git diff is now clean
    const cleanDiff = execSync(`git diff ${targetRel}`, { encoding: 'utf-8' });
    expect(cleanDiff.trim()).toBe('');
  });

  it('Test D: Manual edit causes stale denial and preserves manual changes', async () => {
    const patch: ReviewPatch = {
      id: 'e2e-patch-d',
      targetFile: targetRel,
      summary: 'Test D Stale',
      createdAt: Date.now(),
      initialContent: pristineContent,
      hunks: [
        {
          id: 'hunk-d1',
          file: targetRel,
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          content: '-def calculate_total(prices, tax_rate=0.05):\n+def calculate_total(prices, tax_rate=0.15):',
          status: 'pending'
        }
      ]
    };

    reviewManager.stagePatch(patch);

    // User manually modifies the file line 1
    const userManualContent = 'def calculate_total(prices, tax_rate=0.99): # MANUAL\n    """Calculates total price including tax."""\n    return sum(prices) * (1 + tax_rate)\n';
    fs.writeFileSync(targetAbs, userManualContent, 'utf-8');

    // Attempt to accept old hunk
    await expect(reviewManager.acceptHunk('e2e-patch-d', 'hunk-d1')).rejects.toThrow(StaleHunkError);

    // Verify manual edit remains untouched
    const currentOnDisk = fs.readFileSync(targetAbs, 'utf-8');
    expect(currentOnDisk).toBe(userManualContent);
  });

  it('Test E: S3 Approval Pause Spike verifies allow for h1 and deny for h2', async () => {
    const report = await runS3Spike(true);
    expect(report.modelSeesDenialResult).toBe(true);
    expect(report.cancellationResult.turnStatusAfterCancel).toBe('cancelled');
  });
});
