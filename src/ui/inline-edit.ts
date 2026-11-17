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
          vscodeModule.window.showErrorMessage(getUserFacingErrorMessage(event.message));
          defaultStatusBar.setReady();
          return;
        }
      }

      // Check PatchStore for the patch received via propose_edit over MCP
      const patchesAfter = this.patchStore.getAllPatches();
      const newPatch =
        patchesAfter.find(p => !patchesBefore.has(p.id)) ||
        patchesAfter[patchesAfter.length - 1];

      if (newPatch && newPatch.hunks.length > 0) {
        defaultDiffViewManager.renderHunkDecorations(editor, newPatch.hunks);
        defaultCodeLensProvider.refresh();
        defaultStatusBar.setPendingReviews(newPatch.hunks.length);

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
