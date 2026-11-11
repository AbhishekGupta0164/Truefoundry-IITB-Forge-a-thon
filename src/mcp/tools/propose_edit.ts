import * as crypto from 'crypto';
import * as fs from 'fs';
import * as diff from 'diff';
import { WorkspaceManager } from '../workspace';
import { PatchStore, defaultPatchStore, StagedHunk, StagedPatch } from '../../review/store';
import { sanitizeToolOutput } from '../sanitize';

export interface ProposeEditParams {
  path: string;
  old_str: string;
  new_str: string;
  summary?: string;
}

export interface ProposeEditResult {
  patch_id: string;
  hunk_ids: string[];
  hunks_count: number;
  target_file: string;
  summary: string;
  diff: string;
  rawText: string;
}

export async function executeProposeEdit(
  params: ProposeEditParams,
  workspaceManager: WorkspaceManager,
  patchStore: PatchStore = defaultPatchStore
): Promise<ProposeEditResult> {
  const { path: relativePath, old_str, new_str, summary } = params;

  if (!relativePath || typeof relativePath !== 'string') {
    throw new Error('path must be a non-empty string');
  }
  if (typeof old_str !== 'string') {
    throw new Error('old_str must be a string');
  }
  if (typeof new_str !== 'string') {
    throw new Error('new_str must be a string');
  }

  // 1. Resolve safe path
  const absPath = workspaceManager.resolveSafePath(relativePath);

  if (!fs.existsSync(absPath)) {
    throw new Error(`File does not exist: ${relativePath}`);
  }

  // 2. Read existing file securely
  const currentContent = fs.readFileSync(absPath, 'utf-8');

  // 3. Ensure old_str is present and unambiguous
  if (!currentContent.includes(old_str)) {
    throw new Error(`old_str not found in ${relativePath}`);
  }

  const occurrences = currentContent.split(old_str).length - 1;
  if (occurrences > 1) {
    throw new Error(`old_str is ambiguous: found ${occurrences} occurrences in ${relativePath}`);
  }

  // 4. Calculate diff server-side
  const updatedContent = currentContent.replace(old_str, new_str);
  const patchString = diff.createPatch(relativePath, currentContent, updatedContent);
  const parsed = diff.parsePatch(patchString);

  const stagedHunks: StagedHunk[] = [];
  if (parsed && parsed.length > 0) {
    for (const fileDiff of parsed) {
      for (const h of fileDiff.hunks) {
        const hunkId = `hunk-${crypto.randomUUID()}`;
        stagedHunks.push({
          id: hunkId,
          file: relativePath,
          oldStart: h.oldStart,
          oldLines: h.oldLines,
          newStart: h.newStart,
          newLines: h.newLines,
          content: h.lines.join('\n')
        });
      }
    }
  }

  const patchId = `patch-${crypto.randomUUID()}`;
  const stagedPatch: StagedPatch = {
    id: patchId,
    targetFile: relativePath,
    hunks: stagedHunks,
    summary: summary || `Edit in ${relativePath}`,
    createdAt: Date.now(),
    initialContent: currentContent
  };

  // 5. Stage in memory ONLY - never write to disk!
  patchStore.stagePatch(stagedPatch);

  const hunkIds = stagedHunks.map(h => h.id);
  const resultText = `Staged edit patch ${patchId} for ${relativePath} (${stagedHunks.length} hunks). Disk remains unchanged.`;

  return {
    patch_id: patchId,
    hunk_ids: hunkIds,
    hunks_count: stagedHunks.length,
    target_file: relativePath,
    summary: stagedPatch.summary,
    diff: patchString,
    rawText: sanitizeToolOutput(resultText)
  };
}
