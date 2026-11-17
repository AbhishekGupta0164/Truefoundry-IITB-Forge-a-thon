import { describe, it, expect, beforeEach } from 'vitest';
import { InlineEditController } from '../../src/ui/inline-edit';
import { validatePythonSource } from '../../src/review/validate';
import { UndoManager } from '../../src/review/undo';
import { CancelManager } from '../../src/review/cancel';
import { HunkCodeLensProvider } from '../../src/review/codelens';
import { PatchStore } from '../../src/review/store';
import { ORIGINAL_DEBUG_FLAG, TRANSFORMED_DEBUG_FLAG } from '../fixtures/debug-flag';

describe('Stage 4: Inline Edit and Review Flow', () => {
  let patchStore: PatchStore;
  let undoManager: UndoManager;
  let cancelManager: CancelManager;
  let codeLensProvider: HunkCodeLensProvider;
  let inlineController: InlineEditController;

  beforeEach(() => {
    patchStore = new PatchStore();
    undoManager = new UndoManager(patchStore);
    cancelManager = new CancelManager(patchStore);
    codeLensProvider = new HunkCodeLensProvider(patchStore);
    inlineController = new InlineEditController({ patchStore });
  });

  it('validates sample transformed get_debug_flag contains "off" and "n" and valid AST syntax', () => {
    expect(TRANSFORMED_DEBUG_FLAG).toContain('{"0", "false", "no", "off", "n"}');
    expect(TRANSFORMED_DEBUG_FLAG).toContain('Values treated as false are:');
    expect(TRANSFORMED_DEBUG_FLAG).not.toEqual(ORIGINAL_DEBUG_FLAG);

    const syntaxCheck = validatePythonSource(TRANSFORMED_DEBUG_FLAG);
    expect(syntaxCheck.valid).toBe(true);
    expect(syntaxCheck.errors.length).toBe(0);
  });

  it('validates python syntax using AST parser', () => {
    const validPy = 'def hello():\n    return "world"\n';
    const invalidPy = 'def hello(\n  broken syntax!!!';

    const validResult = validatePythonSource(validPy);
    expect(validResult.valid).toBe(true);
    expect(validResult.errors.length).toBe(0);

    const invalidResult = validatePythonSource(invalidPy);
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.errors.length).toBeGreaterThan(0);
  });

  it('discards unapproved hunks on cancel', () => {
    patchStore.stagePatch({
      id: 'patch-1',
      targetFile: 'src/flask/helpers.py',
      summary: 'test patch',
      createdAt: Date.now(),
      hunks: [
        {
          id: 'hunk-1',
          file: 'src/flask/helpers.py',
          oldStart: 28,
          oldLines: 6,
          newStart: 28,
          newLines: 8,
          content: '@@ -28,6 +28,8 @@\n- old\n+ new',
          applied: false
        }
      ]
    });

    const stats = cancelManager.cancelAll();
    expect(stats.cancelledPatches).toBe(1);
    expect(stats.abandonedHunks).toBe(1);
    expect(patchStore.getAllPatches().length).toBe(0);
  });

  it('tracks initial state and supports task undo', async () => {
    undoManager.recordInitialState('/tmp/test-file.py', 'original_content = True');
    const result = await undoManager.undoTask();
    expect(result.success).toBe(true);
  });
});
