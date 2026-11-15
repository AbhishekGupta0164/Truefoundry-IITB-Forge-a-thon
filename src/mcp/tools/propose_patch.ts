import * as diff from 'diff';
import { Hunk, Patch } from '../../shared/types';
import { WorkspaceManager } from '../workspace';
import { PatchStore, globalPatchStore } from '../../review/store';
import { validateHunk } from '../../shared/validation';

export interface ProposePatchInput {
  patch_content: string;
  summary?: string;
}

export function executeProposePatch(
  input: ProposePatchInput,
  workspace: WorkspaceManager,
  store: PatchStore = globalPatchStore
): { success: boolean; patchId?: string; hunks?: Hunk[]; error?: string } {
  try {
    const parsedPatches = diff.parsePatch(input.patch_content);
    if (!parsedPatches || parsedPatches.length === 0) {
      return { success: false, error: 'Could not parse patch content as unified diff' };
    }

    const allHunks: Hunk[] = [];
    let targetFile = '';

    for (const parsed of parsedPatches) {
      const fileName = (parsed.newFileName || parsed.oldFileName || '').replace(/^[ab]\//, '');
      if (!fileName) continue;
      targetFile = fileName;

      // Check path safety
      workspace.resolveSafePath(fileName);

      if (parsed.hunks) {
        for (let i = 0; i < parsed.hunks.length; i++) {
          const h = parsed.hunks[i];
          const hunk: Hunk = {
            id: `hunk-${Date.now()}-${allHunks.length + 1}`,
            file: fileName,
            oldStart: h.oldStart,
            oldLines: h.oldLines,
            newStart: h.newStart,
            newLines: h.newLines,
            content: h.lines.join('\n')
          };
          if (!validateHunk(hunk)) {
            return { success: false, error: `Hunk in ${fileName} failed validation` };
          }
          allHunks.push(hunk);
        }
      }
    }

    if (allHunks.length === 0) {
      return { success: false, error: 'No valid hunks found in patch' };
    }

    const patch: Patch = {
      id: `patch-${Date.now()}`,
      targetFile,
      hunks: allHunks,
      summary: input.summary || `Patch for ${targetFile}`,
      createdAt: Date.now()
    };

    store.stagePatch(patch);
    return { success: true, patchId: patch.id, hunks: allHunks };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
