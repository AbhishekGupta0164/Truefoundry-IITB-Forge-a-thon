import { PatchStore, defaultPatchStore } from './store';
import { defaultSessionStateManager } from '../trueforge/session-state';
import { SessionCancelledError } from '../shared/errors';
import { UndoManager, defaultUndoManager } from './undo';

export interface CancelResult {
  cancelledPatches: number;
  abandonedHunks: number;
  appliedHunks: number;
  message: string;
}

export function formatCancellationReport(result: CancelResult, elapsedMs: number): string {
  const fileOutcome = result.appliedHunks === 0
    ? 'No files changed by this run.'
    : `${result.appliedHunks} approved hunk(s) were already applied before cancellation.`;
  return `Stopped ${elapsedMs} ms after you pressed Stop. ${result.message}\n${fileOutcome}\n`;
}

export class CancelManager {
  private cancelledPatchIds = new Set<string>();
  private cancelCallbacks: (() => Promise<void> | void)[] = [];
  private cancellationHooks: Promise<void>[] = [];
  private abortController: AbortController = new AbortController();
  private isCancelledFlag = false;

  constructor(
    private patchStore: PatchStore = defaultPatchStore,
    private undoManager: UndoManager = defaultUndoManager
  ) {}

  public getAbortController(): AbortController {
    return this.abortController;
  }

  /**
   * Register a cancellation callback (e.g. to call sessions.cancel())
   */
  public onCancel(callback: () => Promise<void> | void): void {
    this.cancelCallbacks.push(callback);
  }

  /**
   * Checks if a patch ID belongs to a cancelled session/run.
   */
  public isCancelled(patchId?: string): boolean {
    if (this.isCancelledFlag || defaultSessionStateManager.isCancelled()) {
      return true;
    }
    if (patchId && this.cancelledPatchIds.has(patchId)) {
      return true;
    }
    return false;
  }

  /**
   * Refuse any future application of a patch ID.
   */
  public assertNotCancelled(patchId?: string): void {
    if (this.isCancelled(patchId)) {
      throw new SessionCancelledError(
        `Cannot apply hunk: session/patch ${patchId ?? ''} has been cancelled.`
      );
    }
  }

  /**
   * Discards all unapplied/unapproved staged patches and reports stats.
   * Tells the user if an approved hunk was already applied.
   */
  public cancelAll(_sessionId?: string): CancelResult {
    this.isCancelledFlag = true;
    this.abortController.abort();
    this.abortController = new AbortController();
    defaultSessionStateManager.markCancelled();

    // Trigger registered cancellation hooks (e.g. TrueForge SDK sessions.cancel)
    this.cancellationHooks = [];
    for (const cb of this.cancelCallbacks) {
      try {
        const res = cb();
        if (res && typeof (res as any).then === 'function') {
          this.cancellationHooks.push(Promise.resolve(res).catch(() => {}));
        }
      } catch {
        // Safe fire-and-forget
      }
    }

    let abandonedHunks = 0;
    let appliedHunks = 0;
    const patches = this.patchStore.getAllPatches();

    for (const patch of patches) {
      this.cancelledPatchIds.add(patch.id);
      for (const hunk of patch.hunks) {
        if (hunk.applied) {
          appliedHunks++;
        } else {
          abandonedHunks++;
        }
      }
    }

    if (appliedHunks === 0) {
      appliedHunks = this.undoManager.getInverseEdits().length;
    }

    const cancelledPatches = patches.length;
    this.patchStore.clear();

    let message: string;
    if (appliedHunks > 0) {
      message = `Run cancelled: ${cancelledPatches} patch(es) discarded (${abandonedHunks} unapproved hunks). Note: ${appliedHunks} previously approved hunk(s) were already applied.`;
    } else {
      message = `Run cancelled: ${cancelledPatches} patch(es) discarded (${abandonedHunks} unapproved hunks). No hunks from this run had been applied.`;
    }

    return {
      cancelledPatches,
      abandonedHunks,
      appliedHunks,
      message
    };
  }

  /** Wait for registered SDK/session cancellation requests to settle. */
  public async waitForCancellation(): Promise<void> {
    await Promise.all(this.cancellationHooks);
    this.cancellationHooks = [];
  }

  public reset(): void {
    this.isCancelledFlag = false;
    this.cancelledPatchIds.clear();
    this.cancellationHooks = [];
    this.abortController = new AbortController();
  }
}

export const defaultCancelManager = new CancelManager();
