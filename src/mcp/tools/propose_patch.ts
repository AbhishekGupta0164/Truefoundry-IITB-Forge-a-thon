import * as crypto from 'crypto';
import * as diff from 'diff';
import { WorkspaceManager } from '../workspace';
import { PatchStore, defaultPatchStore, StagedHunk, StagedPatch } from '../../review/store';
import { validateHunk } from '../../shared/validation';
import { sanitizeToolOutput } from '../sanitize';

export interface ProposePatchParams {
  target_file: string;
  patch: string;
  summary: string;
}

export interface ProposePatchResult {
  patch_id: string;
  target_file: string;
  hunk_ids: string[];
  hunks_count: number;
  summary: string;
  rawText: string;
}

export async function executeProposePatch(
  params: ProposePatchParams,
  workspaceManager: WorkspaceManager,
  patchStore: PatchStore = defaultPatchStore
): Promise<ProposePatchResult> {
  const { target_file, patch: patchText, summary } = params;

  if (!target_file || typeof target_file !== 'string') {
    throw new Error('target_file must be a non-empty string');
  }
  if (!patchText || typeof patchText !== 'string') {
    throw new Error('patch content must be a non-empty string');
  }

  // Security check: validate target path
  workspaceManager.resolveSafePath(target_file);

  const parsed = diff.parsePatch(patchText);
  const stagedHunks: StagedHunk[] = [];

  if (parsed && parsed.length > 0) {
    for (const fileDiff of parsed) {
      for (const h of fileDiff.hunks) {
        const hunkId = `hunk-${crypto.randomUUID()}`;
        const hunkContent = h.lines.join('\n');
        const hunk: StagedHunk = {
          id: hunkId,
          file: target_file,
          oldStart: h.oldStart,
          oldLines: h.oldLines,
          newStart: h.newStart,
          newLines: h.newLines,
          content: hunkContent
        };
        if (!validateHunk(hunk)) {
          throw new Error(`Parsed hunk ${hunkId} failed security or structural validation`);
        }
        stagedHunks.push(hunk);
      }
    }
  } else {
    // If unified diff headers were omitted, wrap in a single hunk
    const hunkId = `hunk-${crypto.randomUUID()}`;
    const hunk: StagedHunk = {
      id: hunkId,
      file: target_file,
      oldStart: 1,
      oldLines: 0,
      newStart: 1,
      newLines: 0,
      content: patchText
    };
    if (!validateHunk(hunk)) {
      throw new Error(`Proposed patch failed security or structural validation`);
    }
    stagedHunks.push(hunk);
  }

  const patchId = `patch-${crypto.randomUUID()}`;
  const stagedPatch: StagedPatch = {
    id: patchId,
    targetFile: target_file,
    hunks: stagedHunks,
    summary: summary || 'Proposed patch',
    createdAt: Date.now()
  };

  // Stage patch in memory only - NEVER write to disk!
  patchStore.stagePatch(stagedPatch);

  const hunkIds = stagedHunks.map(h => h.id);
  const resultSummary = `Staged patch ${patchId} for ${target_file} (${stagedHunks.length} hunks). Changes held in-memory for review.`;

  return {
    patch_id: patchId,
    target_file,
    hunk_ids: hunkIds,
    hunks_count: stagedHunks.length,
    summary: stagedPatch.summary,
    rawText: sanitizeToolOutput(resultSummary)
  };
}
