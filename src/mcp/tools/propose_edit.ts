import * as diff from 'diff';
import { Hunk, Patch } from '../../shared/types';
import { WorkspaceManager } from '../workspace';
import { PatchStore, globalPatchStore } from '../../review/store';
import { validateHunk } from '../../shared/validation';

export interface ProposeEditInput {
  file_path: string;
  old_str: string;
  new_str: string;
  summary?: string;
}

export function executeProposeEdit(
  input: ProposeEditInput,
  workspace: WorkspaceManager,
  store: PatchStore = globalPatchStore
): { success: boolean; patchId?: string; hunks?: Hunk[]; error?: string } {
  try {
    const fullPath = workspace.resolveSafePath(input.file_path);
    const fs = require('fs');
    if (!fs.existsSync(fullPath)) {
      return { success: false, error: `File not found: ${input.file_path}` };
    }

    const currentContent = fs.readFileSync(fullPath, 'utf8');
    if (!currentContent.includes(input.old_str)) {
      return { success: false, error: `old_str was not found in ${input.file_path}` };
    }

    const newContent = currentContent.replace(input.old_str, input.new_str);
    const unifiedDiff = diff.createPatch(input.file_path, currentContent, newContent);
    const parsedDiffs = diff.parsePatch(unifiedDiff);

    if (!parsedDiffs || parsedDiffs.length === 0 || !parsedDiffs[0].hunks) {
      return { success: false, error: 'Failed to generate diff hunks from proposed edit' };
    }

    const hunks: Hunk[] = parsedDiffs[0].hunks.map((h, idx) => ({
      id: `hunk-${Date.now()}-${idx + 1}`,
      file: input.file_path,
      oldStart: h.oldStart,
      oldLines: h.oldLines,
      newStart: h.newStart,
      newLines: h.newLines,
      content: h.lines.join('\n')
    }));

    for (const hunk of hunks) {
      if (!validateHunk(hunk)) {
        return { success: false, error: `Generated hunk ${hunk.id} failed validation` };
      }
    }

    const patch: Patch = {
      id: `patch-${Date.now()}`,
      targetFile: input.file_path,
      hunks,
      summary: input.summary || `Edit to ${input.file_path}`,
      createdAt: Date.now()
    };

    store.stagePatch(patch);
    return { success: true, patchId: patch.id, hunks };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
