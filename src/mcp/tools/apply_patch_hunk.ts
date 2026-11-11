/**
 * apply_patch_hunk MCP tool
 * The ONLY sanctioned tool for mutating files in the workspace.
 */

import { z } from 'zod';
import { WorkspaceManager } from '../workspace';
import { applyHunkToFile } from '../../review/apply';
import { sanitizeToolOutput } from '../sanitize';
import { Hunk } from '../../shared/types';

export const ApplyPatchHunkInput = z.object({
  hunkId: z.string().describe('Unique identifier of the hunk to apply'),
  file: z.string().describe('Relative path to target file'),
  oldStart: z.number().int().describe('1-based line number where old chunk starts'),
  oldLines: z.number().int().describe('Number of lines in old chunk'),
  newStart: z.number().int().describe('1-based line number where new chunk starts'),
  newLines: z.number().int().describe('Number of lines in new chunk'),
  content: z.string().describe('Diff hunk content (lines prefixed with " ", "-", or "+")')
});

export type ApplyPatchHunkInput = z.infer<typeof ApplyPatchHunkInput>;

export function makeApplyPatchHunkTool(workspace: WorkspaceManager) {
  return {
    name: 'apply_patch_hunk',
    description: 'Apply a single diff hunk to a file. Requires human approval before disk write occurs.',
    inputSchema: ApplyPatchHunkInput,
    async execute(input: ApplyPatchHunkInput): Promise<string> {
      try {
        const absPath = workspace.resolveSafePath(input.file);
        const hunk: Hunk = {
          id: input.hunkId,
          file: input.file,
          oldStart: input.oldStart,
          oldLines: input.oldLines,
          newStart: input.newStart,
          newLines: input.newLines,
          content: input.content
        };
        applyHunkToFile(absPath, hunk);
        return sanitizeToolOutput(`Hunk ${input.hunkId} applied successfully to ${input.file}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return sanitizeToolOutput(`Error applying hunk: ${msg}`);
      }
    }
  };
}
