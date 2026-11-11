import type * as vscodeTypes from 'vscode';
import { PatchStore, defaultPatchStore } from './store';

let vscodeModule: typeof vscodeTypes | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  vscodeModule = require('vscode');
} catch {
  // Running outside VS Code
}

export class HunkCodeLensProvider {
  private _onDidChangeCodeLenses?: vscodeTypes.EventEmitter<void>;
  public onDidChangeCodeLenses?: vscodeTypes.Event<void>;

  constructor(private patchStore: PatchStore = defaultPatchStore) {
    if (vscodeModule?.EventEmitter) {
      this._onDidChangeCodeLenses = new vscodeModule.EventEmitter<void>();
      this.onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;
    }
  }

  public refresh(): void {
    this._onDidChangeCodeLenses?.fire();
  }

  public provideCodeLenses(document: vscodeTypes.TextDocument): vscodeTypes.CodeLens[] {
    if (!vscodeModule) {
      return [];
    }

    const lenses: vscodeTypes.CodeLens[] = [];
    const patches = this.patchStore.getAllPatches();
    const docPath = document.uri.fsPath.replace(/\\/g, '/');

    for (const patch of patches) {
      // Check if patch target matches document
      const normalizedTarget = patch.targetFile.replace(/\\/g, '/');
      if (!docPath.endsWith(normalizedTarget) && !normalizedTarget.endsWith(docPath)) {
        continue;
      }

      for (const hunk of patch.hunks) {
        if (hunk.applied) {
          continue;
        }

        const line = Math.max(0, hunk.oldStart - 1);
        const range = new vscodeModule.Range(
          new vscodeModule.Position(line, 0),
          new vscodeModule.Position(line, 0)
        );

        // 1. Accept CodeLens
        const acceptLens = new vscodeModule.CodeLens(range, {
          title: `$(check) Accept Hunk (${hunk.id.slice(0, 8)})`,
          tooltip: 'Apply this diff hunk to the file',
          command: 'forge.acceptHunk',
          arguments: [patch.id, hunk.id]
        });

        // 2. Reject CodeLens
        const rejectLens = new vscodeModule.CodeLens(range, {
          title: `$(x) Reject Hunk`,
          tooltip: 'Discard this diff hunk',
          command: 'forge.rejectHunk',
          arguments: [patch.id, hunk.id]
        });

        lenses.push(acceptLens, rejectLens);
      }
    }

    return lenses;
  }
}

export const defaultCodeLensProvider = new HunkCodeLensProvider();
