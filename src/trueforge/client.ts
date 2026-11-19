/**
 * TrueForge SDK client wrapper — Member M1
 *
 * Uses @truefoundry/trueforge-sdk (sessions.create, createTurnStream, cancel)
 * to route Task A (inline edit) and Task B (agent panel) through genuine model execution.
 * Enforces LoopGuard, retry policies, cancellation, reconnection, and error classification.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TrueForgeInstance = any;
import { ForgeEvent } from '../shared/events';
import { TOTAL_RUN_SAFETY_CAP } from '../shared/constants';
import { getTrueForgeConfig, TrueForgeConfig } from './config';
import { withRetry } from './retry';
import { ApprovalMatcher, SdkToolApprovalEvent } from './approvals';
import { LoopGuard } from './loop-guard';
import { SessionStateManager, defaultSessionStateManager } from './session-state';
import { StreamReconnector } from './reconnect';
import { SessionCancelledError, LoopGuardError } from '../shared/errors';

export interface InlineEditTaskParams {
  filePath: string;
  selectionRange: {
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
  };
  selectedText: string;
  instruction: string;
  fullContent?: string;
}

/** One `user.tool_approval` turn input item (SDK UserToolApprovalInputEvent). */
export type ApprovalInput = SdkToolApprovalEvent & { threadId: string };

export interface ToolCallInfo {
  name: string;
  arguments: Record<string, unknown>;
  threadId: string;
}

/** Subset of the SDK ToolCall shape carried on `model.message.toolCalls`. */
interface SdkToolCall {
  id: string;
  function?: { name?: string; arguments?: string };
  toolInfo?: { type?: string; name?: string };
}

/** Prefer the raw MCP tool name over the provider-facing function name. */
export function resolveToolName(call: SdkToolCall): string {
  if (call.toolInfo?.type === 'mcp' && call.toolInfo.name) {
    return call.toolInfo.name;
  }
  return call.function?.name ?? '';
}

/** Tool arguments arrive as a JSON string; malformed JSON is surfaced, not hidden. */
export function parseToolArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : { value: parsed };
  } catch {
    return { _unparsedArguments: raw };
  }
}

export class TrueForgeClient {
  private config: TrueForgeConfig;
  private sdk: TrueForgeInstance = null;
  public readonly approvals = new ApprovalMatcher();
  public readonly loopGuard = new LoopGuard();
  public readonly sessionManager: SessionStateManager;
  public readonly reconnector: StreamReconnector;
  private abortController: AbortController | null = null;
  private toolCalls = new Map<string, ToolCallInfo>();
  private awaitingApproval = new Map<string, ApprovalInput | null>();

  constructor(
    configOverride?: Partial<TrueForgeConfig>,
    sessionManager: SessionStateManager = defaultSessionStateManager
  ) {
    this.config = { ...getTrueForgeConfig(), ...configOverride };
    this.sessionManager = sessionManager;
    this.reconnector = new StreamReconnector(this.sessionManager, async (sessionId, _lastSeq, turnId) => {
      const sdk = await this.getSdk();
      if (turnId && typeof sdk.sessions?.subscribeToTurn === 'function') {
        const stream = await sdk.sessions.subscribeToTurn(sessionId, turnId);
        return this._adaptStream(stream);
      }
      throw new Error(`Cannot resume turn stream for session ${sessionId}`);
    });
  }

  public getConfig(): TrueForgeConfig {
    return { ...this.config };
  }

  public async getSdk(): Promise<TrueForgeInstance> {
    if (!this.sdk) {
      const { TrueForge: TrueForgeClass } = await import('@truefoundry/trueforge-sdk');
      this.sdk = new TrueForgeClass({
        baseUrl: this.config.baseUrl,
        timeoutInSeconds: Math.ceil(this.config.timeoutMs / 1000)
      });
    }
    return this.sdk;
  }

