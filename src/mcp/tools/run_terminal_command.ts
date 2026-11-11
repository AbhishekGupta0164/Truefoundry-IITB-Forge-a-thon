import * as child_process from 'child_process';
import { WorkspaceManager } from '../workspace';
import { validateArgv } from '../../shared/validation';
import { sanitizeToolOutput } from '../sanitize';

export interface RunTerminalCommandParams {
  argv: string[];
  timeoutMs?: number;
}

export interface RunTerminalCommandResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  rawText: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_STDOUT_LENGTH = 20_000;

export async function executeRunTerminalCommand(
  params: RunTerminalCommandParams,
  workspaceManager: WorkspaceManager
): Promise<RunTerminalCommandResult> {
  const { argv, timeoutMs = DEFAULT_TIMEOUT_MS } = params;

  // 1. Validate argv
  const validation = validateArgv(argv);
  if (!validation.allowed) {
    throw new Error(`Command rejected by security policy: ${validation.reason}`);
  }

  const [executable, ...args] = argv;
  const cwd = workspaceManager.getRoot();

  // If a local virtualenv exists in cwd, prioritize its bin/Scripts in PATH
  const env: NodeJS.ProcessEnv = { ...process.env, PYTHONUNBUFFERED: '1' };
  const venvDir = require('path').join(cwd, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin');
  if (require('fs').existsSync(venvDir)) {
    env.PATH = `${venvDir}${require('path').delimiter}${process.env.PATH || ''}`;
  }

  return new Promise((resolve) => {
    let stdoutData = '';
    let stderrData = '';
    let timedOut = false;

    // Strict security execution: never shell: true!
    const proc = child_process.spawn(executable, args, {
      cwd,
      shell: false,
      timeout: timeoutMs,
      env
    });

    proc.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString();
      if (stdoutData.length > MAX_STDOUT_LENGTH) {
        stdoutData = stdoutData.slice(0, MAX_STDOUT_LENGTH);
      }
    });

    proc.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
      if (stderrData.length > MAX_STDOUT_LENGTH) {
        stderrData = stderrData.slice(0, MAX_STDOUT_LENGTH);
      }
    });

    proc.on('error', (err: any) => {
      const isTimeout = err.code === 'ETIMEDOUT';
      resolve({
        command: argv.join(' '),
        exitCode: err.code === 'ENOENT' ? 127 : 1,
        stdout: stdoutData,
        stderr: `${stderrData}\nProcess error: ${err.message}`,
        timedOut: isTimeout,
        rawText: sanitizeToolOutput(`Command failed: ${err.message}`)
      });
    });

    proc.on('close', (code, signal) => {
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        timedOut = true;
      }
      const combined = `Exit Code: ${code}\nSTDOUT:\n${stdoutData}\nSTDERR:\n${stderrData}`;
      resolve({
        command: argv.join(' '),
        exitCode: code,
        stdout: stdoutData,
        stderr: stderrData,
        timedOut,
        rawText: sanitizeToolOutput(combined)
      });
    });
  });
}
