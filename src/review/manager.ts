/**
 * ReviewManager
 *
 * Implements Stage 3 per-hunk review engine, tracking proposed patches,
 * review statuses (pending, accepted, rejected, stale, applied, failed),
 * per-hunk Accept/Reject actions, stale hunk detection, and status-bar coordination.
 */

import * as fs from 'fs';
import { locateHunk } from './apply';
import { PatchStore, defaultPatchStore, StagedPatch } from './store';
import { ReviewPatch, ReviewHunk } from '../shared/types';
import { StaleHunkError } from '../shared/errors';
import { WorkspaceManager } from '../mcp/workspace';
import { defaultUndoManager, UndoManager } from './undo';
import { defaultStatusBar, ForgeStatusBar } from '../ui/status-bar';
import { executeApplyPatchHunk } from '../mcp/tools/apply_patch_hunk';
import { defaultCancelManager } from './cancel';

export class ReviewManager {
  private patches = new Map<string, ReviewPatch>();
  private activeTaskId = 'default-task';

  constructor(
    private readonly workspaceManager: WorkspaceManager = new WorkspaceManager(),
    private readonly undoManager: UndoManager = defaultUndoManager,
    private readonly statusBar: ForgeStatusBar = defaultStatusBar,
    private readonly patchStore: PatchStore = new PatchStore()
  ) {}

  /**
   * Patches proposed over MCP (propose_edit / propose_patch) are staged in the PatchStore.
   * Adopt them here, by reference, so CodeLens Accept / Reject can review them and the
   * applied state stays shared with apply_patch_hunk.
   */
  private adoptFromStore(patchId: string): ReviewPatch | undefined {
    const staged = this.patchStore.getPatch(patchId);
    if (!staged) return undefined;
    this.stagePatch(staged as ReviewPatch);
    return this.patches.get(patchId);
  }

  public setActiveTaskId(taskId: string): void {
    this.activeTaskId = taskId;
  }

  public getActiveTaskId(): string {
    return this.activeTaskId;
  }

  /**
   * Stage a newly proposed patch for review.
   */
  public stagePatch(patch: ReviewPatch): void {
    // Ensure all hunks have pending status by default
    for (const hunk of patch.hunks) {
      if (!hunk.status) {
        hunk.status = 'pending';
      }
      if (!hunk.taskId) {
        hunk.taskId = patch.taskId || this.activeTaskId;
      }
    }
    this.patches.set(patch.id, patch);
    this.patchStore.stagePatch(patch as StagedPatch);
    this.updateStatusBar();
  }

  public getPatch(patchId: string): ReviewPatch | undefined {
    return this.patches.get(patchId) ?? this.adoptFromStore(patchId);
  }

  public getAllPatches(): ReviewPatch[] {
    for (const staged of this.patchStore.getAllPatches()) {
      if (!this.patches.has(staged.id)) this.adoptFromStore(staged.id);
    }
    return Array.from(this.patches.values());
  }

  public getHunk(patchId: string, hunkId: string): { patch: ReviewPatch; hunk: ReviewHunk } | undefined {
    const patch = this.getPatch(patchId);
    if (!patch) return undefined;
    const hunk = patch.hunks.find((h) => h.id === hunkId);
    if (!hunk) return undefined;
    return { patch, hunk };
  }

  /**
   * Check whether a hunk is stale against current file state.
   */
  public checkStale(patchId: string, hunkId: string): { stale: boolean; reason?: string } {
    const match = this.getHunk(patchId, hunkId);
    if (!match) {
      return { stale: true, reason: `Unknown patch ${patchId} or hunk ${hunkId}` };
    }
    const { patch, hunk } = match;
    const absPath = this.workspaceManager.resolveSafePath(hunk.file);

    if (!fs.existsSync(absPath)) {
      return { stale: true, reason: `Target file does not exist: ${hunk.file}` };
    }

    const currentContent = fs.readFileSync(absPath, 'utf-8');
    const currentLines = currentContent.split(/\r?\n/);

    // If initialContent was recorded and current content differs from initial
    if (patch.initialContent !== undefined && patch.initialContent !== currentContent) {
      // Check if the specific lines targeted by this hunk were modified
      const hunkLines = hunk.content.split('\n');
      const expectedOldLines = hunkLines
        .filter((l) => l.startsWith(' ') || l.startsWith('-'))
        .map((l) => l.slice(1));

      const matches = locateHunk(currentLines, expectedOldLines, Math.max(0, hunk.oldStart - 1)) !== -1;

      if (!matches) {
        return {
          stale: true,
          reason: 'Hunk denied because the file changed after the patch was proposed.'
        };
      }
    }

    // Verify context lines match directly
    const hunkLines = hunk.content.split('\n');
    const expectedOldLines = hunkLines
      .filter((l) => l.startsWith(' ') || l.startsWith('-'))
      .map((l) => l.slice(1));

    if (expectedOldLines.length > 0) {
      const directMatch = locateHunk(currentLines, expectedOldLines, Math.max(0, hunk.oldStart - 1)) !== -1;

      if (!directMatch) {
        return {
          stale: true,
          reason: 'Hunk denied because the file changed after the patch was proposed.'
        };
      }
    }

    return { stale: false };
  }

