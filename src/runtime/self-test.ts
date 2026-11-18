/**
 * T5: Forge Self-Test
 *
 * Runs a checklist of PASS/FAIL checks in an Output channel.
 * Checks: Node version, Python, Flask clone, TrueForge reachable,
 *         model answers hello, MCP ping.
 */

import { execSync } from 'child_process';
import * as vscode from 'vscode';
import { isUp } from './launcher';

const FLASK_PINNED_COMMIT = '22d92470';

interface CheckResult {
  name: string;
  pass: boolean;
  fix?: string;
}

function pass(name: string): CheckResult {
  return { name, pass: true };
}

function fail(name: string, fix: string): CheckResult {
  return { name, pass: false, fix };
}

/** 1. Node ≥ 22.14 */
function checkNode(): CheckResult {
  const v = process.version;
  const [major, minor] = v.replace('v', '').split('.').map(Number);
  const ok = major > 22 || (major === 22 && minor >= 14);
  return ok
    ? pass(`Node ≥ 22.14  (found ${v})`)
    : fail(`Node ≥ 22.14  (found ${v})`, 'Download Node 22.14+ from https://nodejs.org');
}

/** 2. Python found */
function checkPython(): CheckResult {
  try {
    const v = execSync('python3 --version 2>&1', { timeout: 3000 }).toString().trim();
    return pass(`Python found  (${v})`);
  } catch {
    try {
      const v = execSync('python --version 2>&1', { timeout: 3000 }).toString().trim();
      return pass(`Python found  (${v})`);
    } catch {
      return fail('Python found', 'Install Python 3 from https://www.python.org');
    }
  }
}

/** 3. Flask clone at pinned commit */
function checkFlaskClone(): CheckResult {
  // Try common locations
  const candidates = [
    '/Users/' + (process.env['USER'] || '') + '/Developer/Projects/Truefoundry/flask',
    '/Users/' + (process.env['USER'] || '') + '/flask',
    process.cwd() + '/../flask',
  ];

  for (const p of candidates) {
    try {
      const commit = execSync(`git -C "${p}" rev-parse HEAD 2>/dev/null`, { timeout: 3000 })
        .toString()
        .trim()
        .slice(0, 8);
      if (commit === FLASK_PINNED_COMMIT) {
        return pass(`Flask clone at ${FLASK_PINNED_COMMIT}  (${p})`);
      } else {
        return fail(
          `Flask clone at ${FLASK_PINNED_COMMIT}  (found ${commit} at ${p})`,
          `Run: git -C "${p}" reset --hard ${FLASK_PINNED_COMMIT}`
        );
      }
    } catch {
      // try next
    }
  }
  return fail(
    `Flask clone at ${FLASK_PINNED_COMMIT}`,
    `Clone flask repo and reset to ${FLASK_PINNED_COMMIT}`
  );
}

/** 4. TrueForge reachable */
async function checkTrueForge(): Promise<CheckResult> {
  const config = vscode.workspace.getConfiguration('forge');
  const url = config.get<string>('trueforgeUrl', 'http://localhost:8790');
  const up = await isUp(url);
  return up
    ? pass(`TrueForge reachable  (${url})`)
    : fail(`TrueForge reachable  (${url})`, 'Run: npm run start:all  or use Forge: Start All command');
}

/** 5. Model answers hello */
async function checkModelHello(): Promise<CheckResult> {
  const config = vscode.workspace.getConfiguration('forge');
  const url = config.get<string>('trueforgeUrl', 'http://localhost:8790');
  const model = config.get<string>('model', 'ollama/llama-3-2-3b');

  try {
    const r = await fetch(`${url}/api/v1/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent: {
          spec: {
            model: { name: model },
            instructions: 'Reply with exactly: hello'
          }
        }
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return fail('Model answers hello', `TrueForge returned ${r.status} — check forge.model setting (current: ${model}). ${body.slice(0, 100)}`);
    }
    const { data: session } = (await r.json()) as { data?: { id?: string } };
    if (!session?.id) {
      return fail('Model answers hello', 'Session creation returned no ID');
    }
    return pass(`Model answers hello  (model: ${model}, session: ${session.id.slice(0, 8)})`);
  } catch (e: any) {
    return fail('Model answers hello', `Error: ${e.message} — check TrueForge and model`);
  }
}

/** 6. MCP ping */
async function checkMcpPing(): Promise<CheckResult> {
  const config = vscode.workspace.getConfiguration('forge');
  const port = config.get<number>('mcpPort', 8765);
  const url = `http://127.0.0.1:${port}/mcp`;
  const up = await isUp(url);
  return up
    ? pass(`MCP ping  (127.0.0.1:${port})`)
    : fail(`MCP ping  (127.0.0.1:${port})`, 'Extension MCP server not running — reload VS Code window. If TrueForge connector shows 401, run command: Forge: Copy MCP Connector Config and update the API key.');
}

/** Run all self-test checks and display in Output channel. */
export async function runSelfTest(): Promise<void> {
  const out = vscode.window.createOutputChannel('Forge Self-Test');
  out.show(true);
  out.appendLine('=== Forge Self-Test ===');
  out.appendLine('');

  const results: CheckResult[] = [];

  results.push(checkNode());
  results.push(checkPython());
  results.push(checkFlaskClone());
  results.push(await checkTrueForge());
  results.push(await checkModelHello());
  results.push(await checkMcpPing());

  let allPass = true;
  for (const r of results) {
    const icon = r.pass ? '✅ PASS' : '❌ FAIL';
    out.appendLine(`${icon}  ${r.name}`);
    if (!r.pass) {
      allPass = false;
      out.appendLine(`       Fix: ${r.fix}`);
    }
  }

  out.appendLine('');
  out.appendLine(allPass ? '🎉 All checks passed!' : '⚠️  Some checks failed — see fix hints above.');
}
