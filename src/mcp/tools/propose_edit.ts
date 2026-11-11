/**
 * propose_edit MCP tool
 */

import { z } from 'zod';
import { sanitizeToolOutput } from '../sanitize';

export const ProposeEditInput = z.object({
  file: z.string().describe('File path to edit'),
  instructions: z.string().describe('Explanation of proposed change')
});

export type ProposeEditInput = z.infer<typeof ProposeEditInput>;

export function makeProposeEditTool() {
  return {
    name: 'propose_edit',
    description: 'Propose high-level edits for a file before generating precise diff hunks.',
    inputSchema: ProposeEditInput,
    async execute(input: ProposeEditInput): Promise<string> {
      return sanitizeToolOutput(`Edit proposed for ${input.file}: ${input.instructions}`);
    }
  };
}
