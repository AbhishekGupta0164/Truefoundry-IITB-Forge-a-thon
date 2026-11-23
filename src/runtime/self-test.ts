/**
 * T5: Forge Self-Test
 *
 * Runs a checklist of PASS/FAIL checks in an Output channel.
 * Checks: Node version, Python, Flask clone, TrueForge reachable,
 *         configured model IDs, MCP ping. It does not create a TrueForge session.
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

/** 3. Flask clone at pinned commit with clean tree */
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
        const dirty = execSync(`git -C "${p}" status --porcelain 2>/dev/null`, { timeout: 3000 })
          .toString()
          .trim();
        if (dirty) {
          return fail(
            `Flask clone at ${FLASK_PINNED_COMMIT} (dirty tree at ${p})`,
            `Review and preserve the existing changes, then use a separate clean Flask 3.1.3 checkout for recording.`
          );
        }
        return pass(`Flask at ${FLASK_PINNED_COMMIT} (clean tree at ${p})`);
      } else {
        return fail(
          `Flask clone at ${FLASK_PINNED_COMMIT}  (found ${commit} at ${p})`,
          `Create a separate clean pallets/flask checkout at ${FLASK_PINNED_COMMIT}; do not reset this checkout.`
        );
      }
    } catch {
      // try next
    }
  }
  return fail(
    `Flask clone at ${FLASK_PINNED_COMMIT}`,
    `Clone flask repo, reset to ${FLASK_PINNED_COMMIT}, and ensure clean working tree`
  );
}

/** 4. Ports configured check */
function checkPorts(): CheckResult {
  const config = vscode.workspace.getConfiguration('forge');
  const mcpPort = config.get<number>('mcpPort', 8765);
  const trueforgeUrl = config.get<string>('trueforgeUrl', 'http://localhost:8790');
  return pass(`Ports configured (MCP: ${mcpPort}, TrueForge: ${trueforgeUrl})`);
}

/** 5. TrueForge reachable */
async function checkTrueForge(): Promise<CheckResult> {
  const config = vscode.workspace.getConfiguration('forge');
  const url = config.get<string>('trueforgeUrl', 'http://localhost:8790');
  const up = await isUp(url);
  return up
    ? pass(`TrueForge reachable  (${url})`)
    : fail(`TrueForge reachable  (${url})`, 'Run: npm run start:all  or use Forge: Start All command');
}

/** 5. Check model IDs from settings without creating a TrueForge session. */
function checkConfiguredModels(): CheckResult {
  const config = vscode.workspace.getConfiguration('forge');
  const primary = config.get<string>('model', '');
  const fallback = config.get<string>('fallbackModel', '');
  if (!primary.trim()) {
    return fail('Model configuration', 'Set forge.model to a provider/model ID in VS Code settings.');
  }
  if (fallback.trim() && fallback.trim() === primary.trim()) {
    return fail('Model configuration', 'forge.fallbackModel must differ from forge.model.');
  }
  const fallbackText = fallback.trim() ? `, fallback: ${fallback.trim()}` : ', fallback: not configured';
  return pass(`Model IDs configured (primary: ${primary.trim()}${fallbackText}; reachability is not tested)`);
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

  let allPass = true;
  const report = (r: CheckResult) => {
    const icon = r.pass ? '✅ PASS' : '❌ FAIL';
    out.appendLine(`${icon}  ${r.name}`);
    if (!r.pass) {
      allPass = false;
      if (r.fix) out.appendLine(`       Fix: ${r.fix}`);
    }
  };

  report(checkNode());
  report(checkPython());
  report(checkFlaskClone());
  report(checkPorts());
  report(await checkTrueForge());
  report(checkConfiguredModels());
  report(await checkMcpPing());

  out.appendLine('');
  out.appendLine(allPass ? '🎉 All checks passed!' : '⚠️  Some checks failed — see fix hints above.');
}
