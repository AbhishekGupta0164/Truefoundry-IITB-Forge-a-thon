import { describe, it, expect, beforeEach } from 'vitest';
import { InlineEditController } from '../../src/ui/inline-edit';
import { validatePythonSource } from '../../src/review/validate';
import { UndoManager } from '../../src/review/undo';
import { CancelManager } from '../../src/review/cancel';
import { HunkCodeLensProvider } from '../../src/review/codelens';
import { PatchStore } from '../../src/review/store';

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

  it('transforms get_debug_flag to include "off" and "n" case-insensitively and updates docstring', async () => {
    const originalCode = [
      'def get_debug_flag() -> bool:',
      '    """Get whether debug mode should be enabled for the app, indicated by the',
      '    :envvar:`FLASK_DEBUG` environment variable. The default is ``False``.',
      '    """',
      '    val = os.environ.get("FLASK_DEBUG")',
      '    return bool(val and val.lower() not in {"0", "false", "no"})'
    ].join('\n');

    const instruction = "Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.";

    const transformed = await inlineController.generateReplacementForTestOnly({
      filePath: 'src/flask/helpers.py',
      selectedText: originalCode,
      instruction,
      fullContent: originalCode
    });

    expect(transformed).toContain('{"0", "false", "no", "off", "n"}');
    expect(transformed).toContain('Values treated as false are:');
    expect(transformed).not.toEqual(originalCode);
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