  /**
   * Create a new agent session on TrueForge.
   * Injects instructions and attaches the MCP server with approval requirements.
   * By default passes preload: false for deferred tool loading (T4 / B4 anchor).
   */
  public async createSession(
    model?: string,
    instructionsOverride?: string,
    options: { preload?: boolean; compaction?: boolean } = {}
  ): Promise<string> {
    const targetModel = model ?? this.config.model;
    const preload = options.preload ?? false;

    const instructions = instructionsOverride ?? [
      'You are Forge Agent — an autonomous coding assistant embedded in VS Code.',
      'Be brief. No explanation before tool calls. Always pass a reason when searching or reading.',
      'Search before reading. Read the implementation, tests and docs before proposing an edit.',
      'Never invent a path.',
      'Never write except by calling apply_patch_hunk once per hunk.',
      'A new command must update the implementation, a test, and the docs.',
      'A behavior change must update the docstring.',
      'Do not use the terminal to edit files. Always give a short reason for each search and read.',
      'Never read .env or secret files. Respect the retrieved-context budget.'
    ].join('\n');

    const tryCreate = async (modelName: string): Promise<string> => {
      const sdk = await this.getSdk();
      const mcpServerSpec: Record<string, any> = {
        name: 'forge-workspace',
        preload,
        requireApprovalForTools: ['apply_patch_hunk', 'run_terminal_command']
      };

      const agentSpec: Record<string, any> = {
        model: {
          name: modelName,
          params: {
            temperature: this.config.temperature
          }
        },
        instructions,
        mcpServers: [mcpServerSpec]
      };

      if (options.compaction) {
        agentSpec.config = {
          contextManagement: {
            compaction: {}
          }
        };
      }

      const { data: session } = await sdk.sessions.create({
        agent: {
          spec: agentSpec
        }
      });

      console.log(`[forge] session created id=${session.id} model=${modelName} preload=${preload}`);
      this.sessionManager.setSession(session.id);
      this.loopGuard.reset();
      this.toolCalls.clear();
      this.awaitingApproval.clear();
      this.approvals.clear();
      return session.id;
    };

    try {
      return await withRetry(
        () => tryCreate(targetModel),
        { targetUrl: this.config.baseUrl }
      );
    } catch (err) {
      if (this.config.fallbackModel && this.config.fallbackModel !== targetModel) {
        console.warn(`[Forge] Primary model '${targetModel}' failed after retries. Failing over to fallback: '${this.config.fallbackModel}'`);
        return await withRetry(
          () => tryCreate(this.config.fallbackModel!),
          { targetUrl: this.config.baseUrl }
        );
      }
      throw err;
    }
  }

  /**
   * Task A: Routes inline edit prompt to TrueForge.
   * Does NOT call executeProposeEdit directly; the model must issue the MCP tool call.
   */
  public async runTaskA(
    params: InlineEditTaskParams
  ): Promise<AsyncGenerator<ForgeEvent, void, unknown>> {
    const sessionId = await this.createSession();

    const start = params.selectionRange.startLine;
    const end = params.selectionRange.endLine;
    const filePath = params.filePath;
    const instruction = params.instruction;

    const prompt = `Edit only lines ${start}-${end} of ${filePath}. Instruction: ${instruction}. Read what you need, then call propose_edit with a reason. Do not write files any other way. Keep the change minimal.`;

    return await this.sendTurn(sessionId, prompt);
  }

  /**
   * Task B: Routes raw user request to TrueForge without attaching filenames.
   * Model discovers files, searches, reads, and proposes edits via MCP.
   */
  public async runTaskB(
    rawRequest: string,
    contextSummary?: string,
    options?: { preload?: boolean; compaction?: boolean }
  ): Promise<AsyncGenerator<ForgeEvent, void, unknown>> {
    const sessionId = await this.createSession(undefined, undefined, options);
    return await this.sendTurn(sessionId, rawRequest, contextSummary);
  }

  public getAbortController(): AbortController | null {
    return this.abortController;
  }

  /**
   * Stream a turn through TrueForge SDK's SSE endpoint and yield ForgeEvent objects.
   */
  public async sendTurn(
    sessionId: string,
    prompt: string,
    contextSummary?: string
  ): Promise<AsyncGenerator<ForgeEvent, void, unknown>> {
    this.abortController = new AbortController();
    const fullPrompt = contextSummary
      ? `<context>\n${contextSummary}\n</context>\n\n${prompt}`
      : prompt;

    return await withRetry(
      async () => {
        if (this.sessionManager.isCancelled()) {
          throw new SessionCancelledError();
        }

        const sdk = await this.getSdk();
        const stream = await sdk.sessions.createTurnStream(sessionId, {
          input: [
            {
              type: 'user.message',
              content: fullPrompt
            }
          ]
        });

        return this._adaptStream(stream);
      },
      { targetUrl: this.config.baseUrl }
    );
  }