  /**
   * Accept and apply an individual hunk to disk using WorkspaceEdit.
   */
  public async acceptHunk(
    patchId: string,
    hunkId: string,
    taskId?: string
  ): Promise<{ success: boolean; message: string }> {
    const match = this.getHunk(patchId, hunkId);
    if (!match) {
      throw new Error(`Invalid patch ID '${patchId}' or hunk ID '${hunkId}'`);
    }

    const { patch, hunk } = match;

    if (hunk.status === 'rejected') {
      throw new Error(`Cannot accept previously rejected hunk ${hunkId}`);
    }
    if (hunk.status === 'applied' || hunk.applied) {
      return { success: true, message: `Hunk ${hunkId} already applied` };
    }

    // Stale check
    const staleResult = this.checkStale(patchId, hunkId);
    if (staleResult.stale) {
      hunk.status = 'stale';
      hunk.staleReason = staleResult.reason;
      this.updateStatusBar();
      throw new StaleHunkError(hunkId, staleResult.reason || 'Hunk is stale');
    }

    const effectiveTaskId = taskId || hunk.taskId || patch.taskId || this.activeTaskId;
    const applied = await executeApplyPatchHunk(
      { patch_id: patchId, hunk_id: hunkId, task_id: effectiveTaskId },
      this.workspaceManager,
      this.patchStore,
      this.undoManager,
      defaultCancelManager
    );

    // Keep the review view in sync with the shared patch-store apply result.
    hunk.status = 'applied';
    hunk.applied = true;
    hunk.approved = true;
    hunk.appliedAt = Date.now();
    this.updateStatusBar();

    return {
      success: true,
      message: applied.message
    };
  }

  /**
   * Reject an individual hunk without modifying disk.
   */
  public rejectHunk(patchId: string, hunkId: string): { success: boolean; message: string } {
    const match = this.getHunk(patchId, hunkId);
    if (!match) {
      throw new Error(`Invalid patch ID '${patchId}' or hunk ID '${hunkId}'`);
    }

    const { patch, hunk } = match;

    if (hunk.status === 'applied') {
      throw new Error(`Cannot reject already applied hunk ${hunkId}`);
    }

    hunk.status = 'rejected';
    hunk.approved = false;
    this.updateStatusBar();

    return {
      success: true,
      message: `Rejected hunk ${hunkId} in ${patch.targetFile}. No files were modified.`
    };
  }

  /**
   * Count distinct files modified by accepted agent edits.
   */
  public getModifiedFilesCount(): number {
    const modifiedFiles = new Set<string>();

    for (const patch of this.patches.values()) {
      for (const hunk of patch.hunks) {
        if (hunk.status === 'applied' || (hunk.status === 'accepted' && hunk.applied)) {
          const normalized = hunk.file.replace(/\\/g, '/');
          modifiedFiles.add(normalized);
        }
      }
    }

    return modifiedFiles.size;
  }

  public updateStatusBar(): void {
    const count = this.getModifiedFilesCount();
    this.statusBar.setAgentModifiedFiles(count);
  }

  public clear(): void {
    this.patches.clear();
    this.updateStatusBar();
  }
}

export const defaultReviewManager = new ReviewManager(
  new WorkspaceManager(),
  defaultUndoManager,
  defaultStatusBar,
  defaultPatchStore
);
