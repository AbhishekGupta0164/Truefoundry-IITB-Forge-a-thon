/**
 * DiffViewManager
 *
 * Implements Stage 3 Section 5: Native VS Code Diff Interface.
 * Opens native vscode.diff showing original vs proposed content,
 * supporting TextDocumentContentProvider and hunk decorations.
 */

import * as fs from 'fs';
import * as path from 'path';
import type * as vscodeTypes from 'vscode';
import { ReviewPatch, ReviewHunk } from '../shared/types';
import { PatchStore, defaultPatchStore } from './store';
import { defaultReviewManager, ReviewManager } from './manager';

let vscodeModule: typeof vscodeTypes | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  vscodeModule = require('vscode');
} catch {
  // Running outside VS Code
}

export const ORIGINAL_SCHEME = 'forge-original';
export const PROPOSED_SCHEME = 'forge-proposed';

/**
 * TextDocumentContentProvider serving virtual document content for diff comparisons.
 */
export class ForgeDiffContentProvider implements vscodeTypes.TextDocumentContentProvider {
  private _onDidChange?: vscodeTypes.EventEmitter<vscodeTypes.Uri>;
  public onDidChange?: vscodeTypes.Event<vscodeTypes.Uri>;

  constructor(
    private patchStore: PatchStore = defaultPatchStore,
    private reviewManager: ReviewManager = defaultReviewManager
  ) {
    if (vscodeModule?.EventEmitter) {
      this._onDidChange = new vscodeModule.EventEmitter<vscodeTypes.Uri>();
      this.onDidChange = this._onDidChange.event;
    }
  }

  public fireChange(uri: vscodeTypes.Uri): void {
    this._onDidChange?.fire(uri);
  }

  public provideTextDocumentContent(uri: vscodeTypes.Uri): string {
    const query = new URLSearchParams(uri.query || '');
    const patchId = query.get('patchId');

    const patch = patchId ? (this.reviewManager.getPatch(patchId) || this.patchStore.getPatch(patchId)) : undefined;

    if (uri.scheme === ORIGINAL_SCHEME) {
      if (patch?.initialContent !== undefined) {
        return patch.initialContent;
      }
      // If target file exists on disk, read it
      const filePath = uri.fsPath || uri.path;
      if (filePath && fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf-8');
      }
      return '';
    }

    if (uri.scheme === PROPOSED_SCHEME) {
      if (!patch) return '';
      const baseContent = patch.initialContent !== undefined
        ? patch.initialContent
        : (fs.existsSync(patch.targetFile) ? fs.readFileSync(patch.targetFile, 'utf-8') : '');

      // Compute full proposed content with all hunks applied in memory
      let content = baseContent;
      const { applyHunkToContent } = require('./apply');
      for (const hunk of patch.hunks) {
        try {
          content = applyHunkToContent(content, hunk);
        } catch {
          // ignore hunk conflict in preview
        }
      }
      return content;
    }

    return '';
  }
}

export class DiffViewManager {
  private addedDecorationType?: vscodeTypes.TextEditorDecorationType;
  private removedDecorationType?: vscodeTypes.TextEditorDecorationType;
  private contentProvider: ForgeDiffContentProvider;

  constructor(
    patchStore: PatchStore = defaultPatchStore,
    reviewManager: ReviewManager = defaultReviewManager
  ) {
    this.contentProvider = new ForgeDiffContentProvider(patchStore, reviewManager);

    if (vscodeModule?.window?.createTextEditorDecorationType) {
      this.addedDecorationType = vscodeModule.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(46, 160, 67, 0.2)',
        isWholeLine: true,
        overviewRulerColor: 'rgba(46, 160, 67, 0.8)',
        overviewRulerLane: vscodeModule.OverviewRulerLane.Right
      });

      this.removedDecorationType = vscodeModule.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(248, 81, 73, 0.2)',
        isWholeLine: true,
        overviewRulerColor: 'rgba(248, 81, 73, 0.8)',
        overviewRulerLane: vscodeModule.OverviewRulerLane.Right
      });
    }
  }

  public getContentProvider(): ForgeDiffContentProvider {
    return this.contentProvider;
  }

  /**
   * Open the native VS Code diff editor immediately for a proposed patch.
   */
  public async openDiffEditor(patch: ReviewPatch): Promise<void> {
    if (!vscodeModule?.commands?.executeCommand) {
      return;
    }

    const fileName = path.basename(patch.targetFile);
    const originalUri = vscodeModule.Uri.parse(
      `${ORIGINAL_SCHEME}:${patch.targetFile}?patchId=${encodeURIComponent(patch.id)}`
    );
    const proposedUri = vscodeModule.Uri.parse(
      `${PROPOSED_SCHEME}:${patch.targetFile}?patchId=${encodeURIComponent(patch.id)}`
    );

    const title = `${fileName} (Original ↔ Proposed Review: ${patch.id.slice(0, 8)})`;

    await vscodeModule.commands.executeCommand(
      'vscode.diff',
      originalUri,
      proposedUri,
      title
    );
  }

  /**
   * Render inline diff decorations for hunks on an editor.
   */
  public renderHunkDecorations(
    editor: vscodeTypes.TextEditor,
    hunks: ReviewHunk[]
  ): void {
    if (!this.addedDecorationType || !this.removedDecorationType || !vscodeModule) {
      return;
    }

    const addedRanges: vscodeTypes.Range[] = [];
    const removedRanges: vscodeTypes.Range[] = [];

    for (const hunk of hunks) {
      if (hunk.applied || hunk.status === 'applied') continue;

      let currentLine = Math.max(0, hunk.oldStart - 1);
      const lines = hunk.content.split('\n');

      for (const line of lines) {
        if (line.startsWith('+')) {
          addedRanges.push(new vscodeModule.Range(currentLine, 0, currentLine, line.length));
          currentLine++;
        } else if (line.startsWith('-')) {
          removedRanges.push(new vscodeModule.Range(currentLine, 0, currentLine, line.length));
        } else {
          currentLine++;
        }
      }
    }

    editor.setDecorations(this.addedDecorationType, addedRanges);
    editor.setDecorations(this.removedDecorationType, removedRanges);
  }

  public clearDecorations(editor?: vscodeTypes.TextEditor): void {
    if (!vscodeModule || !editor) return;
    if (this.addedDecorationType) {
      editor.setDecorations(this.addedDecorationType, []);
    }
    if (this.removedDecorationType) {
      editor.setDecorations(this.removedDecorationType, []);
    }
  }

  /** Close only Forge's virtual review diff tabs when a run is cancelled. */
  public async closeReviewEditors(): Promise<void> {
    const tabGroups = vscodeModule?.window?.tabGroups;
    if (!tabGroups) return;

    const reviewTabs = tabGroups.all.flatMap((group) => group.tabs.filter((tab) => {
      const input = tab.input as vscodeTypes.TabInputTextDiff;
      return input?.original?.scheme === ORIGINAL_SCHEME || input?.modified?.scheme === PROPOSED_SCHEME;
    }));

    if (reviewTabs.length > 0) await tabGroups.close(reviewTabs, true);
  }

  public dispose(): void {
    this.addedDecorationType?.dispose();
    this.removedDecorationType?.dispose();
  }
}

export const defaultDiffViewManager = new DiffViewManager();
