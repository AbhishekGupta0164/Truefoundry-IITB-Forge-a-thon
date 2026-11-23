/**
 * Webview <-> Extension Host messaging contracts
 */

import { BudgetState, ContextEntry, HunkDecision, ToolResult } from '../shared/types';

export interface WebviewContextGroupItem {
  path: string;
  lineRange?: string;
  reason: string;
}

export interface WebviewBudgetMeter {
  tokens: number;
  maxTokens: number;
  files: number;
  maxFiles: number;
  hits: number;
  maxHits: number;
  maxLinesPerRead: number;
}

export type WebviewIncomingMessage =
  | { type: 'submit_prompt'; prompt: string; mentions?: string[] }
  | { type: 'approve_tool'; requestId: string; decision: HunkDecision }
  | { type: 'cancel_run'; requestedAt?: number }
  | { type: 'undo_task' }
  | { type: 'open_session' }
  | { type: 'request_state' };

export type WebviewOutgoingMessage =
  | { type: 'token'; text: string }
  | { type: 'tool_call'; toolCallId: string; name: string; arguments: Record<string, unknown> }
  | { type: 'tool_result'; result: ToolResult }
  | {
      type: 'context_update';
      entries: ContextEntry[];
      groups?: {
        read: WebviewContextGroupItem[];
        searched: WebviewContextGroupItem[];
        skipped: WebviewContextGroupItem[];
      };
      budgetMeter?: WebviewBudgetMeter;
    }
  | { type: 'budget_update'; budget: BudgetState }
  | { type: 'approval_required'; requestId: string; toolName: string; args: Record<string, unknown> }
  | { type: 'run_started'; prompt?: string }
  | { type: 'run_completed'; status: 'completed' | 'cancelled' | 'failed' }
  | { type: 'error'; message: string }
  | { type: 'model_fallback'; from: string; to: string; reason?: string }
  | { type: 'model_config'; primary: string; fallback: string; baseUrl: string };
