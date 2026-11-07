import { Hunk, HunkDecision } from '../shared/types';

export interface PendingApproval {
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown>;
  associatedHunk?: Hunk;
  createdAt: number;
}

export interface ResumePayload {
  toolCallId: string;
  approved: boolean;
  decision?: HunkDecision;
  userFeedback?: string;
}

export class ApprovalMatcher {
  private pendingApprovals = new Map<string, PendingApproval>();

  public registerPending(approval: PendingApproval): void {
    this.pendingApprovals.set(approval.toolCallId, approval);
  }

  public getPending(toolCallId: string): PendingApproval | undefined {
    return this.pendingApprovals.get(toolCallId);
  }

  public removePending(toolCallId: string): boolean {
    return this.pendingApprovals.delete(toolCallId);
  }

  public buildResumePayload(
    toolCallId: string,
    decision: HunkDecision,
    userFeedback?: string
  ): ResumePayload {
    const isApproved = decision.decision === 'accept';
    this.removePending(toolCallId);
    return {
      toolCallId,
      approved: isApproved,
      decision,
      userFeedback
    };
  }

  public clear(): void {
    this.pendingApprovals.clear();
  }
}
