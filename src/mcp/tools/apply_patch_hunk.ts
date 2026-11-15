import * as fs from 'fs';
import { WorkspaceManager } from '../workspace';
import { PatchStore, globalPatchStore } from '../../review/store';
import { assertHunkApplicable } from '../../shared/validation';
import { StaleHunkError } from '../../shared/errors';

export interface ApplyPatchHunkInput {
  hunk_id: string;
}

export function executeApplyPatchHunk(
  input: ApplyPatchHunkInput,
  workspace: WorkspaceManager,
  store: PatchStore = globalPatchStore
): { success: boolean; file?: string; error?: string } {
  try {
    const found = store.findHunk(input.hunk_id);
    if (!found) {
      return { success: false, error: `Hunk ${input.hunk_id} not found in staged store` };
    }

    const { hunk } = found;
    const fullPath = workspace.resolveSafePath(hunk.file);
    if (!fs.existsSync(fullPath)) {
      return { success: false, error: `Target file not found: ${hunk.file}` };
    }

    const currentContent = fs.readFileSync(fullPath, 'utf8');

    // Structural and stale check
    assertHunkApplicable(currentContent, hunk);

    // Apply the hunk to file content
    const lines = currentContent.split('\n');
    const hunkLines = hunk.content.split('\n');
    const removed: string[] = [];
    const added: string[] = [];

    for (const hl of hunkLines) {
      if (hl.startsWith('-')) removed.push(hl.slice(1));
      else if (hl.startsWith('+')) added.push(hl.slice(1));
    }

    const startIdx = hunk.oldStart - 1;
    lines.splice(startIdx, hunk.oldLines, ...added);
    const updatedContent = lines.join('\n');

    fs.writeFileSync(fullPath, updatedContent, 'utf8');

    store.recordDecision({
      hunkId: hunk.id,
      decision: 'accept',
      timestamp: Date.now()
    });

    return { success: true, file: hunk.file };
  } catch (err: unknown) {
    if (err instanceof StaleHunkError) {
      return { success: false, error: `StaleHunkError: ${err.message}` };
    }
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
