import { z } from 'zod';

export interface MCPToolDefinition {
  name: string;
  description: string;
  requireApproval?: boolean;
  parameters: z.ZodObject<any>;
}

export const MCP_TOOLS: Record<string, MCPToolDefinition> = {
  search_text: {
    name: 'search_text',
    description: 'Search workspace files for matching text (max 30 hits). Requires a reason.',
    requireApproval: false,
    parameters: z.object({
      query: z.string().describe('The text string to search for across files'),
      reason: z.string().describe('Short reason for performing this search'),
      max_results: z.number().optional().describe('Maximum number of results to return (<= 30)')
    })
  },
  search_symbols: {
    name: 'search_symbols',
    description: 'Search symbols extracted from the workspace Python files.',
    requireApproval: false,
    parameters: z.object({
      query: z.string().describe('Symbol name or substring to search for'),
      reason: z.string().optional().describe('Short reason for searching symbols')
    })
  },
  read_file: {
    name: 'read_file',
    description: 'Read contents of a workspace file within line budget (max 200 lines). Requires a reason.',
    requireApproval: false,
    parameters: z.object({
      file_path: z.string().describe('Workspace-relative path of the file to read'),
      start_line: z.number().optional().describe('Starting line number (1-based)'),
      end_line: z.number().optional().describe('Ending line number (1-based)'),
      reason: z.string().describe('Short reason for reading this file')
    })
  },
  find_related: {
    name: 'find_related',
    description: 'Discover corresponding test and documentation files for a given file.',
    requireApproval: false,
    parameters: z.object({
      file_path: z.string().describe('Workspace-relative path to find related files for')
    })
  },
  propose_edit: {
    name: 'propose_edit',
    description: 'Propose an in-memory modification replacing old_str with new_str without writing to disk.',
    requireApproval: false,
    parameters: z.object({
      file_path: z.string().describe('Workspace-relative path to edit'),
      old_str: z.string().describe('Original string to replace'),
      new_str: z.string().describe('New replacement string'),
      summary: z.string().optional().describe('Brief description of the edit')
    })
  },
  propose_patch: {
    name: 'propose_patch',
    description: 'Propose a unified diff patch staged in memory without writing to disk.',
    requireApproval: false,
    parameters: z.object({
      patch_content: z.string().describe('Unified diff format patch content'),
      summary: z.string().optional().describe('Summary of the changes proposed')
    })
  },
  apply_patch_hunk: {
    name: 'apply_patch_hunk',
    description: 'Apply a single staged diff hunk to disk after user approval.',
    requireApproval: true,
    parameters: z.object({
      hunk_id: z.string().describe('The ID of the staged hunk to apply')
    })
  },
  run_terminal_command: {
    name: 'run_terminal_command',
    description: 'Execute an allowlisted terminal command (e.g. pytest, git status). Requires approval.',
    requireApproval: true,
    parameters: z.object({
      command: z.string().describe('Exact allowlisted command to run')
    })
  }
};
