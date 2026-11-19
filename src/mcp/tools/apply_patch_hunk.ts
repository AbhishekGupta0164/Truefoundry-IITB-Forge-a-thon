import * as fs from 'fs';
import type * as vscodeTypes from 'vscode';
import { WorkspaceManager } from '../workspace';
import { PatchStore, defaultPatchStore } from '../../review/store';
import { CancelManager, defaultCancelManager } from '../../review/cancel';
import { UndoManager, defaultUndoManager } from '../../review/undo';
import { assertHunkApplicable } from '../../shared/validation';
import { StaleHunkError } from '../../shared/errors';
import { sanitizeToolOutput } from '../sanitize';
import { applyHunkToContent, locateHunk } from '../../review/apply';

let vscodeModule: typeof vscodeTypes | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  vscodeModule = require('vscode');
} catch {
  // Running outside VS Code extension host
}

export interface ApplyPatchHunkParams {
  patch_id?: string;
  patchId?: string;
  hunk_id?: string;
  hunkId?: string;
  file?: string;
  oldStart?: number;
  oldLines?: number;
  newStart?: number;
  newLines?: number;
  content?: string;
}

export interface ApplyPatchHunkResult {
  success: boolean;
  patch_id: string;
  hunk_id: string;
  target_file: string;
  message: string;
  rawText: string;
}

