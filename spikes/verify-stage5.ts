/**
 * spikes/verify-stage5.ts
 *
 * Task B Verification — Step 3 (Task T1)
 *
 * 1. Checks GET http://localhost:8790 first; exits with code 1 and a clear message if down.
 * 2. Starts a real session through TrueForgeClient.
 * 3. Auto-approves hunks through the real approval path (ReviewManager / apply_patch_hunk).
 * 4. Runs organizer commands inside ../flask and asserts output:
 *    - git diff --stat lists at least 3 files
 *    - pytest tests/test_cli.py -q exits with 0
 *    - flask --help contains 'config'
 *    - flask --app demo/app config masks SECRET_KEY, API_TOKEN and still shows SITE_NAME
 * 5. Ends with git -C ../flask checkout -- . && git -C ../flask clean -fd.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { TrueForgeClient } from '../src/trueforge/client';
import { WorkspaceManager } from '../src/mcp/workspace';
import { PatchStore } from '../src/review/store';
import { ReviewManager } from '../src/review/manager';
import { ForgeMcpServer } from '../src/mcp/server';
import { checkTrueForgeReachable, findFlaskDir } from './verify-stage4';

const TRUEFORGE_URL = process.env.TRUEFORGE_BASE_URL || 'http://localhost:8790';
const MCP_PORT = Number(process.env.MCP_PORT || 8765);

export function getPytestBin(flaskDir: string): string {
  const venvPytest = process.platform === 'win32'
    ? path.join(flaskDir, '.venv', 'Scripts', 'pytest.exe')
    : path.join(flaskDir, '.venv', 'bin', 'pytest');
  return fs.existsSync(venvPytest) ? venvPytest : 'pytest';
}

export function getFlaskBin(flaskDir: string): string {
  const venvFlask = process.platform === 'win32'
    ? path.join(flaskDir, '.venv', 'Scripts', 'flask.exe')
    : path.join(flaskDir, '.venv', 'bin', 'flask');
  return fs.existsSync(venvFlask) ? venvFlask : 'flask';
}

export async function verifyStage5(targetDir?: string) {
  console.log('=== Stage 5: Task B Agent Mode Verification ===\n');

  // (a) Check TrueForge reachability first
  const isUp = await checkTrueForgeReachable(TRUEFORGE_URL);
  if (!isUp) {
    console.error(`TrueForge unreachable at ${TRUEFORGE_URL}. Start TrueForge with scripts/start-trueforge.sh or scripts/start-trueforge.js.`);
    process.exit(1);
  }
  console.log(`✓ TrueForge reachable at ${TRUEFORGE_URL}`);

  const flaskDir = findFlaskDir(targetDir);
  console.log(`✓ Target Flask repository: ${flaskDir}`);

  // Initialize workspace, patch store, and review manager
  const workspaceManager = new WorkspaceManager(flaskDir);
  const patchStore = new PatchStore();
  const reviewManager = new ReviewManager(workspaceManager);

  // Ensure MCP server is active on port 8765
  let mcpServer: ForgeMcpServer | null = null;
  try {
    mcpServer = new ForgeMcpServer({
      port: MCP_PORT,
      workspaceManager,
      patchStore
    });
    await mcpServer.start();
    console.log(`✓ MCP Server listening on port ${MCP_PORT}`);
  } catch (err: any) {
    console.log(`Note: MCP server already active on port ${MCP_PORT} (${err.message})`);
  }

  // (b) Start a real session through TrueForgeClient
  const client = new TrueForgeClient({ baseUrl: TRUEFORGE_URL });
  const rawInstruction =
    "Add a new built-in CLI command flask config that prints the loaded application's configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as '***'. It must appear in flask --help, be covered by a test, and be documented alongside the other built-in commands.";

  console.log('\nStarting real TrueForge turn for Task B...');
  const stream = await client.runTaskB(rawInstruction);

  // Consume turn stream and auto-approve any staged hunks
  for await (const event of stream) {
    if (event.type === 'token') {
      process.stdout.write(event.text);
    } else if (event.type === 'tool_call') {
      console.log(`\n[Tool Call] ${event.name}`);
    } else if (event.type === 'approval') {
      console.log(`\n[Approval Event] Approving call ${event.requestId}...`);
    } else if (event.type === 'error') {
      throw new Error(`Turn error: ${event.message}`);
    }

    // (c) Auto-approve hunks through the real approval path
    for (const patch of patchStore.getAllPatches()) {
      for (const hunk of patch.hunks) {
        if (!hunk.applied) {
          console.log(`\n[Approval] Applying hunk ${hunk.id} for ${hunk.file}...`);
          try {
            await reviewManager.acceptHunk(patch.id, hunk.id);
          } catch (approveErr: any) {
            console.log(`Note on acceptHunk: ${approveErr.message}`);
          }
        }
      }
    }
  }

  // Final approval pass for any remaining hunks
  for (const patch of patchStore.getAllPatches()) {
    for (const hunk of patch.hunks) {
      if (!hunk.applied) {
        try {
          await reviewManager.acceptHunk(patch.id, hunk.id);
        } catch {}
      }
    }
  }

  console.log('\n\n--- Running Task B Assertions on Flask ---');

  // (d.1) git diff --stat lists at least 3 files
  const diffStat = execFileSync('git', ['-C', flaskDir, 'diff', '--stat'], { encoding: 'utf-8' });
  console.log('git diff --stat:\n' + diffStat);
  const changedFiles = diffStat
    .split('\n')
    .map(l => l.trim().split('|')[0]?.trim())
    .filter(Boolean)
    .filter(f => !f.includes('file changed') && !f.includes('files changed'));

  console.log(`Detected changed files: ${changedFiles.join(', ')}`);
  if (changedFiles.length < 3) {
    throw new Error(`Task B requires at least 3 changed files (code, tests, docs). Found: ${changedFiles.length}`);
  }
  console.log('✓ git diff --stat shows at least 3 files');

  // (d.2) pytest tests/test_cli.py -q exits 0
  const pytestBin = getPytestBin(flaskDir);
  console.log(`\nRunning ${pytestBin} tests/test_cli.py -q...`);
  const pytestOutput = execFileSync(pytestBin, ['tests/test_cli.py', '-q'], {
    cwd: flaskDir,
    encoding: 'utf-8'
  });
  console.log('Pytest output:\n' + pytestOutput);
  console.log('✓ pytest tests/test_cli.py -q exited 0');

  // (d.3) flask --help contains config
  const flaskBin = getFlaskBin(flaskDir);
  const helpOutput = execFileSync(flaskBin, ['--help'], {
    cwd: flaskDir,
    encoding: 'utf-8'
  });
  if (!helpOutput.includes('config')) {
    throw new Error("flask --help does not list the new 'config' command");
  }
  console.log("✓ flask --help contains 'config'");

  // (d.4) flask --app demo/app config masks SECRET_KEY, API_TOKEN and still shows SITE_NAME
  const demoDir = path.join(flaskDir, 'demo');
  const demoAppPath = path.join(demoDir, 'app.py');
  if (!fs.existsSync(demoDir)) fs.mkdirSync(demoDir, { recursive: true });

  fs.writeFileSync(
    demoAppPath,
    [
      'from flask import Flask',
      'app = Flask(__name__)',
      'app.config["SECRET_KEY"] = "super-secret-key-12345"',
      'app.config["API_TOKEN"] = "sensitive-api-token-abc"',
      'app.config["SITE_NAME"] = "TrueFoundry Demo Site"',
      'if __name__ == "__main__":',
      '    app.run()'
    ].join('\n'),
    'utf-8'
  );

  console.log('\nRunning flask --app demo/app config...');
  const configOutput = execFileSync(flaskBin, ['--app', 'demo/app', 'config'], {
    cwd: flaskDir,
    encoding: 'utf-8'
  });
  console.log('Config output:\n' + configOutput);

  if (configOutput.includes('super-secret-key-12345') || configOutput.includes('sensitive-api-token-abc')) {
    throw new Error('Secret masking failed: raw secret value appeared in JSON output!');
  }
  if (!configOutput.includes('***')) {
    throw new Error("Secret masking failed: expected '***' for masked keys!");
  }
  if (!configOutput.includes('TrueFoundry Demo Site')) {
    throw new Error('Normal config key SITE_NAME was missing from config JSON output!');
  }
  console.log('✓ Secret masking verified: secrets masked as "***", SITE_NAME preserved!');

  // (6) Reset Flask tree cleanly
  console.log('\nCleaning up Flask working tree...');
  execFileSync('git', ['-C', flaskDir, 'checkout', '--', '.'], { stdio: 'inherit' });
  execFileSync('git', ['-C', flaskDir, 'clean', '-fd'], { stdio: 'inherit' });
  console.log('✓ Flask tree restored to pristine commit.');

  if (mcpServer) {
    await mcpServer.stop().catch(() => {});
  }

  console.log('\n=== Stage 5 Verification PASSED! ===');
}

if (require.main === module) {
  verifyStage5().catch(err => {
    console.error('Stage 5 verification failed:', err.message);
    process.exit(1);
  });
}
