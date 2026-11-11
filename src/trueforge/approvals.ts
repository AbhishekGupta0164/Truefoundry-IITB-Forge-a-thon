/**
 * ApprovalMatcher
 *
 * Implements Stage 3 Section 8: Production Approval Matching and Resume Wiring.
 * Connects TrueForge tool approval events with ReviewManager patches and hunks,
 * validating hunk staleness, preventing duplicate decisions, and generating
 * compliant SDK resume turn payloads.
 */

import { ReviewHunk, ReviewPatch } from '../shared/types';
import { defaultReviewManager, ReviewManager } from '../review/manager';

export interface PendingToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface PendingApproval {
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  patchId?: string;
  hunkId?: string;
  associatedPatch?: ReviewPatch;
  associatedHunk?: ReviewHunk;
  createdAt: number;
}

export interface SdkToolApprovalEvent {
  type: 'user.tool_approval';
  toolCallId: string;
  approval: {
    status: 'allow' | 'deny';
    reason?: string;
  };
}

export interface ResumePayload {
  toolCallId: string;
  approved: boolean;
  decision?: any;
  userFeedback?: string;
}

export class ApprovalMatcher {
  private pendingApprovals = new Map<string, PendingApproval>();
  private resolvedApprovals = new Map<string, 'allow' | 'deny'>();

  constructor(private reviewManager: ReviewManager = defaultReviewManager) {}

  /**
   * Register a pending tool call requiring human approval.
   */
  public registerPending(toolCall: PendingToolCall): PendingApproval {
    // Prevent duplicate registrations
    if (this.pendingApprovals.has(toolCall.id)) {
      return this.pendingApprovals.get(toolCall.id)!;
    }

    const args = toolCall.arguments || {};
    const patchId = (args.patch_id || args.patchId) as string | undefined;
    const hunkId = (args.hunk_id || args.hunkId) as string | undefined;

    let associatedPatch: ReviewPatch | undefined;
    let associatedHunk: ReviewHunk | undefined;

    if (patchId && hunkId) {
      const match = this.reviewManager.getHunk(patchId, hunkId);
      if (match) {
        associatedPatch = match.patch;
        associatedHunk = match.hunk;
      }
    }

    const approval: PendingApproval = {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      arguments: args,
      patchId,
      hunkId,
      associatedPatch,
      associatedHunk,
      createdAt: Date.now()
    };

    this.pendingApprovals.set(toolCall.id, approval);
    return approval;
  }

  public getPending(toolCallId: string): PendingApproval | undefined {
    return this.pendingApprovals.get(toolCallId);
  }

  public getAllPending(): PendingApproval[] {
    return Array.from(this.pendingApprovals.values());
  }

  public removePending(toolCallId: string): boolean {
    return this.pendingApprovals.delete(toolCallId);
  }

  /**
   * Evaluate an approval decision against the ReviewManager state and
   * generate an exact SDK-supported UserToolApprovalInputEvent.
   */
  public evaluateDecision(
    toolCallId: string,
    decision: 'accept' | 'reject',
    userFeedback?: string
  ): { allowed: boolean; reason?: string; event: SdkToolApprovalEvent } {
    // Check if already resolved
    if (this.resolvedApprovals.has(toolCallId)) {
      const prior = this.resolvedApprovals.get(toolCallId)!;
      return {
        allowed: prior === 'allow',
        reason: 'Duplicate approval decision ignored',
        event: {
          type: 'user.tool_approval',
          toolCallId,
          approval: prior === 'allow' ? { status: 'allow' } : { status: 'deny', reason: 'Already resolved' }
        }
      };
    }

    const pending = this.pendingApprovals.get(toolCallId);
    if (!pending) {
      // Unknown tool call: deny immediately
      this.resolvedApprovals.set(toolCallId, 'deny');
      return {
        allowed: false,
        reason: `Unknown pending approval ID '${toolCallId}'`,
        event: {
          type: 'user.tool_approval',
          toolCallId,
          approval: { status: 'deny', reason: `Unknown pending tool call '${toolCallId}'` }
        }
      };
    }

    this.pendingApprovals.delete(toolCallId);

    // If decision is to reject
    if (decision === 'reject') {
      if (pending.patchId && pending.hunkId) {
        try {
          this.reviewManager.rejectHunk(pending.patchId, pending.hunkId);
        } catch {
          // ignore if already rejected
        }
      }
      this.resolvedApprovals.set(toolCallId, 'deny');
      const denyReason = userFeedback || 'Rejected by human reviewer';
      return {
        allowed: false,
        reason: denyReason,
        event: {
          type: 'user.tool_approval',
          toolCallId,
          approval: { status: 'deny', reason: denyReason }
        }
      };
    }

    // Decision is 'accept': validate invariants before allowing
    if (!pending.patchId || !pending.hunkId || !pending.associatedHunk) {
      this.resolvedApprovals.set(toolCallId, 'deny');
      const reason = 'Cannot approve unknown patch or hunk';
      return {
        allowed: false,
        reason,
        event: {
          type: 'user.tool_approval',
          toolCallId,
          approval: { status: 'deny', reason }
        }
      };
    }

    // Invariant: Never approve a rejected hunk
    if (pending.associatedHunk.status === 'rejected') {
      this.resolvedApprovals.set(toolCallId, 'deny');
      const reason = 'Cannot approve previously rejected hunk';
      return {
        allowed: false,
        reason,
        event: {
          type: 'user.tool_approval',
          toolCallId,
          approval: { status: 'deny', reason }
        }
      };
    }

    // Invariant: Never approve a stale hunk
    const staleCheck = this.reviewManager.checkStale(pending.patchId, pending.hunkId);
    if (staleCheck.stale) {
      pending.associatedHunk.status = 'stale';
      pending.associatedHunk.staleReason = staleCheck.reason;
      this.resolvedApprovals.set(toolCallId, 'deny');
      const reason = staleCheck.reason || 'Hunk denied: file changed after patch was proposed';
      return {
        allowed: false,
        reason,
        event: {
          type: 'user.tool_approval',
          toolCallId,
          approval: { status: 'deny', reason }
        }
      };
    }

    // Valid approval
    this.resolvedApprovals.set(toolCallId, 'allow');
    return {
      allowed: true,
      event: {
        type: 'user.tool_approval',
        toolCallId,
        approval: { status: 'allow' }
      }
    };
  }

  /**
   * Build an isolated turn stream request containing ONLY approval decisions (no user messages).
   */
  public buildResumeTurnRequest(events: SdkToolApprovalEvent[]): { input: SdkToolApprovalEvent[] } {
    return {
      input: events
    };
  }

  public clear(): void {
    this.pendingApprovals.clear();
    this.resolvedApprovals.clear();
  }
}

export const defaultApprovalMatcher = new ApprovalMatcher();
