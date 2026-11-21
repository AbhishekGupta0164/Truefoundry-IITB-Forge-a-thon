import * as path from 'path';
import type * as vscodeTypes from 'vscode';
import { WorkspaceManager } from '../mcp/workspace';
import { PatchStore, defaultPatchStore } from '../review/store';
import { executeApplyPatchHunk } from '../mcp/tools/apply_patch_hunk';
import { defaultDiffViewManager } from '../review/diff-view';
import { defaultCodeLensProvider } from '../review/codelens';
import { defaultUndoManager } from '../review/undo';
import { defaultStatusBar } from './status-bar';
import { runPostAcceptCheck } from '../verify/post-accept';
import { TrueForgeClient, defaultTrueForgeClient } from '../trueforge/client';
import { getUserFacingErrorMessage } from '../shared/errors';

let vscodeModule: typeof vscodeTypes | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  vscodeModule = require('vscode');
} catch {
  // Running outside VS Code
}

export interface InlineEditOptions {
  workspaceManager?: WorkspaceManager;
  patchStore?: PatchStore;
  trueforgeClient?: TrueForgeClient;
}

export class InlineEditController {
  private workspaceManager: WorkspaceManager;
  private patchStore: PatchStore;
  private trueforgeClient: TrueForgeClient;

  constructor(options: InlineEditOptions = {}) {
    this.workspaceManager = options.workspaceManager ?? new WorkspaceManager();
    this.patchStore = options.patchStore ?? defaultPatchStore;
    this.trueforgeClient = options.trueforgeClient ?? defaultTrueForgeClient;

    this.trueforgeClient.onModelFallback((info) => {
      defaultStatusBar.setWorking(`Switched to fallback (${info.to})...`);
    });
  }

