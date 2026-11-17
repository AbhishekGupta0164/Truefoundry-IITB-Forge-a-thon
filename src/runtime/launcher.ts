/**
 * T5: TrueForge Launcher
 *
 * Starts and stops the TrueForge daemon, checks Ollama health,
 * validates Node version, and reports status to the caller.
 */

import { spawn, ChildProcess } from 'child_process';
import * as vscode from 'vscode';

let child: ChildProcess | undefined;
let lastLog = '';

/** Check if a URL is reachable (non-5xx). */
export async function isUp(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return r.status < 500;
  } catch {
    return false;
  }
}

/** Returns Node major version number, e.g. 22 for v22.14.0 */
function getNodeMajorMinor(): { major: number; minor: number } {
  try {
    const v = process.version; // e.g. "v22.14.0"
    const [major, minor] = v.replace('v', '').split('.').map(Number);
    return { major, minor };
  } catch {
    return { major: 0, minor: 0 };
  }
}

/** Check Ollama and start/warn as needed. Only called for ollama/ models. */
async function checkOllama(modelId: string, out: vscode.OutputChannel): Promise<void> {
  const ollamaUp = await isUp('http://127.0.0.1:11434/api/tags');
  if (!ollamaUp) {
    out.appendLine('[Forge] Ollama not running — spawning `ollama serve`...');
    const win = process.platform === 'win32';
    spawn(win ? 'ollama.cmd' : 'ollama', ['serve'], {
      detached: true,
      stdio: 'ignore',
      shell: win,
    }).unref();
    // Give it 3 seconds to come up
    await new Promise(r => setTimeout(r, 3000));
  }

  // Check if the specific model is available
  try {
    const r = await fetch('http://127.0.0.1:11434/api/tags', {
      signal: AbortSignal.timeout(3000),
    });
    if (r.ok) {
      const data = (await r.json()) as { models?: Array<{ name: string }> };
      const models = data.models?.map(m => m.name) ?? [];
      // modelId is like "ollama/llama-3-2-3b"; convert to ollama format
      const ollamaName = modelId.replace('ollama/', '').replace(/-/g, '.');
      const found = models.some(m => m.includes(ollamaName.split(':')[0]));
      if (!found) {
        const pullCmd = `ollama pull ${ollamaName}`;
        vscode.window.showWarningMessage(
          `Forge: Ollama model "${modelId}" not found locally.`,
          pullCmd
        );
        out.appendLine(`[Forge] Model not found. Run: ${pullCmd}`);
      }
    }
  } catch {
    // ignore tag check failures
  }
}

/** Get last N lines of log. */
function lastLines(log: string, n: number): string {
  return log.split('\n').slice(-n).join('\n');
}

/**
 * Start TrueForge daemon.
 * Returns 'ready' | 'migration-error' | 'timeout'.
 */
export async function startTrueForge(
  out: vscode.OutputChannel,
  url: string,
  version: string
): Promise<'ready' | 'migration-error' | 'timeout'> {
  // 1. Node version guard (≥ 22.14)
  const { major, minor } = getNodeMajorMinor();
  if (major < 22 || (major === 22 && minor < 14)) {
    const msg = `Forge requires Node ≥ 22.14 (found v${major}.${minor}). Please upgrade Node.js.`;
    out.appendLine(`[Forge] ${msg}`);
    vscode.window.showErrorMessage(msg);
    return 'timeout';
  }

  // 2. Already up?
  if (await isUp(url)) {
    out.appendLine('[Forge] TrueForge already running.');
    return 'ready';
  }

  // 3. Ollama check (only for ollama/ models)
  const config = vscode.workspace.getConfiguration('forge');
  const model = config.get<string>('model', '');
  if (model.startsWith('ollama/')) {
    await checkOllama(model, out);
  }

  // 4. Spawn TrueForge
  const port = new URL(url).port || '8790';
  const dataDir = config.get<string>('trueforgeDataDir', '');
  const win = process.platform === 'win32';

  const args = ['--yes', `@truefoundry/trueforge@${version}`, '--port', port];
  if (dataDir) {
    args.push('--data-dir', dataDir);
  }

  lastLog = '';
  out.appendLine(`[Forge] Starting TrueForge ${version} on port ${port}...`);

  child = spawn(win ? 'npx.cmd' : 'npx', args, {
    env: {
      ...process.env,
      /* eslint-disable-next-line @typescript-eslint/naming-convention */
      NETWORK_POLICY_ENABLED: 'true',
      /* eslint-disable-next-line @typescript-eslint/naming-convention */
      OUTBOUND_URL_ALLOWED_HOSTS: '["localhost","127.0.0.1"]',
    },
    shell: win,
  });

  const sink = (d: Buffer) => {
    const s = String(d);
    lastLog += s;
    out.append(s);
  };
  child.stdout?.on('data', sink);
  child.stderr?.on('data', sink);

  // 5. Poll up to 60 seconds
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 1000));
    if (await isUp(url)) return 'ready';
    if (/migration.*missing/i.test(lastLog)) return 'migration-error';
  }

  return 'timeout';
}

/** Kill the TrueForge child process. */
export function stopTrueForge(): void {
  child?.kill();
  child = undefined;
}

/** Get the last 20 log lines for error display. */
export function getLastLogLines(): string {
  return lastLines(lastLog, 20);
}