export async function executeApplyPatchHunk(
  params: ApplyPatchHunkParams,
  workspaceManager: WorkspaceManager,
  patchStore: PatchStore = defaultPatchStore,
  undoManager: UndoManager = defaultUndoManager,
  cancelManager: CancelManager = defaultCancelManager
): Promise<ApplyPatchHunkResult> {
  const patchId = params.patch_id || params.patchId;
  const hunkId = params.hunk_id || params.hunkId;

  // 0. Ensure patch/session is not cancelled (check immediately before any operation)
  cancelManager.assertNotCancelled(patchId);

  // Direct hunk application if file and content are provided directly
  if (!patchId && params.file && params.content && hunkId) {
    const absPath = workspaceManager.resolveSafePath(params.file);
    if (!fs.existsSync(absPath)) {
      throw new Error(`Target file does not exist: ${params.file}`);
    }

    const currentContent = fs.readFileSync(absPath, 'utf-8');
    const updatedContent = applyHunkToContent(currentContent, {
      id: hunkId,
      file: params.file,
      oldStart: params.oldStart ?? 1,
      oldLines: params.oldLines ?? 0,
      newStart: params.newStart ?? 1,
      newLines: params.newLines ?? 0,
      content: params.content
    });

    // Try VS Code WorkspaceEdit first
    try {
      if (vscodeModule?.workspace && typeof vscodeModule.workspace.applyEdit === 'function') {
        const fileUri = vscodeModule.Uri.file(absPath);
        const edit = new vscodeModule.WorkspaceEdit();
        const doc = await vscodeModule.workspace.openTextDocument(fileUri);
        const fullRange = new vscodeModule.Range(
          new vscodeModule.Position(0, 0),
          new vscodeModule.Position(doc.lineCount || 1000, 0)
        );
        edit.replace(fileUri, fullRange, updatedContent);
        await vscodeModule.workspace.applyEdit(edit);
        if (doc && typeof (doc as any).save === 'function') {
          await (doc as any).save();
        }
      }
    } catch {
      // Fallback
    }

    fs.writeFileSync(absPath, updatedContent, 'utf-8');
    const msg = `Hunk ${hunkId} applied successfully to ${params.file}`;
    return {
      success: true,
      patch_id: 'direct',
      hunk_id: hunkId,
      target_file: params.file,
      message: msg,
      rawText: sanitizeToolOutput(msg)
    };
  }

  if (!patchId || typeof patchId !== 'string') {
    throw new Error('patch_id must be a non-empty string');
  }
  if (!hunkId || typeof hunkId !== 'string') {
    throw new Error('hunk_id must be a non-empty string');
  }

  const patch_id = patchId;
  const hunk_id = hunkId;

  // 0. Ensure patch/session is not cancelled
  defaultCancelManager.assertNotCancelled(patchId);

  // 1. Look up patch and hunk
  const match = patchStore.getHunk(patchId, hunkId);
  if (!match) {
    throw new Error(`Invalid patch_id '${patchId}' or hunk_id '${hunkId}'`);
  }

  const { patch, hunk } = match;

  if (hunk.applied) {
    throw new Error(`Hunk ${hunk_id} has already been applied`);
  }

  // 2. Recheck target path before applying
  const absPath = workspaceManager.resolveSafePath(hunk.file);

  if (!fs.existsSync(absPath)) {
    throw new Error(`Target file does not exist: ${hunk.file}`);
  }

  // 3. Read current file content and check staleness
  const currentContent = fs.readFileSync(absPath, 'utf-8');

  // Verify hunk lines exist and match
  assertHunkApplicable(currentContent, hunk);

  const fileLines = currentContent.split(/\r?\n/);
  const hunkDiffLines = hunk.content.split('\n');

  // Verify that the lines being removed or kept match the file lines
  const oldLinesFromHunk = hunkDiffLines.filter(l => l.startsWith(' ') || l.startsWith('-')).map(l => l.slice(1));
  const newLinesFromHunk = hunkDiffLines.filter(l => l.startsWith(' ') || l.startsWith('+')).map(l => l.slice(1));

  // Earlier hunks of the same patch may have moved this one; find its lines in the current file.
  const startIdx = locateHunk(fileLines, oldLinesFromHunk, hunk.oldStart - 1);
  if (startIdx === -1) {
    const expectedIdx = hunk.oldStart - 1;
    const firstDiff = oldLinesFromHunk.findIndex((line, i) => (fileLines[expectedIdx + i] ?? '').trim() !== line.trim());
    const at = expectedIdx + Math.max(0, firstDiff);
    throw new StaleHunkError(
      hunk.id,
      `Stale hunk detected: line ${at + 1} content "${fileLines[at] ?? ''}" does not match expected "${oldLinesFromHunk[Math.max(0, firstDiff)] ?? ''}"`
    );
  }

  // Compute updated file content
  const updatedLines = [
    ...fileLines.slice(0, startIdx),
    ...newLinesFromHunk,
    ...fileLines.slice(startIdx + (hunk.oldLines > 0 ? hunk.oldLines : oldLinesFromHunk.length))
  ];
  const eol = currentContent.includes('\r\n') ? '\r\n' : '\n';
  const newFullContent = updatedLines.join(eol);

  // 4. Apply changes via VS Code WorkspaceEdit
  try {
    if (vscodeModule?.workspace && typeof vscodeModule.workspace.applyEdit === 'function') {
      const fileUri = vscodeModule.Uri.file(absPath);
      const edit = new vscodeModule.WorkspaceEdit();
      const doc = await vscodeModule.workspace.openTextDocument(fileUri);
      const fullRange = new vscodeModule.Range(
        new vscodeModule.Position(0, 0),
        new vscodeModule.Position(doc.lineCount || fileLines.length, 0)
      );
      edit.replace(fileUri, fullRange, newFullContent);
      await vscodeModule.workspace.applyEdit(edit);
      if (doc && typeof (doc as any).save === 'function') {
        await (doc as any).save();
      }
    }
  } catch {
    // If not in active VS Code editor window, ignore
  }

  // Ensure persistent write to disk
  fs.writeFileSync(absPath, newFullContent, 'utf-8');

  hunk.applied = true;
  hunk.approved = true;

  // Record inverse edit for whole task undo (T6)
  undoManager.recordInverseEdit({
    taskId: (patch as any).taskId || 'current-task',
    patchId: patch_id,
    hunkId: hunk_id,
    file: absPath,
    oldStart: startIdx + 1,
    oldLines: hunk.oldLines,
    newStart: startIdx + 1,
    newLines: newLinesFromHunk.length,
    originalLines: oldLinesFromHunk,
    replacementLines: newLinesFromHunk,
    timestamp: Date.now()
  });

  const msg = `Successfully applied hunk ${hunk_id} from patch ${patch_id} to ${patch.targetFile}`;

  return {
    success: true,
    patch_id,
    hunk_id,
    target_file: patch.targetFile,
    message: msg,
    rawText: sanitizeToolOutput(msg)
  };
}