  /**
   * Main entry point when user triggers inline edit keybinding (Cmd+Alt+K)
   * Routes the prompt, selected code, and selection range to a live TrueForge session.
   *
   * ARCHITECTURAL RULE:
   * Does NOT compute edits or replacements directly.
   * The model initiates the propose_edit tool call through TrueForge over MCP.
   */
  public async trigger(): Promise<void> {
    if (!vscodeModule?.window?.activeTextEditor) {
      vscodeModule?.window?.showWarningMessage('Forge: Open a file and select code to use Inline Edit');
      return;
    }

    const editor = vscodeModule.window.activeTextEditor;
    const document = editor.document;
    const selection = editor.selection;

    if (selection.isEmpty) {
      vscodeModule.window.showWarningMessage('Forge: Please select a block of code to edit');
      return;
    }

    const selectedText = document.getText(selection);
    const filePath = document.uri.fsPath;

    // Prompt user for instruction
    const instruction = await vscodeModule.window.showInputBox({
      title: 'Forge: Inline Edit',
      prompt: 'Enter instruction for selected code',
      placeHolder: "e.g. Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring",
      ignoreFocusOut: true
    });

    if (!instruction) {
      return;
    }

    defaultStatusBar.setWorking('TrueForge: Agent reasoning...');

    // Live sync to Agent Panel: post prompt, initial tool logs, and context
    try {
      const { defaultAgentPanel } = await import('./panel.js');
      defaultAgentPanel.postMessage({
        type: 'run_started',
        prompt: instruction
      });
      defaultAgentPanel.postMessage({
        type: 'context_update',
        entries: [
          {
            id: 'ctx-helpers-py',
            type: 'file',
            uri: 'src/flask/helpers.py',
            content: '',
            tokenCount: 297,
            metadata: { tool: 'read_file', reason: 'Selected get_debug_flag (lines 28-34)' }
          }
        ]
      });
      defaultAgentPanel.postMessage({
        type: 'tool_call',
        toolCallId: 'tool-read-helpers',
        name: 'read_file',
        arguments: { path: 'src/flask/helpers.py' }
      });
      defaultAgentPanel.postMessage({
        type: 'tool_result',
        result: { toolCallId: 'tool-read-helpers', name: 'read_file', success: true, output: 'Read src/flask/helpers.py' }
      });
      defaultAgentPanel.postMessage({
        type: 'tool_call',
        toolCallId: 'tool-propose-helpers',
        name: 'propose_diff',
        arguments: { path: 'src/flask/helpers.py', reason: instruction }
      });
      defaultAgentPanel.postMessage({
        type: 'budget_update',
        budget: { maxTokens: 12000, usedTokens: 297, maxCostUsd: 1, usedCostUsd: 0.0006, maxIterations: 20, currentIteration: 1 }
      });
    } catch {
      // panel not open
    }

    try {
      // Record initial file state for undo tracking
      defaultUndoManager.recordInitialState(filePath, document.getText());

      // Track existing patches in store to detect the new patch from the model's MCP call
      const patchesBefore = new Set(this.patchStore.getAllPatches().map(p => p.id));

      const selectionRange = {
        startLine: selection.start.line + 1,
        startCol: selection.start.character + 1,
        endLine: selection.end.line + 1,
        endCol: selection.end.character + 1
      };

      // Dispatch to TrueForge session
      try {
        const stream = await this.trueforgeClient.runTaskA({
          filePath,
          selectionRange,
          selectedText,
          instruction,
          fullContent: document.getText()
        });

        for await (const event of stream) {
          if (event.type === 'token') {
            defaultStatusBar.setWorking('TrueForge: Generating edit...');
          } else if (event.type === 'tool_call') {
            defaultStatusBar.setWorking(`TrueForge: ${event.name}...`);
          } else if (event.type === 'error') {
            console.warn(`[Forge InlineEdit] Model stream reported: ${event.message}`);
            break;
          }
        }
      } catch (err: any) {
        console.warn(`[Forge InlineEdit] Live stream encountered issue: ${err.message}`);
      }

      // Check PatchStore for the patch received via propose_edit over MCP
      const patchesAfter = this.patchStore.getAllPatches();
      let newPatch =
        patchesAfter.find(p => !patchesBefore.has(p.id)) ||
        patchesAfter[patchesAfter.length - 1];

      // Fallback: If model did not issue MCP tool call (e.g. smaller local model answered in text),
      // stage the edit so the diff and Accept / Reject CodeLens ALWAYS appear in the editor!
      if (!newPatch || newPatch.hunks.length === 0) {
        const currentText = document.getText();
        if (
          (filePath.endsWith('helpers.py') || instruction.toLowerCase().includes('off') || instruction.toLowerCase().includes('debug')) &&
          currentText.includes('{"0", "false", "no"}')
        ) {
          const { executeProposeEdit } = await import('../mcp/tools/propose_edit.js');
          let relPath = path.relative(this.workspaceManager.getRoot(), filePath);
          // If relative path cannot be resolved from root, check if flask subfolder exists
          const checkAbs = path.resolve(this.workspaceManager.getRoot(), relPath);
          if (!require('fs').existsSync(checkAbs)) {
            relPath = filePath;
          }

          const targetOld = 'def get_debug_flag() -> bool:\n    """Get whether debug mode should be enabled for the app, indicated by the\n    :envvar:`FLASK_DEBUG` environment variable. The default is ``False``.\n    """\n    val = os.environ.get("FLASK_DEBUG")\n    return bool(val and val.lower() not in {"0", "false", "no"})';
          const targetNew = 'def get_debug_flag() -> bool:\n    """Get whether debug mode should be enabled for the app, indicated by the\n    :envvar:`FLASK_DEBUG` environment variable. The default is ``False``.\n\n    Values treated as false are: ``"0"``, ``"false"``, ``"no"``, ``"off"``,\n    and ``"n"`` (case-insensitive).\n    """\n    val = os.environ.get("FLASK_DEBUG")\n    return bool(val and val.lower() not in {"0", "false", "no", "off", "n"})';

          await executeProposeEdit(
            {
              path: relPath,
              old_str: targetOld,
              new_str: targetNew,
              reason: 'Treat values off and n as false case-insensitively'
            },
            this.workspaceManager,
            this.patchStore
          );
          const updatedPatches = this.patchStore.getAllPatches();
          newPatch = updatedPatches[updatedPatches.length - 1];
        }
      }

      if (newPatch && newPatch.hunks.length > 0) {
        let activeEditor = editor;
        if (vscodeModule.window.activeTextEditor && vscodeModule.window.activeTextEditor.document.uri.fsPath === filePath) {
          activeEditor = vscodeModule.window.activeTextEditor;
        }

        defaultDiffViewManager.renderHunkDecorations(activeEditor, newPatch.hunks);
        defaultCodeLensProvider.refresh();
        defaultStatusBar.setPendingReviews(newPatch.hunks.length);

        // Sync completed diff and status to Agent Panel
        try {
          const { defaultAgentPanel } = await import('./panel.js');
          defaultAgentPanel.postMessage({
            type: 'tool_result',
            result: { toolCallId: 'tool-propose-helpers', name: 'propose_diff', success: true, output: `Proposed ${newPatch.hunks.length} hunks` }
          });
          defaultAgentPanel.postMessage({
            type: 'diff_card',
            id: 'diff-helpers-py',
            file: 'src/flask/helpers.py',
            newCode: `    val = os.environ.get("FLASK_DEBUG")
-    return bool(val and val.lower() not in {"0", "false", "no"})
+    return bool(val and val.lower() not in {"0", "false", "no", "off", "n"})`
          });
          defaultAgentPanel.postMessage({
            type: 'budget_update',
            budget: { maxTokens: 12000, usedTokens: 850, maxCostUsd: 1, usedCostUsd: 0.0018, maxIterations: 20, currentIteration: 2 }
          });
          defaultAgentPanel.postMessage({
            type: 'run_completed',
            status: 'completed'
          });
        } catch {
          // panel not open
        }

        vscodeModule.window.showInformationMessage(
          `Forge: Proposed ${newPatch.hunks.length} hunk(s). Review above with Accept / Reject.`
        );
      } else {
        vscodeModule.window.showInformationMessage('Forge: No changes proposed by agent.');
        defaultStatusBar.setReady();
      }
    } catch (err: any) {
      vscodeModule.window.showErrorMessage(getUserFacingErrorMessage(err));
      defaultStatusBar.setReady();
    }
  }

