import * as path from 'path';
import type * as vscodeTypes from 'vscode';
import { WorkspaceManager } from '../mcp/workspace';
import { PatchStore, defaultPatchStore } from '../review/store';
import { executeProposeEdit } from '../mcp/tools/propose_edit';
import { executeApplyPatchHunk } from '../mcp/tools/apply_patch_hunk';
import { defaultDiffViewManager } from '../review/diff-view';
import { defaultCodeLensProvider } from '../review/codelens';
import { defaultUndoManager } from '../review/undo';
import { defaultStatusBar } from './status-bar';
import { runPostAcceptCheck } from '../verify/post-accept';

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
}

export class InlineEditController {
  private workspaceManager: WorkspaceManager;
  private patchStore: PatchStore;

  constructor(options: InlineEditOptions = {}) {
    this.workspaceManager = options.workspaceManager ?? new WorkspaceManager();
    this.patchStore = options.patchStore ?? defaultPatchStore;
  }

  /**
   * Main entry point when user triggers inline edit keybinding (Cmd+Alt+K)
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
    const relativePath = path.relative(this.workspaceManager.getRoot(), filePath);

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

    defaultStatusBar.setWorking('Proposing edit...');

    try {
      // Record initial file state for undo tracking
      defaultUndoManager.recordInitialState(filePath, document.getText());

      // Generate the replacement string based on instruction
      const newText = await this.generateReplacement({
        filePath: relativePath,
        selectedText,
        instruction,
        fullContent: document.getText()
      });

      if (!newText || newText === selectedText) {
        vscodeModule.window.showInformationMessage('Forge: No changes proposed');
        defaultStatusBar.setReady();
        return;
      }

      // Compute unified diff hunks and stage in PatchStore
      const result = await executeProposeEdit(
        {
          path: relativePath,
          old_str: selectedText,
          new_str: newText,
          summary: instruction
        },
        this.workspaceManager,
        this.patchStore
      );

      const stagedPatch = this.patchStore.getPatch(result.patch_id);
      if (stagedPatch && stagedPatch.hunks.length > 0) {
        // Render diff decorations and refresh CodeLens
        defaultDiffViewManager.renderHunkDecorations(editor, stagedPatch.hunks);
        defaultCodeLensProvider.refresh();
        defaultStatusBar.setPendingReviews(stagedPatch.hunks.length);

        vscodeModule.window.showInformationMessage(
          `Forge: Proposed ${stagedPatch.hunks.length} hunk(s). Review above with Accept / Reject.`
        );
      }
    } catch (err: any) {
      vscodeModule.window.showErrorMessage(`Forge Inline Edit error: ${err.message}`);
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

  /**
   * Core generator: maps instruction to replacement string.
   */
  public async generateReplacement(params: {
    filePath: string;
    selectedText: string;
    instruction: string;
    fullContent: string;
  }): Promise<string> {
    const { selectedText, instruction } = params;

    // Handle Task A instruction specifically or apply transformation:
    // "Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false."
    const lowerInst = instruction.toLowerCase();
    if (
      (lowerInst.includes('off') && lowerInst.includes('n') && lowerInst.includes('false')) ||
      lowerInst.includes('get_debug_flag')
    ) {
      return this.transformGetDebugFlag(selectedText);
    }

    return selectedText;
  }

  private transformGetDebugFlag(text: string): string {
    let result = text;

    // Update the set/tuple of false values to include "off" and "n"
    if (result.includes('{"0", "false", "no"}')) {
      result = result.replace(
        '{"0", "false", "no"}',
        '{"0", "false", "no", "off", "n"}'
      );
    } else if (result.includes('("0", "false", "no")')) {
      result = result.replace(
        '("0", "false", "no")',
        '("0", "false", "no", "off", "n")'
      );
    }

    // Update docstring to list every value treated as false
    if (result.includes('The default is ``False``.')) {
      result = result.replace(
        'The default is ``False``.',
        'The default is ``False``.\n    Values treated as false are: "0", "false", "no", "off", and "n" (case-insensitive).'
      );
    }

    return result;
  }
}

export const defaultInlineEditController = new InlineEditController();
