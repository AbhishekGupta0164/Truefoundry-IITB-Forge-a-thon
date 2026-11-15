import { Hunk, HunkDecision, Patch } from '../shared/types';

export interface StoredPatch extends Patch {
  versionAtProposal?: number;
  inverseHunks?: Hunk[];
  status: 'pending' | 'partially_accepted' | 'accepted' | 'rejected' | 'cancelled';
}

export class PatchStore {
  private patches = new Map<string, StoredPatch>();
  private hunkDecisions = new Map<string, HunkDecision>();

  public stagePatch(patch: Patch, versionAtProposal?: number): StoredPatch {
    const stored: StoredPatch = {
      ...patch,
      versionAtProposal,
      status: 'pending'
    };
    this.patches.set(patch.id, stored);
    return stored;
  }

  public getPatch(patchId: string): StoredPatch | undefined {
    return this.patches.get(patchId);
  }

  public getAllPatches(): StoredPatch[] {
    return Array.from(this.patches.values());
  }

  public findHunk(hunkId: string): { patch: StoredPatch; hunk: Hunk } | undefined {
    for (const patch of this.patches.values()) {
      const hunk = patch.hunks.find(h => h.id === hunkId);
      if (hunk) {
        return { patch, hunk };
      }
    }
    return undefined;
  }

  public recordDecision(decision: HunkDecision): void {
    this.hunkDecisions.set(decision.hunkId, decision);
  }

  public getDecision(hunkId: string): HunkDecision | undefined {
    return this.hunkDecisions.get(hunkId);
  }

  public clear(): void {
    this.patches.clear();
    this.hunkDecisions.clear();
  }
}

export const globalPatchStore = new PatchStore();