  /**
   * Convert the SDK's raw event stream to our internal ForgeEvent union.
   * Enforces LoopGuard, event deduplication, and cancellation checks.
   */
  private async *_adaptStream(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sdkStream: AsyncIterable<any>
  ): AsyncGenerator<ForgeEvent, void, unknown> {
    let usedTokens = 0;

    try {
      for await (const raw of sdkStream) {
        if (this.sessionManager.isCancelled()) {
          yield this.doneEvent('cancelled', usedTokens);
          return;
        }

        const event = raw?.data ?? raw;
        const sequenceId = raw?.id ?? event?.sequenceId;
        const eventId = event?.id;

        // Event deduplication
        if (eventId && this.sessionManager.hasSeenEvent(eventId)) {
          continue;
        }
        this.sessionManager.recordEvent(eventId, typeof sequenceId === 'number' ? sequenceId : undefined);

        if (!event || !event.type) continue;

        switch (event.type) {
          case 'model.message.delta': {
            // SDK ModelMessageDeltaEvent: streamed text lives in `content`.
            const text = typeof event.content === 'string' ? event.content : '';
            if (text) {
              yield { type: 'token', text, timestamp: Date.now() };
            }
            break;
          }

          case 'model.message': {
            // SDK ModelMessageEvent: completed tool calls arrive in `toolCalls`.
            const toolCalls: SdkToolCall[] = Array.isArray(event.toolCalls) ? event.toolCalls : [];
            for (const call of toolCalls) {
              const callId = call.id;
              const toolName = resolveToolName(call);
              const args = parseToolArguments(call.function?.arguments);
              this.toolCalls.set(callId, { name: toolName, arguments: args, threadId: event.threadId ?? '' });

              // Enforce Agent Loop Guard (max 20 calls, max 3 identical calls)
              try {
                this.loopGuard.recordAndCheck({ name: toolName, arguments: args });
              } catch (err) {
                if (err instanceof LoopGuardError) {
                  yield {
                    type: 'error',
                    code: 'LOOP_GUARD_TRIGGERED',
                    message: err.message,
                    timestamp: Date.now()
                  };
                  yield this.doneEvent('cancelled', usedTokens);
                  return;
                }
                throw err;
              }

              yield {
                type: 'tool_call',
                toolCallId: callId,
                name: toolName,
                arguments: args,
                timestamp: Date.now()
              };
            }
            if (event.usage) {
              usedTokens += (event.usage.inputTokens ?? 0) + (event.usage.outputTokens ?? 0);
            }
            break;
          }

          case 'tool.response': {
            // SDK ToolResponseEvent: { toolCallId, content }
            const info = this.toolCalls.get(event.toolCallId);
            const output = typeof event.content === 'string' ? event.content : JSON.stringify(event.content);
            yield {
              type: 'tool_result',
              result: {
                toolCallId: event.toolCallId ?? '',
                name: info?.name ?? '',
                success: true,
                output
              },
              timestamp: Date.now()
            };
            break;
          }

          case 'tool.approval_required': {
            // SDK ToolApprovalRequiredEvent: { threadId, toolCalls: [{ id, sourceEventId }] }
            const refs: { id: string }[] = Array.isArray(event.toolCalls) ? event.toolCalls : [];
            for (const ref of refs) {
              const info = this.toolCalls.get(ref.id) ?? { name: '', arguments: {}, threadId: event.threadId ?? '' };
              if (!info.threadId) info.threadId = event.threadId ?? '';
              this.toolCalls.set(ref.id, info);
              this.awaitingApproval.set(ref.id, null);
              this.approvals.registerPending({ id: ref.id, name: info.name, arguments: info.arguments });
              yield {
                type: 'approval',
                requestId: ref.id,
                action: info.name,
                requiresManualReview: true,
                timestamp: Date.now()
              };
            }
            break;
          }

          case 'turn.done': {
            // SDK TurnDoneEvent: outcome is in `state.status` ('done' | 'cancelled' | 'error').
            const status = event.state?.status;
            if (status === 'error') {
              yield {
                type: 'error',
                code: 'TURN_FAILED',
                message: event.state?.message ?? 'The model run failed.',
                timestamp: Date.now()
              };
              yield this.doneEvent('failed', usedTokens);
              return;
            }
            yield this.doneEvent(status === 'cancelled' ? 'cancelled' : 'completed', usedTokens);
            return;
          }

          default:
            break;
        }
      }
    } catch (streamErr) {
      if (this.sessionManager.isCancelled()) {
        return;
      }
      throw streamErr;
    }

    // Stream ended without explicit done event
    yield this.doneEvent('completed', usedTokens);
  }

