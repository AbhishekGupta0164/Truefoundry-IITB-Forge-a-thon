/**
 * Core type definitions for TrueForge / Forge-Agent
 */

export interface Hunk {
  id: string;
  file: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  content: string; // The diff content with + / -
}

export type HunkDecisionType = 'accept' | 'reject' | 'modify';

export interface HunkDecision {
  hunkId: string;
  decision: HunkDecisionType;
  customContent?: string;
  timestamp: number;
  reviewer?: string;
}

export interface Patch {
  id: string;
  targetFile: string;
  hunks: Hunk[];
  summary: string;
  createdAt: number;
}

export interface ContextEntry {
  id: string;
  type: 'file' | 'symbol' | 'snippet' | 'rule' | 'diff';
  uri: string;
  content: string;
  score?: number;
  tokenCount?: number;
  metadata?: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  success: boolean;
  output?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface BudgetState {
  maxTokens: number;
  usedTokens: number;
  maxCostUsd: number;
  usedCostUsd: number;
  maxIterations: number;
  currentIteration: number;
}
