import type * as vscodeTypes from 'vscode';
import { StagedHunk } from './store';

let vscodeModule: typeof vscodeTypes | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  vscodeModule = require('vscode');
} catch {
  // Running outside VS Code
}

export class DiffViewManager {
  private addedDecorationType?: vscodeTypes.TextEditorDecorationType;
  private removedDecorationType?: vscodeTypes.TextEditorDecorationType;

  constructor() {
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

  /**
   * Render inline diff decorations for hunks on an editor.
   */
  public renderHunkDecorations(
    editor: vscodeTypes.TextEditor,
    hunks: StagedHunk[]
  ): void {
    if (!this.addedDecorationType || !this.removedDecorationType || !vscodeModule) {
      return;
    }

    const addedRanges: vscodeTypes.Range[] = [];
    const removedRanges: vscodeTypes.Range[] = [];

    for (const hunk of hunks) {
      if (hunk.applied) continue;

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

  /**
   * Clear decorations on the editor.
   */
  public clearDecorations(editor?: vscodeTypes.TextEditor): void {
    if (!vscodeModule || !editor) return;
    if (this.addedDecorationType) {
      editor.setDecorations(this.addedDecorationType, []);
    }
    if (this.removedDecorationType) {
      editor.setDecorations(this.removedDecorationType, []);
    }
  }

  public dispose(): void {
    this.addedDecorationType?.dispose();
    this.removedDecorationType?.dispose();
  }
}

export const defaultDiffViewManager = new DiffViewManager();
