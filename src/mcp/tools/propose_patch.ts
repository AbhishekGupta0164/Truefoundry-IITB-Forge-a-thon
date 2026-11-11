/**
 * propose_patch MCP tool
 */

import { z } from 'zod';
import { sanitizeToolOutput } from '../sanitize';

export const ProposePatchInput = z.object({
  targetFile: z.string().describe('File to patch'),
  summary: z.string().describe('Summary of the patch'),
  hunks: z.array(z.object({
    id: z.string(),
    file: z.string(),
    oldStart: z.number().int(),
    oldLines: z.number().int(),
    newStart: z.number().int(),
    newLines: z.number().int(),
    content: z.string()
  })).describe('Array of diff hunks')
});

export type ProposePatchInput = z.infer<typeof ProposePatchInput>;

export function makeProposePatchTool() {
  return {
    name: 'propose_patch',
    description: 'Propose a structured patch consisting of one or more hunks.',
    inputSchema: ProposePatchInput,
    async execute(input: ProposePatchInput): Promise<string> {
      return sanitizeToolOutput(`Patch proposed for ${input.targetFile} with ${input.hunks.length} hunk(s): ${input.summary}`);
    }
  };
}
