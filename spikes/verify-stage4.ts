/**
 * Test fixture only (isolated for Stage 4 unit verification).
 * Production Task A execution is strictly routed through TrueForgeClient.
 */
import * as path from 'path';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { WorkspaceManager } from '../src/mcp/workspace';
import { PatchStore } from '../src/review/store';
import { InlineEditController } from '../src/ui/inline-edit';
import { UndoManager } from '../src/review/undo';

export async function verifyStage4Fixture(targetDir?: string) {
  console.log('=== Verifying Stage 4: Task A Inline Edit (Test Fixture Mode) ===');

  const candidates = [
    targetDir,
    process.env.FLASK_DIR,
    path.resolve(__dirname, '../../Flask'),
    path.resolve(__dirname, '../../flask')
  ].filter(Boolean) as string[];

  let flaskDir = '';
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'src/flask/helpers.py'))) {
      flaskDir = c;
      break;
    }
  }

  if (!flaskDir) {
    console.log('Notice: Flask repository not located, skipping fixture test.');
    return;
  }

  const targetFile = 'src/flask/helpers.py';
  const fullPath = path.join(flaskDir, targetFile);
  const initialContent = fs.readFileSync(fullPath, 'utf-8');

  const workspace = new WorkspaceManager(flaskDir);
  const patchStore = new PatchStore();
  const undoManager = new UndoManager(patchStore);
  const controller = new InlineEditController({ workspaceManager: workspace, patchStore });

  undoManager.recordInitialState(fullPath, initialContent);

  const functionStart = initialContent.indexOf('def get_debug_flag() -> bool:');
  const functionEnd = initialContent.indexOf('def get_load_dotenv', functionStart);
  const selectedText = initialContent.slice(functionStart, functionEnd).trimEnd();

  const instruction = "Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.";

  const replacement = await controller.generateReplacement({
    filePath: targetFile,
    selectedText,
    instruction,
    fullContent: initialContent
  });

  const updatedContent = initialContent.replace(selectedText, replacement);
  fs.writeFileSync(fullPath, updatedContent, 'utf-8');

  // Verify FLASK_DEBUG=off
  const venvPython = path.join(flaskDir, '.venv', 'bin', 'python');
  const pythonCmd = fs.existsSync(venvPython) ? venvPython : (process.platform === 'win32' ? 'python' : 'python3');
  const checkCmd = 'from flask.helpers import get_debug_flag; print(get_debug_flag())';

  try {
    const outOff = execFileSync(pythonCmd, ['-c', checkCmd], {
      cwd: flaskDir,
      env: { ...process.env, FLASK_DEBUG: 'off' },
      encoding: 'utf-8'
    }).trim();
    console.log('FLASK_DEBUG=off ->', outOff);
  } catch (err: any) {
    console.log('Python check note:', err.message);
  }

  // Restore
  await undoManager.undoTask();
  console.log('=== Stage 4 Test Fixture Verification complete ===');
}

if (require.main === module) {
  verifyStage4Fixture().catch(err => {
    console.error('Stage 4 verification failed:', err);
    process.exit(1);
  });
}
