import * as path from 'path';
import type * as vscodeTypes from 'vscode';
import { WorkspaceManager } from '../mcp/workspace';
import { PatchStore, defaultPatchStore } from '../review/store';
import { executeApplyPatchHunk } from '../mcp/tools/apply_patch_hunk';
import { defaultDiffViewManager } from '../review/diff-view';
import { defaultCodeLensProvider } from '../review/codelens';
import { defaultUndoManager } from '../review/undo';
import { defaultCancelManager } from '../review/cancel';
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

    this.trueforgeClient.onModelFallback?.((info) => {
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
    const relativeFilePath = path.relative(this.workspaceManager.getRoot(), filePath).replace(/\\/g, '/');

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
    defaultCancelManager.reset();

    // Mark the inline run in the panel. Tool and context events below come from the live stream.
    try {
      const { defaultAgentPanel } = await import('./panel.js');
      defaultAgentPanel.contextLedger.clear();
      defaultAgentPanel.syncContextLedger();
      defaultAgentPanel.postMessage({
        type: 'run_started',
        prompt: instruction
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
      const stream = await this.trueforgeClient.runTaskA({
        filePath: relativeFilePath,
        selectionRange,
        selectedText,
        instruction,
        fullContent: document.getText()
      });
      const { defaultAgentPanel } = await import('./panel.js');
      await defaultAgentPanel.consumeStream(stream);

      // Check PatchStore for the patch received via propose_edit over MCP
      const patchesAfter = this.patchStore.getAllPatches();
      const newPatch = patchesAfter.find(p => !patchesBefore.has(p.id));

      if (newPatch && newPatch.hunks.length > 0) {
        let activeEditor = editor;
        if (vscodeModule.window.activeTextEditor && vscodeModule.window.activeTextEditor.document.uri.fsPath === filePath) {
          activeEditor = vscodeModule.window.activeTextEditor;
        }

        defaultDiffViewManager.renderHunkDecorations(activeEditor, newPatch.hunks);
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
      const message = getUserFacingErrorMessage(err);
      vscodeModule.window.showErrorMessage(message);
      try {
        const { defaultAgentPanel } = await import('./panel.js');
        defaultAgentPanel.postMessage({ type: 'error', message });
        defaultAgentPanel.postMessage({ type: 'run_completed', status: 'failed' });
      } catch {
        // The panel may not be available in a non-standard extension host.
      }
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