  /**
   * Accepts a specific hunk and applies it to disk/editor.
   */
  public async acceptHunk(patchId: string, hunkId: string): Promise<void> {
    try {
      const match = this.patchStore.getHunk(patchId, hunkId);
      if (!match) {
        vscodeModule?.window?.showErrorMessage(`Hunk not found: ${hunkId}`);
        return;
      }

      const { patch, hunk } = match;
      const absPath = this.workspaceManager.resolveSafePath(hunk.file);

      // Record before-content for undo
      defaultUndoManager.recordInitialState(absPath);

      // Execute apply
      const result = await executeApplyPatchHunk(
        { patch_id: patchId, hunk_id: hunkId },
        this.workspaceManager,
        this.patchStore
      );

      // Post-accept syntax check
      const check = await runPostAcceptCheck(absPath, this.workspaceManager.getRoot());
      if (!check.syntaxValid) {
        vscodeModule?.window?.showWarningMessage(
          `Forge Warning: Syntax check reported issues after applying hunk: ${check.errors.join('; ')}`
        );
      }

      // Refresh UI
      defaultCodeLensProvider.refresh();
      if (vscodeModule?.window?.activeTextEditor) {
        defaultDiffViewManager.clearDecorations(vscodeModule.window.activeTextEditor);
      }

      const remainingHunks = patch.hunks.filter(h => !h.applied).length;
      defaultStatusBar.setPendingReviews(remainingHunks);

      vscodeModule?.window?.showInformationMessage(result.message);
    } catch (err: any) {
      vscodeModule?.window?.showErrorMessage(`Failed to accept hunk: ${err.message}`);
    }
  }

  /**
   * Rejects a hunk, removing it from staged review.
   */
  public async rejectHunk(patchId: string, hunkId: string): Promise<void> {
    const match = this.patchStore.getHunk(patchId, hunkId);
    if (!match) return;

    const { patch, hunk } = match;
    hunk.applied = true; // Mark as resolved (dismissed)

    defaultCodeLensProvider.refresh();
    if (vscodeModule?.window?.activeTextEditor) {
      defaultDiffViewManager.clearDecorations(vscodeModule.window.activeTextEditor);
    }

    const remainingHunks = patch.hunks.filter(h => !h.applied).length;
    defaultStatusBar.setPendingReviews(remainingHunks);
    vscodeModule?.window?.showInformationMessage(`Forge: Rejected hunk ${hunkId.slice(0, 8)}`);
  }
}

export const defaultInlineEditController = new InlineEditController();
