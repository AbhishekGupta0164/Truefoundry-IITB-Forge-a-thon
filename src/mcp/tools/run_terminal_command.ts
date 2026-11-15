import { spawn } from 'child_process';
import { isCommandAllowed } from '../../shared/validation';
import { WorkspaceManager } from '../workspace';
import { sanitizeToolOutput } from '../sanitize';

export interface RunTerminalCommandInput {
  command: string;
}

export async function executeRunTerminalCommand(
  input: RunTerminalCommandInput,
  workspace: WorkspaceManager
): Promise<{ success: boolean; output?: string; error?: string }> {
  if (!input.command || !isCommandAllowed(input.command)) {
    return {
      success: false,
      error: `Security violation: Command '${input.command}' is not on the allowlist.`
    };
  }

  const root = workspace.getRoot();
  const parts = input.command.trim().split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1);

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

    const proc = spawn(cmd, args, {
      cwd: root,
      shell: false
    });

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      const output = stdout + '\n' + stderr;
      const sanitized = sanitizeToolOutput(output);
      if (code === 0) {
        resolve({ success: true, output: sanitized });
      } else {
        resolve({ success: false, output: sanitized, error: `Command exited with code ${code}` });
      }
    });

    proc.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}
