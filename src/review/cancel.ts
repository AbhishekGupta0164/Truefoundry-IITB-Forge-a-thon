import { PatchStore, defaultPatchStore } from './store';

export interface CancelResult {
  cancelledPatches: number;
  abandonedHunks: number;
  appliedHunks: number;
}

export class CancelManager {
  constructor(private patchStore: PatchStore = defaultPatchStore) {}

  /**
   * Discards all unapplied/unapproved staged patches and reports stats.
   */
  public cancelAll(): CancelResult {
    let abandonedHunks = 0;
    let appliedHunks = 0;
    const patches = this.patchStore.getAllPatches();

    for (const patch of patches) {
      for (const hunk of patch.hunks) {
        if (hunk.applied) {
          appliedHunks++;
        } else {
          abandonedHunks++;
        }
      }
    }

    const cancelledPatches = patches.length;
    this.patchStore.clear();

    return {
      cancelledPatches,
      abandonedHunks,
      appliedHunks
    };
  }
}

export const defaultCancelManager = new CancelManager();
