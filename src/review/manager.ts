/**
 * ReviewManager
 *
 * Implements Stage 3 per-hunk review engine, tracking proposed patches,
 * review statuses (pending, accepted, rejected, stale, applied, failed),
 * per-hunk Accept/Reject actions, stale hunk detection, and status-bar coordination.
 */

import * as fs from 'fs';
import { locateHunk } from './apply';
import type * as vscodeTypes from 'vscode';
import { ReviewPatch, ReviewHunk } from '../shared/types';
import { StaleHunkError } from '../shared/errors';
import { WorkspaceManager } from '../mcp/workspace';
import { defaultUndoManager, UndoManager } from './undo';
import { defaultStatusBar, ForgeStatusBar } from '../ui/status-bar';

let vscodeModule: typeof vscodeTypes | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  vscodeModule = require('vscode');
} catch {
  // Running outside VS Code
}

export class ReviewManager {
  private patches = new Map<string, ReviewPatch>();
  private activeTaskId = 'default-task';

  constructor(
    private readonly workspaceManager: WorkspaceManager = new WorkspaceManager(),
    private readonly undoManager: UndoManager = defaultUndoManager,
    private readonly statusBar: ForgeStatusBar = defaultStatusBar
  ) {}

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
    this.updateStatusBar();
  }

  public getPatch(patchId: string): ReviewPatch | undefined {
    return this.patches.get(patchId);
  }

  public getAllPatches(): ReviewPatch[] {
    return Array.from(this.patches.values());
  }

  public getHunk(patchId: string, hunkId: string): { patch: ReviewPatch; hunk: ReviewHunk } | undefined {
    const patch = this.patches.get(patchId);
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
    if (hunk.status === 'applied') {
      return { success: true, message: `Hunk ${hunkId} already applied` };
    }

    const absPath = this.workspaceManager.resolveSafePath(hunk.file);

    // Stale check
    const staleResult = this.checkStale(patchId, hunkId);
    if (staleResult.stale) {
      hunk.status = 'stale';
      hunk.staleReason = staleResult.reason;
      this.updateStatusBar();
      throw new StaleHunkError(hunkId, staleResult.reason || 'Hunk is stale');
    }

    const currentContent = fs.readFileSync(absPath, 'utf-8');
    const fileLines = currentContent.split(/\r?\n/);
    const hunkDiffLines = hunk.content.split('\n');

    const expectedOldLines: string[] = [];
    const replacementLines: string[] = [];

    for (const line of hunkDiffLines) {
      if (line.startsWith('-')) {
        expectedOldLines.push(line.slice(1));
      } else if (line.startsWith('+')) {
        replacementLines.push(line.slice(1));
      } else if (line.startsWith(' ')) {
        expectedOldLines.push(line.slice(1));
        replacementLines.push(line.slice(1));
      }
    }

    // Earlier hunks of the same patch may have moved this one (checkStale already confirmed it is there).
    const located = locateHunk(fileLines, expectedOldLines, Math.max(0, hunk.oldStart - 1));
    const startIdx = located === -1 ? Math.max(0, hunk.oldStart - 1) : located;
    const count = hunk.oldLines > 0 ? hunk.oldLines : expectedOldLines.length;

    const updatedLines = [
      ...fileLines.slice(0, startIdx),
      ...replacementLines,
      ...fileLines.slice(startIdx + count)
    ];
    const eol = currentContent.includes('\r\n') ? '\r\n' : '\n';
    const newContent = updatedLines.join(eol);

    // 1. Apply via VS Code WorkspaceEdit if inside extension host
    try {
      if (vscodeModule?.workspace && typeof vscodeModule.workspace.applyEdit === 'function') {
        const fileUri = vscodeModule.Uri.file(absPath);
        const edit = new vscodeModule.WorkspaceEdit();
        const doc = await vscodeModule.workspace.openTextDocument(fileUri);
        const fullRange = new vscodeModule.Range(
          new vscodeModule.Position(0, 0),
          new vscodeModule.Position(doc.lineCount || fileLines.length, 0)
        );
        edit.replace(fileUri, fullRange, newContent);
        await vscodeModule.workspace.applyEdit(edit);
        if (doc && typeof (doc as any).save === 'function') {
          await (doc as any).save();
        }
      }
    } catch {
      // Ignore if editor not open
    }

    // 2. Persistent write
    fs.writeFileSync(absPath, newContent, 'utf-8');

    // 3. Record inverse edit for whole task undo
    const effectiveTaskId = taskId || hunk.taskId || patch.taskId || this.activeTaskId;
    this.undoManager.recordInverseEdit({
      taskId: effectiveTaskId,
      patchId,
      hunkId,
      file: absPath,
      oldStart: startIdx + 1,
      oldLines: count,
      newStart: startIdx + 1,
      newLines: replacementLines.length,
      originalLines: expectedOldLines,
      replacementLines,
      timestamp: Date.now()
    });

    // 4. Update status
    hunk.status = 'applied';
    hunk.applied = true;
    hunk.approved = true;
    hunk.appliedAt = Date.now();
    this.updateStatusBar();

    return {
      success: true,
      message: `Successfully accepted and applied hunk ${hunkId} to ${patch.targetFile}`
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

export const defaultReviewManager = new ReviewManager();
