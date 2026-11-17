import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WorkspaceManager } from './workspace';
import { ContextBudgetTracker } from '../context/budget';
import { PatchStore, defaultPatchStore } from '../review/store';
import { sanitizeToolOutput } from './sanitize';

import { executeSearchText } from './tools/search_text';
import { executeSearchSymbols } from './tools/search_symbols';
import { executeReadFile } from './tools/read_file';
import { executeFindRelated } from './tools/find_related';
import { executeProposePatch } from './tools/propose_patch';
import { executeProposeEdit } from './tools/propose_edit';
import { executeApplyPatchHunk } from './tools/apply_patch_hunk';
import { executeRunTerminalCommand } from './tools/run_terminal_command';

/**
 * Registers all workspace and agent tools onto the MCP server instance.
 */
export function registerAllTools(
  server: McpServer,
  workspaceManager: WorkspaceManager,
  budgetTracker: ContextBudgetTracker,
  patchStore: PatchStore = defaultPatchStore
): void {
  // 1. search_text
  server.tool(
    'search_text',
    'Search workspace text files for occurrences of a string query within context limits.',
    {
      query: z.string().describe('The search query string'),
      glob: z.string().optional().describe('Optional glob pattern filter (e.g. *.ts or src/**/*.py)'),
      reason: z.string().describe('Reason for performing this search')
    },
    { readOnlyHint: true },
    async (args) => {
      try {
        const result = await executeSearchText(args, workspaceManager, budgetTracker);
        return {
          content: [{ type: 'text', text: result.rawText }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: sanitizeToolOutput(`Error in search_text: ${err.message}`) }],
          isError: true
        };
      }
    }
  );

  // 2. search_symbols
  server.tool(
    'search_symbols',
    'Find functions, classes, methods, and their signatures and docstrings across workspace files.',
    {
      query: z.string().describe('Name or fragment of the symbol to find'),
      reason: z.string().describe('Reason for searching symbols')
    },
    { readOnlyHint: true },
    async (args) => {
      try {
        const result = await executeSearchSymbols(args, workspaceManager);
        return {
          content: [{ type: 'text', text: result.rawText }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: sanitizeToolOutput(`Error in search_symbols: ${err.message}`) }],
          isError: true
        };
      }
    }
  );

  // 3. read_file
  server.tool(
    'read_file',
    'Read lines from a workspace file within the line and retrieved context budget.',
    {
      path: z.string().describe('Workspace-relative path of the file to read'),
      start: z.number().int().positive().optional().describe('1-based starting line number'),
      end: z.number().int().positive().optional().describe('1-based ending line number (max 200 lines total)'),
      reason: z.string().describe('Reason for reading this file')
    },
    { readOnlyHint: true },
    async (args) => {
      try {
        const result = await executeReadFile(args, workspaceManager, budgetTracker);
        return {
          content: [{ type: 'text', text: result.rawText }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: sanitizeToolOutput(`Error in read_file: ${err.message}`) }],
          isError: true
        };
      }
    }
  );

  // 4. find_related
  server.tool(
    'find_related',
    'Suggest likely related test files and documentation for a workspace file.',
    {
      path: z.string().describe('Workspace-relative path to find related files for'),
      reason: z.string().describe('Reason for finding related files')
    },
    { readOnlyHint: true },
    async (args) => {
      try {
        const result = await executeFindRelated(args, workspaceManager);
        return {
          content: [{ type: 'text', text: result.rawText }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: sanitizeToolOutput(`Error in find_related: ${err.message}`) }],
          isError: true
        };
      }
    }
  );

  // 5. propose_patch
  server.tool(
    'propose_patch',
    'Prepare and stage a proposed multi-hunk patch in memory without modifying workspace files on disk.',
    {
      target_file: z.string().describe('Workspace-relative path of the target file'),
      patch: z.string().describe('Unified diff format patch content'),
      summary: z.string().describe('Summary of the intended changes')
    },
    { readOnlyHint: false, destructiveHint: false },
    async (args) => {
      try {
        const result = await executeProposePatch(args, workspaceManager, patchStore);
        return {
          content: [{ type: 'text', text: result.rawText }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: sanitizeToolOutput(`Error in propose_patch: ${err.message}`) }],
          isError: true
        };
      }
    }
  );

  // 6. propose_edit
  server.tool(
    'propose_edit',
    'Prepare an unambiguous search-and-replace edit, compute diff server-side, and stage in memory without touching disk.',
    {
      path: z.string().describe('Workspace-relative path of target file'),
      old_str: z.string().describe('Exact unique string in the file to be replaced'),
      new_str: z.string().describe('Replacement string'),
      summary: z.string().optional().describe('Summary of the proposed edit')
    },
    { readOnlyHint: false, destructiveHint: false },
    async (args) => {
      try {
        const result = await executeProposeEdit(args, workspaceManager, patchStore);
        return {
          content: [{ type: 'text', text: result.rawText }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: sanitizeToolOutput(`Error in propose_edit: ${err.message}`) }],
          isError: true
        };
      }
    }
  );

  // 7. apply_patch_hunk (ONLY tool allowed to modify files)
  server.tool(
    'apply_patch_hunk',
    'Apply an approved staged patch hunk to the workspace via VS Code WorkspaceEdit. This is the only tool permitted to modify files.',
    {
      patch_id: z.string().optional().describe('The staged patch ID'),
      patchId: z.string().optional().describe('Alias for patch_id'),
      hunk_id: z.string().optional().describe('The specific hunk ID within the patch to apply'),
      hunkId: z.string().optional().describe('Alias for hunk_id'),
      file: z.string().optional().describe('Target relative file path'),
      oldStart: z.number().optional().describe('1-based line number where old chunk starts'),
      oldLines: z.number().optional().describe('Line count in old chunk'),
      newStart: z.number().optional().describe('1-based line number where new chunk starts'),
      newLines: z.number().optional().describe('Line count in new chunk'),
      content: z.string().optional().describe('Diff hunk content')
    },
    { readOnlyHint: false, destructiveHint: true },
    async (args) => {
      try {
        const result = await executeApplyPatchHunk(args, workspaceManager, patchStore);
        return {
          content: [{ type: 'text', text: result.rawText }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: sanitizeToolOutput(`Error in apply_patch_hunk: ${err.message}`) }],
          isError: true
        };
      }
    }
  );

  // 8. run_terminal_command
  server.tool(
    'run_terminal_command',
    'Run an approved command from the strict security allowlist with an argument array (argv). Shell strings are forbidden.',
    {
      argv: z.array(z.string()).describe('Argument array, e.g. ["git", "status"] or ["pytest", "tests/test_cli.py", "-q"]'),
      timeoutMs: z.number().int().positive().optional().describe('Optional execution timeout in milliseconds')
    },
    { readOnlyHint: false, destructiveHint: false },
    async (args) => {
      try {
        const result = await executeRunTerminalCommand(args, workspaceManager);
        return {
          content: [{ type: 'text', text: result.rawText }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: sanitizeToolOutput(`Error in run_terminal_command: ${err.message}`) }],
          isError: true
        };
      }
    }
  );

  // 9. ping (for smoke testing and inspector connection verification)
  server.tool(
    'ping',
    'Health check tool that responds with pong.',
    {},
    { readOnlyHint: true },
    async () => {
      return {
        content: [{ type: 'text', text: sanitizeToolOutput('pong') }]
      };
    }
  );
}
