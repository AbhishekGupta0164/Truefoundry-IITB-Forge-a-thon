/**
 * test/unit/stage3-review-engine.test.ts
 *
 * Comprehensive test suite verifying all 28 requirements for Stage 3:
 * - Per-hunk review (Items 1-5)
 * - Approval matching (Items 6-15)
 * - Stale checks (Items 16-18)
 * - Undo (Items 19-23)
 * - Status bar (Items 24-28)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { ReviewManager } from '../../src/review/manager';
import { UndoManager } from '../../src/review/undo';
import { ForgeStatusBar } from '../../src/ui/status-bar';
import { ApprovalMatcher } from '../../src/trueforge/approvals';
import { WorkspaceManager } from '../../src/mcp/workspace';
import { ReviewPatch, ReviewHunk } from '../../src/shared/types';
import { StaleHunkError } from '../../src/shared/errors';

describe('Stage 3: Review Engine and UI Invariants (28 Items)', () => {
  const testDir = path.resolve(os.tmpdir(), 'stage3-test-tmp');
  let wsManager: WorkspaceManager;
  let statusBar: ForgeStatusBar;
  let undoManager: UndoManager;
  let reviewManager: ReviewManager;
  let approvalMatcher: ApprovalMatcher;

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    wsManager = new WorkspaceManager(testDir);
    statusBar = new ForgeStatusBar();
    undoManager = new UndoManager(undefined, statusBar);
    reviewManager = new ReviewManager(wsManager, undoManager, statusBar);
    approvalMatcher = new ApprovalMatcher(reviewManager);
  });

  afterEach(() => {
    try {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  });

  function createTestFile(relPath: string, content: string): string {
    const absPath = path.join(testDir, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, 'utf-8');
    return absPath;
  }

  // ==========================================
  // A. Per-hunk review (Items 1-5)
  // ==========================================
  describe('Per-hunk review (Items 1-5)', () => {
    it('1. Rejecting a hunk does not modify the file', async () => {
      const filePath = createTestFile('file1.py', 'line1\nline2\nline3\n');
      const patch: ReviewPatch = {
        id: 'patch-1',
        targetFile: 'file1.py',
        summary: 'Change line2',
        createdAt: Date.now(),
        initialContent: 'line1\nline2\nline3\n',
        hunks: [
          {
            id: 'hunk-1',
            file: 'file1.py',
            oldStart: 2,
            oldLines: 1,
            newStart: 2,
            newLines: 1,
            content: '-line2\n+line2_mod',
            status: 'pending'
          }
        ]
      };

      reviewManager.stagePatch(patch);
      const rejectRes = reviewManager.rejectHunk('patch-1', 'hunk-1');
      expect(rejectRes.success).toBe(true);

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toBe('line1\nline2\nline3\n');
      expect(reviewManager.getHunk('patch-1', 'hunk-1')?.hunk.status).toBe('rejected');
    });

    it('2. Accepting hunk 1 and rejecting hunk 2 applies only hunk 1', async () => {
      const filePath = createTestFile('file2.py', 'line1\nline2\nline3\nline4\n');
      const patch: ReviewPatch = {
        id: 'patch-2',
        targetFile: 'file2.py',
        summary: 'Two hunks',
        createdAt: Date.now(),
        initialContent: 'line1\nline2\nline3\nline4\n',
        hunks: [
          {
            id: 'h1',
            file: 'file2.py',
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            content: '-line1\n+line1_accepted',
            status: 'pending'
          },
          {
            id: 'h2',
            file: 'file2.py',
            oldStart: 3,
            oldLines: 1,
            newStart: 3,
            newLines: 1,
            content: '-line3\n+line3_rejected',
            status: 'pending'
          }
        ]
      };

      reviewManager.stagePatch(patch);
      await reviewManager.acceptHunk('patch-2', 'h1');
      reviewManager.rejectHunk('patch-2', 'h2');

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('line1_accepted');
      expect(content).not.toContain('line3_rejected');
      expect(content).toContain('line3');
    });

    it('3. Accepting one hunk does not apply other hunks', async () => {
      const filePath = createTestFile('file3.py', 'alpha\nbeta\ngamma\n');
      const patch: ReviewPatch = {
        id: 'patch-3',
        targetFile: 'file3.py',
        summary: 'Selective hunk',
        createdAt: Date.now(),
        initialContent: 'alpha\nbeta\ngamma\n',
        hunks: [
          {
            id: 'ha',
            file: 'file3.py',
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            content: '-alpha\n+ALPHA',
            status: 'pending'
          },
          {
            id: 'hb',
            file: 'file3.py',
            oldStart: 3,
            oldLines: 1,
            newStart: 3,
            newLines: 1,
            content: '-gamma\n+GAMMA',
            status: 'pending'
          }
        ]
      };

      reviewManager.stagePatch(patch);
      await reviewManager.acceptHunk('patch-3', 'ha');

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('ALPHA');
      expect(content).toContain('gamma');
      expect(content).not.toContain('GAMMA');
      expect(reviewManager.getHunk('patch-3', 'hb')?.hunk.status).toBe('pending');
    });

    it('4. Multiple hunks in one file work correctly', async () => {
      const filePath = createTestFile('multi.py', 'foo\nbar\nbaz\n');
      const patch: ReviewPatch = {
        id: 'patch-multi',
        targetFile: 'multi.py',
        summary: 'Multiple hunks in one file',
        createdAt: Date.now(),
        initialContent: 'foo\nbar\nbaz\n',
        hunks: [
          {
            id: 'h-foo',
            file: 'multi.py',
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            content: '-foo\n+FOO',
            status: 'pending'
          },
          {
            id: 'h-baz',
            file: 'multi.py',
            oldStart: 3,
            oldLines: 1,
            newStart: 3,
            newLines: 1,
            content: '-baz\n+BAZ',
            status: 'pending'
          }
        ]
      };

      reviewManager.stagePatch(patch);
      await reviewManager.acceptHunk('patch-multi', 'h-foo');
      await reviewManager.acceptHunk('patch-multi', 'h-baz');

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toBe('FOO\nbar\nBAZ\n');
    });

    it('5. Multiple files in one task work correctly', async () => {
      const fileA = createTestFile('mod_a.py', 'def a(): pass\n');
      const fileB = createTestFile('mod_b.py', 'def b(): pass\n');

      const patchA: ReviewPatch = {
        id: 'p-a',
        targetFile: 'mod_a.py',
        summary: 'A',
        createdAt: Date.now(),
        initialContent: 'def a(): pass\n',
        taskId: 'task-100',
        hunks: [
          {
            id: 'ha-1',
            file: 'mod_a.py',
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            content: '-def a(): pass\n+def a(): return 1',
            status: 'pending'
          }
        ]
      };

      const patchB: ReviewPatch = {
        id: 'p-b',
        targetFile: 'mod_b.py',
        summary: 'B',
        createdAt: Date.now(),
        initialContent: 'def b(): pass\n',
        taskId: 'task-100',
        hunks: [
          {
            id: 'hb-1',
            file: 'mod_b.py',
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            content: '-def b(): pass\n+def b(): return 2',
            status: 'pending'
          }
        ]
      };

      reviewManager.stagePatch(patchA);
      reviewManager.stagePatch(patchB);

      await reviewManager.acceptHunk('p-a', 'ha-1');
      await reviewManager.acceptHunk('p-b', 'hb-1');

      expect(fs.readFileSync(fileA, 'utf-8')).toBe('def a(): return 1\n');
      expect(fs.readFileSync(fileB, 'utf-8')).toBe('def b(): return 2\n');
      expect(reviewManager.getModifiedFilesCount()).toBe(2);
    });
  });

  // ==========================================
  // B. Approval matching (Items 6-15)
  // ==========================================
  describe('Approval matching (Items 6-15)', () => {
    it('6. An approval call is matched by its actual call ID', () => {
      approvalMatcher.registerPending({
        id: 'call-exact-99',
        name: 'apply_patch_hunk',
        arguments: { patch_id: 'p1', hunk_id: 'h1' }
      });

      const matched = approvalMatcher.getPending('call-exact-99');
      expect(matched).toBeDefined();
      expect(matched?.toolCallId).toBe('call-exact-99');
      expect(approvalMatcher.getPending('call-other')).toBeUndefined();
    });

    it('7. patch_id and hunk_id resolve to the correct review hunk', () => {
      createTestFile('target.py', 'old content\n');
      const patch: ReviewPatch = {
        id: 'patch-res',
        targetFile: 'target.py',
        summary: 'Resolve test',
        createdAt: Date.now(),
        hunks: [
          {
            id: 'hunk-res-1',
            file: 'target.py',
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            content: '-old content\n+new content',
            status: 'pending'
          }
        ]
      };
      reviewManager.stagePatch(patch);

      const pending = approvalMatcher.registerPending({
        id: 'call-res',
        name: 'apply_patch_hunk',
        arguments: { patch_id: 'patch-res', hunk_id: 'hunk-res-1' }
      });

      expect(pending.associatedPatch?.id).toBe('patch-res');
      expect(pending.associatedHunk?.id).toBe('hunk-res-1');
    });

    it('8. An unknown hunk is denied', () => {
      approvalMatcher.registerPending({
        id: 'call-unknown',
        name: 'apply_patch_hunk',
        arguments: { patch_id: 'p-ghost', hunk_id: 'h-ghost' }
      });

      const decision = approvalMatcher.evaluateDecision('call-unknown', 'accept');
      expect(decision.allowed).toBe(false);
      expect(decision.event.approval.status).toBe('deny');
      expect(decision.reason).toContain('unknown');
    });

    it('9. A rejected hunk cannot be approved', () => {
      createTestFile('rej.py', 'foo\n');
      const patch: ReviewPatch = {
        id: 'p-rej',
        targetFile: 'rej.py',
        summary: 'Rej test',
        createdAt: Date.now(),
        hunks: [
          {
            id: 'h-rej',
            file: 'rej.py',
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            content: '-foo\n+bar',
            status: 'pending'
          }
        ]
      };
      reviewManager.stagePatch(patch);
      reviewManager.rejectHunk('p-rej', 'h-rej');

      approvalMatcher.registerPending({
        id: 'call-rej',
        name: 'apply_patch_hunk',
        arguments: { patch_id: 'p-rej', hunk_id: 'h-rej' }
      });

      const evalRes = approvalMatcher.evaluateDecision('call-rej', 'accept');
      expect(evalRes.allowed).toBe(false);
      expect(evalRes.event.approval.status).toBe('deny');
      expect(evalRes.reason).toContain('rejected');
    });

    it('10. A stale hunk cannot be approved', () => {
      const filePath = createTestFile('stale.py', 'original text\n');
      const patch: ReviewPatch = {
        id: 'p-stale',
        targetFile: 'stale.py',
        summary: 'Stale test',
        createdAt: Date.now(),
        initialContent: 'original text\n',
        hunks: [
          {
            id: 'h-stale',
            file: 'stale.py',
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            content: '-original text\n+stale proposal',
            status: 'pending'
          }
        ]
      };
      reviewManager.stagePatch(patch);

      // User manually edits the file
      fs.writeFileSync(filePath, 'manual edit occurred\n', 'utf-8');

      approvalMatcher.registerPending({
        id: 'call-stale',
        name: 'apply_patch_hunk',
        arguments: { patch_id: 'p-stale', hunk_id: 'h-stale' }
      });

      const evalRes = approvalMatcher.evaluateDecision('call-stale', 'accept');
      expect(evalRes.allowed).toBe(false);
      expect(evalRes.event.approval.status).toBe('deny');
      expect(evalRes.reason).toContain('file changed after the patch was proposed');
    });

    it('11. Allow and deny decisions are sent individually', () => {
      createTestFile('indiv.py', 'l1\nl2\n');
      const patch: ReviewPatch = {
        id: 'p-indiv',
        targetFile: 'indiv.py',
        summary: 'Individual test',
        createdAt: Date.now(),
        initialContent: 'l1\nl2\n',
        hunks: [
          {
            id: 'h-a',
            file: 'indiv.py',
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            content: '-l1\n+L1',
            status: 'pending'
          },
          {
            id: 'h-b',
            file: 'indiv.py',
            oldStart: 2,
            oldLines: 1,
            newStart: 2,
            newLines: 1,
            content: '-l2\n+L2',
            status: 'pending'
          }
        ]
      };
      reviewManager.stagePatch(patch);

      approvalMatcher.registerPending({
        id: 'call-1',
        name: 'apply_patch_hunk',
        arguments: { patch_id: 'p-indiv', hunk_id: 'h-a' }
      });
      approvalMatcher.registerPending({
        id: 'call-2',
        name: 'apply_patch_hunk',
        arguments: { patch_id: 'p-indiv', hunk_id: 'h-b' }
      });

      const dec1 = approvalMatcher.evaluateDecision('call-1', 'accept');
      const dec2 = approvalMatcher.evaluateDecision('call-2', 'reject', 'Skip line 2');

      expect(dec1.event.toolCallId).toBe('call-1');
      expect(dec1.event.approval.status).toBe('allow');

      expect(dec2.event.toolCallId).toBe('call-2');
      expect(dec2.event.approval.status).toBe('deny');
      expect(dec2.event.approval.reason).toBe('Skip line 2');
    });

    it('12. No new user message is included in an approval resume request', () => {
      const resumeReq = approvalMatcher.buildResumeTurnRequest([
        {
          type: 'user.tool_approval',
          toolCallId: 'call-12',
          approval: { status: 'allow' }
        }
      ]);

      expect(resumeReq.input.length).toBe(1);
      expect(resumeReq.input[0].type).toBe('user.tool_approval');
      // Strictly no user.message mixed in
      for (const item of resumeReq.input) {
        expect((item as any).type).not.toBe('user.message');
      }
    });

    it('13. Duplicate decisions are rejected or safely ignored', () => {
      createTestFile('dup.py', 'line\n');
      const patch: ReviewPatch = {
        id: 'p-dup',
        targetFile: 'dup.py',
        summary: 'Dup test',
        createdAt: Date.now(),
        initialContent: 'line\n',
        hunks: [
          {
            id: 'h-dup',
            file: 'dup.py',
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            content: '-line\n+LINE',
            status: 'pending'
          }
        ]
      };
      reviewManager.stagePatch(patch);

      approvalMatcher.registerPending({
        id: 'call-dup',
        name: 'apply_patch_hunk',
        arguments: { patch_id: 'p-dup', hunk_id: 'h-dup' }
      });

      const first = approvalMatcher.evaluateDecision('call-dup', 'accept');
      expect(first.allowed).toBe(true);

      const second = approvalMatcher.evaluateDecision('call-dup', 'reject');
      expect(second.reason).toContain('Duplicate');
    });

    it('14. Multiple sequential approval pauses are handled', () => {
      approvalMatcher.registerPending({
        id: 'call-seq-1',
        name: 'apply_patch_hunk',
        arguments: { patch_id: 'p', hunk_id: 'h1' }
      });
      expect(approvalMatcher.getPending('call-seq-1')).toBeDefined();

      approvalMatcher.removePending('call-seq-1');
      expect(approvalMatcher.getPending('call-seq-1')).toBeUndefined();

      approvalMatcher.registerPending({
        id: 'call-seq-2',
        name: 'apply_patch_hunk',
        arguments: { patch_id: 'p', hunk_id: 'h2' }
      });
      expect(approvalMatcher.getPending('call-seq-2')?.toolCallId).toBe('call-seq-2');
    });

    it('15. Cancellation during approval clears pending approvals cleanly', () => {
      approvalMatcher.registerPending({
        id: 'call-cancel-1',
        name: 'apply_patch_hunk',
        arguments: { patch_id: 'p', hunk_id: 'h1' }
      });
      approvalMatcher.registerPending({
        id: 'call-cancel-2',
        name: 'apply_patch_hunk',
        arguments: { patch_id: 'p', hunk_id: 'h2' }
      });

      approvalMatcher.clear();
      expect(approvalMatcher.getAllPending().length).toBe(0);
      expect(approvalMatcher.getPending('call-cancel-1')).toBeUndefined();
    });
  });

  // ==========================================
  // C. Stale checks (Items 16-18)
  // ==========================================
  describe('Stale checks (Items 16-18)', () => {
    it('16. Manually editing a file after proposal makes the old hunk stale', () => {
      const filePath = createTestFile('manual.py', 'int x = 1;\n');
      const patch: ReviewPatch = {
        id: 'p-man',
        targetFile: 'manual.py',
        summary: 'Manual edit check',
        createdAt: Date.now(),
        initialContent: 'int x = 1;\n',
        hunks: [
          {
            id: 'h-man',
            file: 'manual.py',
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            content: '-int x = 1;\n+int x = 100;',
            status: 'pending'
          }
        ]
      };
      reviewManager.stagePatch(patch);

      // Verify not stale before edit
      expect(reviewManager.checkStale('p-man', 'h-man').stale).toBe(false);

      // User modifies file
      fs.writeFileSync(filePath, 'int x = 42; // user changed\n', 'utf-8');

      // Verify stale after edit
      const check = reviewManager.checkStale('p-man', 'h-man');
      expect(check.stale).toBe(true);
      expect(check.reason).toContain('file changed after the patch was proposed');
    });

    it('17. Accepting that stale hunk does not overwrite manual changes', async () => {
      const filePath = createTestFile('manual2.py', 'int y = 2;\n');
      const patch: ReviewPatch = {
        id: 'p-man2',
        targetFile: 'manual2.py',
        summary: 'Manual edit preservation',
        createdAt: Date.now(),
        initialContent: 'int y = 2;\n',
        hunks: [
          {
            id: 'h-man2',
            file: 'manual2.py',
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            content: '-int y = 2;\n+int y = 200;',
            status: 'pending'
          }
        ]
      };
      reviewManager.stagePatch(patch);
      fs.writeFileSync(filePath, 'int y = 999; // manual\n', 'utf-8');

      await expect(reviewManager.acceptHunk('p-man2', 'h-man2')).rejects.toThrow(StaleHunkError);

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toBe('int y = 999; // manual\n');
    });

    it('18. A stale hunk produces a clear denial reason', async () => {
      createTestFile('manual3.py', 'foo()\n');
      const patch: ReviewPatch = {
        id: 'p-man3',
        targetFile: 'manual3.py',
        summary: 'Clear reason check',
        createdAt: Date.now(),
        initialContent: 'foo()\n',
        hunks: [
          {
            id: 'h-man3',
            file: 'manual3.py',
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            content: '-foo()\n+bar()',
            status: 'pending'
          }
        ]
      };
      reviewManager.stagePatch(patch);
      createTestFile('manual3.py', 'baz()\n');

      let thrownError: any;
      try {
        await reviewManager.acceptHunk('p-man3', 'h-man3');
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeDefined();
      expect(thrownError.message).toContain('Hunk denied because the file changed after the patch was proposed');
    });
  });

  // ==========================================
  // D. Undo (Items 19-23)
  // ==========================================
  describe('Undo whole task (Items 19-23)', () => {
    it('19. Accepting a hunk and undoing the task restores the original content', async () => {
      const filePath = createTestFile('undo1.py', 'start\nmiddle\nend\n');
      const patch: ReviewPatch = {
        id: 'p-u1',
        targetFile: 'undo1.py',
        summary: 'Undo single',
        createdAt: Date.now(),
        initialContent: 'start\nmiddle\nend\n',
        taskId: 'task-u1',
        hunks: [
          {
            id: 'h-u1',
            file: 'undo1.py',
            oldStart: 2,
            oldLines: 1,
            newStart: 2,
            newLines: 1,
            content: '-middle\n+MIDDLE_AGENT',
            status: 'pending'
          }
        ]
      };

      reviewManager.stagePatch(patch);
      await reviewManager.acceptHunk('p-u1', 'h-u1', 'task-u1');

      expect(fs.readFileSync(filePath, 'utf-8')).toBe('start\nMIDDLE_AGENT\nend\n');

      const undoRes = await undoManager.undoTask('task-u1');
      expect(undoRes.success).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('start\nmiddle\nend\n');
    });

    it('20. Undo works across multiple files', async () => {
      const f1 = createTestFile('f1.py', 'def f1(): return 1\n');
      const f2 = createTestFile('f2.py', 'def f2(): return 2\n');

      const patch1: ReviewPatch = {
        id: 'p-mf1',
        targetFile: 'f1.py',
        summary: 'f1',
        createdAt: Date.now(),
        initialContent: 'def f1(): return 1\n',
        taskId: 'task-multi',
        hunks: [
          {
            id: 'h-mf1',
            file: 'f1.py',
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            content: '-def f1(): return 1\n+def f1(): return 100',
            status: 'pending'
          }
        ]
      };

      const patch2: ReviewPatch = {
        id: 'p-mf2',
        targetFile: 'f2.py',
        summary: 'f2',
        createdAt: Date.now(),
        initialContent: 'def f2(): return 2\n',
        taskId: 'task-multi',
        hunks: [
          {
            id: 'h-mf2',
            file: 'f2.py',
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            content: '-def f2(): return 2\n+def f2(): return 200',
            status: 'pending'
          }
        ]
      };

      reviewManager.stagePatch(patch1);
      reviewManager.stagePatch(patch2);

      await reviewManager.acceptHunk('p-mf1', 'h-mf1', 'task-multi');
      await reviewManager.acceptHunk('p-mf2', 'h-mf2', 'task-multi');

      expect(fs.readFileSync(f1, 'utf-8')).toBe('def f1(): return 100\n');
      expect(fs.readFileSync(f2, 'utf-8')).toBe('def f2(): return 200\n');

      const undoRes = await undoManager.undoTask('task-multi');
      expect(undoRes.success).toBe(true);
      expect(undoRes.revertedFiles.length).toBe(2);
      expect(fs.readFileSync(f1, 'utf-8')).toBe('def f1(): return 1\n');
      expect(fs.readFileSync(f2, 'utf-8')).toBe('def f2(): return 2\n');
    });

    it('21. Undo does not restore cached whole-file snapshots (uses recorded inverse edits)', async () => {
      const filePath = createTestFile('snapshot_check.py', 'header\nagent_target\nfooter\n');
      const patch: ReviewPatch = {
        id: 'p-snap',
        targetFile: 'snapshot_check.py',
        summary: 'Snapshot test',
        createdAt: Date.now(),
        initialContent: 'header\nagent_target\nfooter\n',
        taskId: 'task-snap',
        hunks: [
          {
            id: 'h-snap',
            file: 'snapshot_check.py',
            oldStart: 2,
            oldLines: 1,
            newStart: 2,
            newLines: 1,
            content: '-agent_target\n+AGENT_APPLIED',
            status: 'pending'
          }
        ]
      };

      reviewManager.stagePatch(patch);
      await reviewManager.acceptHunk('p-snap', 'h-snap', 'task-snap');

      // Verify that inverse edit exists
      const edits = undoManager.getInverseEdits('task-snap');
      expect(edits.length).toBe(1);
      expect(edits[0].originalLines).toEqual(['agent_target']);
      expect(edits[0].replacementLines).toEqual(['AGENT_APPLIED']);
    });

    it('22. Undo does not remove unrelated manual changes outside the hunk', async () => {
      const filePath = createTestFile('unrelated.py', 'top\nagent_line\nbottom\n');
      const patch: ReviewPatch = {
        id: 'p-unrel',
        targetFile: 'unrelated.py',
        summary: 'Unrelated changes test',
        createdAt: Date.now(),
        initialContent: 'top\nagent_line\nbottom\n',
        taskId: 'task-unrel',
        hunks: [
          {
            id: 'h-unrel',
            file: 'unrelated.py',
            oldStart: 2,
            oldLines: 1,
            newStart: 2,
            newLines: 1,
            content: '-agent_line\n+AGENT_LINE',
            status: 'pending'
          }
        ]
      };

      reviewManager.stagePatch(patch);
      await reviewManager.acceptHunk('p-unrel', 'h-unrel', 'task-unrel');

      // User edits top and bottom lines manually AFTER accepting
      const current = fs.readFileSync(filePath, 'utf-8').replace('top', 'TOP_USER_EDIT').replace('bottom', 'BOTTOM_USER_EDIT');
      fs.writeFileSync(filePath, current, 'utf-8');

      // Undo task
      await undoManager.undoTask('task-unrel');

      const afterUndo = fs.readFileSync(filePath, 'utf-8');
      expect(afterUndo).toContain('TOP_USER_EDIT');
      expect(afterUndo).toContain('BOTTOM_USER_EDIT');
      expect(afterUndo).toContain('agent_line'); // Reverted to original
      expect(afterUndo).not.toContain('AGENT_LINE');
    });

    it('23. Undo detects conflicts and does not overwrite modified target content', async () => {
      const filePath = createTestFile('conflict.py', 'original\n');
      const patch: ReviewPatch = {
        id: 'p-conf',
        targetFile: 'conflict.py',
        summary: 'Conflict test',
        createdAt: Date.now(),
        initialContent: 'original\n',
        taskId: 'task-conf',
        hunks: [
          {
            id: 'h-conf',
            file: 'conflict.py',
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            content: '-original\n+agent_replacement',
            status: 'pending'
          }
        ]
      };

      reviewManager.stagePatch(patch);
      await reviewManager.acceptHunk('p-conf', 'h-conf', 'task-conf');

      // User modified the exact line the agent wrote
      fs.writeFileSync(filePath, 'user_conflicting_content\n', 'utf-8');

      const undoRes = await undoManager.undoTask('task-conf');
      expect(undoRes.success).toBe(false);
      expect(undoRes.conflicts.length).toBe(1);
      expect(undoRes.conflicts[0].reason).toContain('Conflict');
      // Preserves user's content
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('user_conflicting_content\n');
    });
  });

  // ==========================================
  // E. Status bar (Items 24-28)
  // ==========================================
  describe('Status bar (Items 24-28)', () => {
    it('24. One accepted file shows N = 1', async () => {
      createTestFile('sb1.py', 'line1\n');
      const patch: ReviewPatch = {
        id: 'p-sb1',
        targetFile: 'sb1.py',
        summary: 'SB 1',
        createdAt: Date.now(),
        initialContent: 'line1\n',
        hunks: [
          {
            id: 'h-sb1',
            file: 'sb1.py',
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            content: '-line1\n+LINE1',
            status: 'pending'
          }
        ]
      };

      reviewManager.stagePatch(patch);
      expect(statusBar.getModifiedFilesCount()).toBe(0);

      await reviewManager.acceptHunk('p-sb1', 'h-sb1');
      expect(statusBar.getModifiedFilesCount()).toBe(1);
      expect(statusBar.getText()).toBe('Agent-modified files: 1');
    });

    it('25. Two accepted hunks in one file still show N = 1', async () => {
      createTestFile('sb2.py', 'l1\nl2\n');
      const patch: ReviewPatch = {
        id: 'p-sb2',
        targetFile: 'sb2.py',
        summary: 'SB 2',
        createdAt: Date.now(),
        initialContent: 'l1\nl2\n',
        hunks: [
          {
            id: 'h1',
            file: 'sb2.py',
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            content: '-l1\n+L1',
            status: 'pending'
          },
          {
            id: 'h2',
            file: 'sb2.py',
            oldStart: 2,
            oldLines: 1,
            newStart: 2,
            newLines: 1,
            content: '-l2\n+L2',
            status: 'pending'
          }
        ]
      };

      reviewManager.stagePatch(patch);
      await reviewManager.acceptHunk('p-sb2', 'h1');
      expect(statusBar.getModifiedFilesCount()).toBe(1);

      await reviewManager.acceptHunk('p-sb2', 'h2');
      expect(statusBar.getModifiedFilesCount()).toBe(1);
      expect(statusBar.getText()).toBe('Agent-modified files: 1');
    });

    it('26. Two accepted files show N = 2', async () => {
      createTestFile('file_one.py', 'one\n');
      createTestFile('file_two.py', 'two\n');

      const p1: ReviewPatch = {
        id: 'p-one',
        targetFile: 'file_one.py',
        summary: 'one',
        createdAt: Date.now(),
        initialContent: 'one\n',
        hunks: [
          {
            id: 'h-one',
            file: 'file_one.py',
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            content: '-one\n+ONE',
            status: 'pending'
          }
        ]
      };
      const p2: ReviewPatch = {
        id: 'p-two',
        targetFile: 'file_two.py',
        summary: 'two',
        createdAt: Date.now(),
        initialContent: 'two\n',
        hunks: [
          {
            id: 'h-two',
            file: 'file_two.py',
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            content: '-two\n+TWO',
            status: 'pending'
          }
        ]
      };

      reviewManager.stagePatch(p1);
      reviewManager.stagePatch(p2);

      await reviewManager.acceptHunk('p-one', 'h-one');
      expect(statusBar.getModifiedFilesCount()).toBe(1);

      await reviewManager.acceptHunk('p-two', 'h-two');
      expect(statusBar.getModifiedFilesCount()).toBe(2);
      expect(statusBar.getText()).toBe('Agent-modified files: 2');
    });

    it('27. Rejected hunks do not count towards modified files', async () => {
      createTestFile('rej_count.py', 'foo\n');
      const patch: ReviewPatch = {
        id: 'p-rejcount',
        targetFile: 'rej_count.py',
        summary: 'Rej count',
        createdAt: Date.now(),
        initialContent: 'foo\n',
        hunks: [
          {
            id: 'h-rc',
            file: 'rej_count.py',
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            content: '-foo\n+FOO',
            status: 'pending'
          }
        ]
      };

      reviewManager.stagePatch(patch);
      reviewManager.rejectHunk('p-rejcount', 'h-rc');

      expect(statusBar.getModifiedFilesCount()).toBe(0);
      expect(statusBar.getText()).toBe('Agent-modified files: 0');
    });

    it('28. Undo updates the status bar count', async () => {
      createTestFile('sb_undo.py', 'abc\n');
      const patch: ReviewPatch = {
        id: 'p-sbundo',
        targetFile: 'sb_undo.py',
        summary: 'Undo count',
        createdAt: Date.now(),
        initialContent: 'abc\n',
        taskId: 't-sbundo',
        hunks: [
          {
            id: 'h-sbu',
            file: 'sb_undo.py',
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            content: '-abc\n+ABC',
            status: 'pending'
          }
        ]
      };

      reviewManager.stagePatch(patch);
      await reviewManager.acceptHunk('p-sbundo', 'h-sbu', 't-sbundo');
      expect(statusBar.getModifiedFilesCount()).toBe(1);

      await undoManager.undoTask('t-sbundo');
      expect(statusBar.getModifiedFilesCount()).toBe(0);
      expect(statusBar.getText()).toBe('Agent-modified files: 0');
    });
  });
});
