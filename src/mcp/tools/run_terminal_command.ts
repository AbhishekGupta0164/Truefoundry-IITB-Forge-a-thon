/**
 * run_terminal_command MCP tool
 * Strictly enforces security allowlist of commands.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { WorkspaceManager } from '../workspace';
import { isCommandAllowed } from '../../shared/validation';
import { sanitizeToolOutput } from '../sanitize';

const execAsync = promisify(exec);

export const RunTerminalCommandInput = z.object({
  command: z.string().describe('Terminal command to execute (must be in security allowlist)')
});

export type RunTerminalCommandInput = z.infer<typeof RunTerminalCommandInput>;

export function makeRunTerminalCommandTool(workspace: WorkspaceManager) {
  return {
    name: 'run_terminal_command',
    description: 'Run an allowed terminal command (e.g. pytest, git status, git diff) in the workspace.',
    inputSchema: RunTerminalCommandInput,
    async execute(input: RunTerminalCommandInput): Promise<string> {
      if (!isCommandAllowed(input.command)) {
        return sanitizeToolOutput(`Security Violation: Command '${input.command}' is not in the allowed list.`);
      }

      try {
        const { stdout, stderr } = await execAsync(input.command, {
          cwd: workspace.getRoot(),
          timeout: 30000
        });
        const out = stdout || stderr || '(No output)';
        return sanitizeToolOutput(out);
      } catch (err: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const error = err as any;
        return sanitizeToolOutput(`Command failed with exit code ${error.code ?? 1}:\n${error.stdout || ''}\n${error.stderr || error.message}`);
      }
    }
  };
}
