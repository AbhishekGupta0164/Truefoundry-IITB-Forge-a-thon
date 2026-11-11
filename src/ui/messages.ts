/**
 * Webview <-> Extension Host messaging contracts
 */

import { BudgetState, ContextEntry, HunkDecision, ToolResult } from '../shared/types';

export type WebviewIncomingMessage =
  | { type: 'submit_prompt'; prompt: string; mentions?: string[] }
  | { type: 'approve_tool'; requestId: string; decision: HunkDecision }
  | { type: 'cancel_run' }
  | { type: 'undo_task' }
  | { type: 'request_state' };

export type WebviewOutgoingMessage =
  | { type: 'token'; text: string }
  | { type: 'tool_call'; toolCallId: string; name: string; arguments: Record<string, unknown> }
  | { type: 'tool_result'; result: ToolResult }
  | { type: 'context_update'; entries: ContextEntry[] }
  | { type: 'budget_update'; budget: BudgetState }
  | { type: 'approval_required'; requestId: string; toolName: string; args: Record<string, unknown> }
  | { type: 'run_completed'; status: 'completed' | 'cancelled' | 'failed' }
  | { type: 'error'; message: string };
