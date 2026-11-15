/**
 * HunkCodeLensProvider
 *
 * Implements Stage 3 CodeLens controls providing per-hunk Accept and Reject actions,
 * displaying hunk ID, target file, and current review status.
 */

import type * as vscodeTypes from 'vscode';
import { defaultReviewManager, ReviewManager } from './manager';
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

  constructor(
    private reviewManager: ReviewManager = defaultReviewManager,
    private patchStore: PatchStore = defaultPatchStore
  ) {
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
    const patches = [
      ...this.reviewManager.getAllPatches(),
      ...this.patchStore.getAllPatches().filter(p => !this.reviewManager.getPatch(p.id))
    ];
    const docPath = document.uri.fsPath.replace(/\\/g, '/');

    for (const patch of patches) {
      const normalizedTarget = patch.targetFile.replace(/\\/g, '/');
      if (!docPath.endsWith(normalizedTarget) && !normalizedTarget.endsWith(docPath)) {
        continue;
      }

      for (const hunk of patch.hunks) {
        const line = Math.max(0, hunk.oldStart - 1);
        const range = new vscodeModule.Range(
          new vscodeModule.Position(line, 0),
          new vscodeModule.Position(line, 0)
        );

        const status = (hunk as any).status || (hunk.applied ? 'applied' : 'pending');

        if (status === 'applied') {
          lenses.push(
            new vscodeModule.CodeLens(range, {
              title: `$(check) Hunk ${hunk.id} [Applied]`,
              tooltip: `Hunk was applied to ${patch.targetFile}`,
              command: ''
            })
          );
          continue;
        }

        if (status === 'rejected') {
          lenses.push(
            new vscodeModule.CodeLens(range, {
              title: `$(x) Hunk ${hunk.id} [Rejected]`,
              tooltip: `Hunk was rejected`,
              command: ''
            })
          );
          continue;
        }

        if (status === 'stale') {
          lenses.push(
            new vscodeModule.CodeLens(range, {
              title: `$(warning) Hunk ${hunk.id} [Stale - File Changed]`,
              tooltip: (hunk as any).staleReason || 'Hunk cannot be applied: file changed since proposal',
              command: ''
            })
          );
          continue;
        }

        // Pending hunks get individual Accept and Reject actions
        // 1. Status Lens
        const statusLens = new vscodeModule.CodeLens(range, {
          title: `Hunk: ${hunk.id} [Pending Review]`,
          tooltip: `Hunk ${hunk.id} in ${patch.targetFile}`,
          command: ''
        });

        // 2. Accept Action
        const acceptLens = new vscodeModule.CodeLens(range, {
          title: `$(check) Accept Hunk`,
          tooltip: `Apply only hunk ${hunk.id} to ${patch.targetFile}`,
          command: 'forge.acceptHunk',
          arguments: [patch.id, hunk.id]
        });

        // 3. Reject Action
        const rejectLens = new vscodeModule.CodeLens(range, {
          title: `$(x) Reject Hunk`,
          tooltip: `Reject hunk ${hunk.id} without modifying files`,
          command: 'forge.rejectHunk',
          arguments: [patch.id, hunk.id]
        });

        lenses.push(statusLens, acceptLens, rejectLens);
      }
    }

    return lenses;
  }
}

export const defaultCodeLensProvider = new HunkCodeLensProvider();