  private doneEvent(status: 'completed' | 'cancelled' | 'failed', usedTokens: number): ForgeEvent {
    return {
      type: 'done',
      status,
      budget: {
        maxTokens: TOTAL_RUN_SAFETY_CAP.MAX_TOKENS,
        usedTokens,
        maxCostUsd: TOTAL_RUN_SAFETY_CAP.MAX_COST_USD,
        usedCostUsd: 0,
        maxIterations: TOTAL_RUN_SAFETY_CAP.MAX_ITERATIONS,
        currentIteration: 1
      },
      timestamp: Date.now()
    };
  }

  /** Tool calls currently paused by TrueForge, waiting for a user decision. */
  public getPendingApprovalIds(): string[] {
    return Array.from(this.awaitingApproval.keys());
  }

  /** Metadata (tool name, parsed arguments, thread) for a tool call seen in this run. */
  public getToolCallInfo(toolCallId: string): ToolCallInfo | undefined {
    return this.toolCalls.get(toolCallId);
  }

  /**
   * Record the user's decision for one paused tool call.
   *
   * TrueForge pauses a turn on `tool.approval_required` for a batch of tool calls and
   * expects every decision in that batch in a single resume turn. Until the last pending
   * call is decided this returns null; once the batch is complete it resumes the session
   * with `user.tool_approval` input items and returns the new event stream.
   */
  public async decideApproval(
    sessionId: string,
    toolCallId: string,
    decision: 'accept' | 'reject',
    reason?: string
  ): Promise<AsyncGenerator<ForgeEvent, void, unknown> | null> {
    if (!this.awaitingApproval.has(toolCallId)) {
      throw new Error(`No pending approval for tool call '${toolCallId}'`);
    }

    const info = this.toolCalls.get(toolCallId);
    let approval: ApprovalInput['approval'];
    if (info?.name === 'apply_patch_hunk') {
      // Write approvals go through the review invariants (known hunk, not rejected, not stale).
      const result = this.approvals.evaluateDecision(toolCallId, decision, reason);
      approval = result.event.approval.status === 'allow'
        ? { status: 'allow' }
        : { status: 'deny', reason: result.event.approval.reason ?? 'Denied' };
    } else {
      this.approvals.removePending(toolCallId);
      approval = decision === 'accept'
        ? { status: 'allow' }
        : { status: 'deny', reason: reason || 'Rejected by human reviewer' };
    }

    this.awaitingApproval.set(toolCallId, {
      type: 'user.tool_approval',
      threadId: info?.threadId ?? '',
      toolCallId,
      approval
    });

    const decided = Array.from(this.awaitingApproval.values());
    if (decided.some((d) => d === null)) {
      return null;
    }
    this.awaitingApproval.clear();
    return this.sendApprovalResume(sessionId, decided as ApprovalInput[]);
  }

  /**
   * Resume a paused turn. Approval decisions are sent on their own, never mixed
   * with a new user message, via `sessions.createTurnStream`.
   */
  public async sendApprovalResume(
    sessionId: string,
    decisions: ApprovalInput[]
  ): Promise<AsyncGenerator<ForgeEvent, void, unknown>> {
    if (!sessionId) {
      throw new Error('No active TrueForge session to resume');
    }
    this.abortController = new AbortController();
    const sdk = await this.getSdk();
    const stream = await sdk.sessions.createTurnStream(
      sessionId,
      this.approvals.buildResumeTurnRequest(decisions)
    );
    return this._adaptStream(stream);
  }

  /**
   * Cancel the current session/turn.
   */
  public async cancel(sessionId?: string): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    const activeId = sessionId || this.sessionManager.getSession()?.sessionId;
    this.sessionManager.markCancelled();
    this.loopGuard.reset();

    if (activeId) {
      try {
        const sdk = await this.getSdk();
        if (typeof sdk?.sessions?.cancel === 'function') {
          await sdk.sessions.cancel(activeId);
        } else {
          await fetch(`${this.config.baseUrl}/sessions/${activeId}/cancel`, {
            method: 'POST'
          }).catch(() => {});
        }
      } catch {
        // Safe fire-and-forget
      }
    }
  }
}

export const defaultTrueForgeClient = new TrueForgeClient();
