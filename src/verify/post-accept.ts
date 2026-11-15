import { spawn } from 'child_process';
import * as path from 'path';
import { SECURITY_ALLOWLIST } from '../shared/constants';

export interface PytestResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  passedCount?: number;
  failedCount?: number;
  skippedCount?: number;
  duration?: string;
  summary: string;
}

/**
 * Post-Accept Pytest Verification:
 * Runs the allowlisted pytest command `pytest tests/test_cli.py -q`
 * after patches are accepted, capturing summary results for display in the panel.
 */
export async function runPostAcceptPytest(
  cwd?: string,
  extraArgs: string[] = ['tests/test_cli.py', '-q']
): Promise<PytestResult> {
  const allowlisted = SECURITY_ALLOWLIST.ALLOWED_COMMANDS.some(cmd => cmd.includes('pytest'));
  if (!allowlisted) {
    throw new Error('Pytest is not on the security allowlist');
  }

  const workspaceCwd = cwd || process.cwd();
  const venvPythonWin = path.join(workspaceCwd, '.venv', 'Scripts', 'python.exe');
  const venvPythonPosix = path.join(workspaceCwd, '.venv', 'bin', 'python');

  let pythonBin = 'python';
  const fs = await import('fs');
  if (process.platform === 'win32' && fs.existsSync(venvPythonWin)) {
    pythonBin = venvPythonWin;
  } else if (process.platform !== 'win32' && fs.existsSync(venvPythonPosix)) {
    pythonBin = venvPythonPosix;
  }

  const args = ['-m', 'pytest', ...extraArgs];

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

    const proc = spawn(pythonBin, args, {
      cwd: workspaceCwd,
      shell: false,
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: '1'
      }
    });

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      const combined = stdout + '\n' + stderr;
      let summary = combined.trim();

      // Parse counts like: "55 passed, 3 skipped in 0.79s"
      const match = combined.match(/(\d+)\s+passed(?:,\s*(\d+)\s+skipped)?(?:,\s*(\d+)\s+failed)?/i);
      const passedCount = match && match[1] ? parseInt(match[1], 10) : undefined;
      const skippedCount = match && match[2] ? parseInt(match[2], 10) : undefined;
      const failedCount = match && match[3] ? parseInt(match[3], 10) : undefined;

      resolve({
        success: code === 0,
        exitCode: code,
        stdout,
        stderr,
        passedCount,
        skippedCount,
        failedCount,
        summary: summary || (code === 0 ? 'pytest tests/test_cli.py -q passed' : 'pytest failed')
      });
    });

    proc.on('error', (err) => {
      resolve({
        success: false,
        exitCode: -1,
        stdout,
        stderr: err.message,
        summary: `Failed to execute pytest: ${err.message}`
      });
    });
  });
}
