/**
 * Verification script for Stage 4: Task A Inline Edit
 */
import * as path from 'path';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { WorkspaceManager } from '../src/mcp/workspace';
import { PatchStore } from '../src/review/store';
import { InlineEditController } from '../src/ui/inline-edit';
import { UndoManager } from '../src/review/undo';

async function verifyStage4() {
  console.log('=== Verifying Stage 4: Task A Inline Edit ===');

  const flaskDir = '/Users/abhishekbaderia/Developer/Projects/Truefoundry/flask';
  const targetFile = 'src/flask/helpers.py';
  const fullPath = path.join(flaskDir, targetFile);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Flask target file not found: ${fullPath}`);
  }

  const initialContent = fs.readFileSync(fullPath, 'utf-8');
  console.log('1. Target file found:', targetFile);

  const workspace = new WorkspaceManager(flaskDir);
  const patchStore = new PatchStore();
  const undoManager = new UndoManager(patchStore);
  const controller = new InlineEditController({ workspaceManager: workspace, patchStore });

  // Record initial state for undo
  undoManager.recordInitialState(fullPath, initialContent);

  // Exact function text to select
  const functionStart = initialContent.indexOf('def get_debug_flag() -> bool:');
  const functionEnd = initialContent.indexOf('def get_load_dotenv', functionStart);
  const selectedText = initialContent.slice(functionStart, functionEnd).trimEnd();

  console.log('2. Selected text extracted (lines %d to %d)', 28, 34);

  // Exact instruction from the problem prompt
  const instruction = "Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.";

  // Generate replacement
  const replacement = await controller.generateReplacement({
    filePath: targetFile,
    selectedText,
    instruction,
    fullContent: initialContent
  });

  console.log('3. Replacement generated. Applying to file...');
  const updatedContent = initialContent.replace(selectedText, replacement);
  fs.writeFileSync(fullPath, updatedContent, 'utf-8');

  // Verify FLASK_DEBUG=off
  const pythonBin = path.join(flaskDir, '.venv', 'bin', 'python');
  const checkCmd = 'from flask.helpers import get_debug_flag; print(get_debug_flag())';

  const outOff = execFileSync(pythonBin, ['-c', checkCmd], {
    env: { ...process.env, FLASK_DEBUG: 'off' },
    encoding: 'utf-8'
  }).trim();
  console.log('4. FLASK_DEBUG=off ->', outOff, '(expect False)');
  if (outOff !== 'False') throw new Error(`Expected False, got ${outOff}`);

  const outN = execFileSync(pythonBin, ['-c', checkCmd], {
    env: { ...process.env, FLASK_DEBUG: 'N' },
    encoding: 'utf-8'
  }).trim();
  console.log('5. FLASK_DEBUG=N ->', outN, '(expect False)');
  if (outN !== 'False') throw new Error(`Expected False, got ${outN}`);

  const outOffCap = execFileSync(pythonBin, ['-c', checkCmd], {
    env: { ...process.env, FLASK_DEBUG: 'Off' },
    encoding: 'utf-8'
  }).trim();
  console.log('6. FLASK_DEBUG=Off ->', outOffCap, '(expect False)');
  if (outOffCap !== 'False') throw new Error(`Expected False, got ${outOffCap}`);

  // Test Undo: restore initial file
  console.log('7. Triggering undo...');
  await undoManager.undoTask();

  const finalDiff = execFileSync('git', ['diff', 'src/flask/helpers.py'], {
    cwd: flaskDir,
    encoding: 'utf-8'
  }).trim();

  console.log('8. Git diff after undo:', finalDiff ? finalDiff : '(empty - clean undo!)');
  if (finalDiff !== '') {
    throw new Error('Undo did not restore file cleanly!');
  }

  console.log('=== Stage 4 Verification PASSED! ===');
}

verifyStage4().catch((err) => {
  console.error('Stage 4 verification failed:', err);
  process.exit(1);
});
