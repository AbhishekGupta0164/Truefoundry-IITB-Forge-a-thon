/**
 * spikes/verify-stage4.ts
 *
 * Task A Verification — Step 3 (Task T1)
 *
 * 1. Checks GET http://localhost:8790 first; exits with code 1 and a clear message if down.
 * 2. Starts a real session through TrueForgeClient.
 * 3. Auto-approves hunks through the real approval path (ReviewManager / apply_patch_hunk).
 * 4. Runs organizer commands inside ../flask and asserts output:
 *    - FLASK_DEBUG=off -> False
 *    - FLASK_DEBUG=N   -> False
 *    - FLASK_DEBUG=Off -> False
 *    - FLASK_DEBUG=1   -> True
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

const TRUEFORGE_URL = process.env.TRUEFORGE_BASE_URL || 'http://localhost:8790';
const MCP_PORT = Number(process.env.MCP_PORT || 8765);

export async function checkTrueForgeReachable(url = TRUEFORGE_URL): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return res.status < 500;
  } catch {
    return false;
  }
}

export function findFlaskDir(targetDir?: string): string {
  const candidates = [
    targetDir,
    process.env.FLASK_DIR,
    path.resolve(__dirname, '../../Flask'),
    path.resolve(__dirname, '../../flask'),
    path.resolve(__dirname, '../Flask'),
    path.resolve(__dirname, '../flask'),
    path.resolve(process.cwd(), '../Flask'),
    path.resolve(process.cwd(), '../flask')
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'src/flask/helpers.py'))) {
      return c;
    }
  }
  throw new Error('Flask repository not found. Please ensure pallets/flask clone is at ../Flask or set FLASK_DIR.');
}

export function getPythonBin(flaskDir: string): string {
  const venvPython = process.platform === 'win32'
    ? path.join(flaskDir, '.venv', 'Scripts', 'python.exe')
    : path.join(flaskDir, '.venv', 'bin', 'python');
  return fs.existsSync(venvPython) ? venvPython : (process.platform === 'win32' ? 'python' : 'python3');
}

export async function verifyStage4(targetDir?: string) {
  console.log('=== Stage 4: Task A Inline Edit Verification ===\n');

  // (a) Check TrueForge reachability first
  const isUp = await checkTrueForgeReachable(TRUEFORGE_URL);
  if (!isUp) {
    console.error(`TrueForge unreachable at ${TRUEFORGE_URL}. Start TrueForge with scripts/start-trueforge.sh or scripts/start-trueforge.js.`);
    process.exit(1);
  }
  console.log(`✓ TrueForge reachable at ${TRUEFORGE_URL}`);

  const flaskDir = findFlaskDir(targetDir);
  console.log(`✓ Target Flask repository: ${flaskDir}`);

  const targetFile = 'src/flask/helpers.py';
  const fullPath = path.join(flaskDir, targetFile);
  const initialContent = fs.readFileSync(fullPath, 'utf-8');

  const functionStart = initialContent.indexOf('def get_debug_flag() -> bool:');
  const functionEnd = initialContent.indexOf('def get_load_dotenv', functionStart);
  if (functionStart === -1 || functionEnd === -1) {
    throw new Error('Could not locate get_debug_flag in helpers.py');
  }

  const selectedText = initialContent.slice(functionStart, functionEnd).trimEnd();
  const startLine = initialContent.slice(0, functionStart).split('\n').length;
  const endLine = startLine + selectedText.split('\n').length - 1;

  // Initialize workspace, patch store, and review manager
  const workspaceManager = new WorkspaceManager(flaskDir);
  const patchStore = new PatchStore();
  const reviewManager = new ReviewManager(workspaceManager);

  // Ensure MCP server is running on port 8765
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
  const instruction =
    "Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.";

  console.log('\nStarting real TrueForge turn for Task A...');
  const stream = await client.runTaskA({
    filePath: targetFile,
    selectionRange: { startLine, startCol: 1, endLine, endCol: 1 },
    selectedText,
    instruction,
    fullContent: initialContent
  });

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

  console.log('\n\n--- Running Task A Assertions on Flask ---');
  const pythonBin = getPythonBin(flaskDir);
  const checkCmd = 'from flask.helpers import get_debug_flag; print(get_debug_flag())';

  function testFlag(flagVal: string): string {
    return execFileSync(pythonBin, ['-c', checkCmd], {
      cwd: flaskDir,
      env: { ...process.env, FLASK_DEBUG: flagVal },
      encoding: 'utf-8'
    }).trim();
  }

  // (d) Task A assertions
  const resOff = testFlag('off');
  console.log(`FLASK_DEBUG=off -> ${resOff}`);
  if (resOff !== 'False') throw new Error(`Expected 'False' for FLASK_DEBUG=off, got '${resOff}'`);

  const resN = testFlag('N');
  console.log(`FLASK_DEBUG=N   -> ${resN}`);
  if (resN !== 'False') throw new Error(`Expected 'False' for FLASK_DEBUG=N, got '${resN}'`);

  const resUpperOff = testFlag('Off');
  console.log(`FLASK_DEBUG=Off -> ${resUpperOff}`);
  if (resUpperOff !== 'False') throw new Error(`Expected 'False' for FLASK_DEBUG=Off, got '${resUpperOff}'`);

  const resOne = testFlag('1');
  console.log(`FLASK_DEBUG=1   -> ${resOne}`);
  if (resOne !== 'True') throw new Error(`Expected 'True' for FLASK_DEBUG=1, got '${resOne}'`);

  console.log('✓ All Task A assertions passed!');

  // (6) Reset Flask tree cleanly
  console.log('\nCleaning up Flask working tree...');
  execFileSync('git', ['-C', flaskDir, 'checkout', '--', '.'], { stdio: 'inherit' });
  execFileSync('git', ['-C', flaskDir, 'clean', '-fd'], { stdio: 'inherit' });
  console.log('✓ Flask tree restored to pristine commit.');

  if (mcpServer) {
    await mcpServer.stop().catch(() => {});
  }

  console.log('\n=== Stage 4 Verification PASSED! ===');
}

if (require.main === module) {
  verifyStage4().catch(err => {
    console.error('Stage 4 verification failed:', err.message);
    process.exit(1);
  });
}
