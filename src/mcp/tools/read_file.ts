/**
 * read_file MCP tool
 * Reads up to MAX_LINES_PER_READ lines from a workspace file.
 */

import * as fs from 'fs';
import { z } from 'zod';
import { RETRIEVED_CONTEXT_BUDGET } from '../../shared/constants';
import { ContextBudgetTracker } from '../../context/budget';
import { WorkspaceManager } from '../workspace';
import { sanitizeToolOutput } from '../sanitize';

export const ReadFileInput = z.object({
  path: z.string().describe('Relative path to the file from the workspace root'),
  startLine: z.number().int().min(1).optional().describe('1-based start line (default: 1)'),
  endLine: z.number().int().min(1).optional().describe('1-based end line (inclusive)')
});

export type ReadFileInput = z.infer<typeof ReadFileInput>;

export function makeReadFileTool(workspace: WorkspaceManager, budget: ContextBudgetTracker) {
  return {
    name: 'read_file',
    description: 'Read a file from the workspace. Limited to 200 lines per call. Respects context budget.',
    inputSchema: ReadFileInput,
    async execute(input: ReadFileInput): Promise<string> {
      const absPath = workspace.resolveSafePath(input.path);

      if (!fs.existsSync(absPath)) {
        return sanitizeToolOutput(`Error: File not found: ${input.path}`);
      }

      const rawContent = fs.readFileSync(absPath, 'utf-8');
      const allLines = rawContent.split('\n');

      const start = Math.max(1, input.startLine ?? 1);
      const maxEnd = start + RETRIEVED_CONTEXT_BUDGET.MAX_LINES_PER_READ - 1;
      const end = Math.min(input.endLine ?? maxEnd, maxEnd, allLines.length);

      const sliced = allLines.slice(start - 1, end);
      budget.recordFileRead(input.path, sliced.length);

      const header = `// ${input.path} [lines ${start}-${end} of ${allLines.length}]\n`;
      return sanitizeToolOutput(header + sliced.join('\n'));
    }
  };
}
