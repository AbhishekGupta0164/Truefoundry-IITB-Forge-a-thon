/**
 * LoopGuard — prevents infinite agent execution loops.
 *
 * Rules:
 * 1. Stops turn/execution after exceeding 20 total tool calls.
 * 2. Stops execution if the exact same tool call (name and arguments) repeats 3 times consecutively.
 */

import { LoopGuardError } from '../shared/errors';

export interface ToolCallSignature {
  name: string;
  arguments: Record<string, unknown> | string;
}

export class LoopGuard {
  public static readonly MAX_TOOL_CALLS = 20;
  public static readonly MAX_CONSECUTIVE_REPEATS = 3;

  private totalToolCalls = 0;
  private lastCallKey = '';
  private repeatCount = 0;

  constructor(
    private readonly maxCalls = LoopGuard.MAX_TOOL_CALLS,
    private readonly maxRepeats = LoopGuard.MAX_CONSECUTIVE_REPEATS
  ) {}

  /**
   * Records a tool call and verifies loop guard constraints.
   * Throws `LoopGuardError` if constraints are violated.
   */
  public recordAndCheck(call: ToolCallSignature): void {
    this.totalToolCalls++;

    if (this.totalToolCalls > this.maxCalls) {
      throw new LoopGuardError('max_calls', call.name);
    }

    const key = `${call.name}:${this.serializeArgs(call.arguments)}`;
    if (key === this.lastCallKey) {
      this.repeatCount++;
      if (this.repeatCount >= this.maxRepeats) {
        throw new LoopGuardError('repeated_call', call.name);
      }
    } else {
      this.lastCallKey = key;
      this.repeatCount = 1;
    }
  }

  public getTotalCalls(): number {
    return this.totalToolCalls;
  }

  public reset(): void {
    this.totalToolCalls = 0;
    this.lastCallKey = '';
    this.repeatCount = 0;
  }

  private serializeArgs(args: Record<string, unknown> | string): string {
    if (typeof args === 'string') {
      return args;
    }
    try {
      return JSON.stringify(args, Object.keys(args || {}).sort());
    } catch {
      return String(args);
    }
  }
}
