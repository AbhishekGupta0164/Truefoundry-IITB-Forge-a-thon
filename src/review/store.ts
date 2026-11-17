import { Hunk, Patch } from '../shared/types';

export interface StagedHunk extends Hunk {
  applied?: boolean;
  approved?: boolean;
  dependsOn?: string[];
  riskScore?: 'low' | 'medium' | 'high';
  badge?: string;
  defaultRejected?: boolean;
}

export interface StagedPatch extends Patch {
  hunks: StagedHunk[];
  initialContent?: string;
  targetVersion?: number;
}

export class PatchStore {
  private patches = new Map<string, StagedPatch>();

  public stagePatch(patch: StagedPatch): void {
    this.patches.set(patch.id, patch);
  }

  public getPatch(patchId: string): StagedPatch | undefined {
    return this.patches.get(patchId);
  }

  public getHunk(patchId: string, hunkId: string): { patch: StagedPatch; hunk: StagedHunk } | undefined {
    const patch = this.patches.get(patchId);
    if (!patch) {
      return undefined;
    }
    const hunk = patch.hunks.find(h => h.id === hunkId);
    if (!hunk) {
      return undefined;
    }
    return { patch, hunk };
  }

  public getAllPatches(): StagedPatch[] {
    return Array.from(this.patches.values());
  }

  public clear(): void {
    this.patches.clear();
  }
}

export const defaultPatchStore = new PatchStore();
