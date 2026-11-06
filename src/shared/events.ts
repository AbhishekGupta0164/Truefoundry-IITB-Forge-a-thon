/**
 * Event contracts and payload structures for TrueForge streaming and lifecycle
 */

import { BudgetState, HunkDecision, ToolResult } from './types';

export type EventType =
  | 'token'
  | 'tool_call'
  | 'tool_result'
  | 'approval'
  | 'error'
  | 'done';

export interface TokenEvent {
  type: 'token';
  text: string;
  timestamp: number;
}

export interface ToolCallEvent {
  type: 'tool_call';
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown>;
  timestamp: number;
}

export interface ToolResultEvent {
  type: 'tool_result';
  result: ToolResult;
  timestamp: number;
}

export interface ApprovalEvent {
  type: 'approval';
  requestId: string;
  action: string;
  decision?: HunkDecision;
  requiresManualReview: boolean;
  timestamp: number;
}

export interface ErrorEvent {
  type: 'error';
  code: string;
  message: string;
  details?: Record<string, unknown>;
  timestamp: number;
}

export interface DoneEvent {
  type: 'done';
  status: 'completed' | 'cancelled' | 'failed';
  budget: BudgetState;
  timestamp: number;
}

export type ForgeEvent =
  | TokenEvent
  | ToolCallEvent
  | ToolResultEvent
  | ApprovalEvent
  | ErrorEvent
  | DoneEvent;
