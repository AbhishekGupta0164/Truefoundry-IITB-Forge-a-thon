/**
 * find_related MCP tool
 */

import * as path from 'path';
import { z } from 'zod';
import { WorkspaceManager } from '../workspace';
import { sanitizeToolOutput } from '../sanitize';

export const FindRelatedInput = z.object({
  file: z.string().describe('File path to find related files for')
});

export type FindRelatedInput = z.infer<typeof FindRelatedInput>;

export function makeFindRelatedTool(_workspace: WorkspaceManager) {
  return {
    name: 'find_related',
    description: 'Find related files (such as test files corresponding to an implementation file).',
    inputSchema: FindRelatedInput,
    async execute(input: FindRelatedInput): Promise<string> {
      const base = path.basename(input.file, path.extname(input.file));
      const candidates = [
        `tests/test_${base}.py`,
        `test/test_${base}.py`,
        `test/unit/${base}.test.ts`,
        `tests/${base}_test.py`
      ];

      return sanitizeToolOutput(`Potential related test/source files for ${input.file}:\n${candidates.join('\n')}`);
    }
  };
}
