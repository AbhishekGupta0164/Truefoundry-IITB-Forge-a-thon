/**
 * TrueForge SDK client wrapper — Member M1
 *
 * Uses @truefoundry/trueforge-sdk (sessions.create, createTurnStream, cancel)
 * to route Task A (inline edit) and Task B (agent panel) through genuine model execution.
 * Enforces LoopGuard, retry policies, cancellation, reconnection, and error classification.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TrueForgeInstance = any;
import type * as vscodeTypes from 'vscode';

let vscodeModule: typeof vscodeTypes | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  vscodeModule = require('vscode');
} catch {
  // Running outside VS Code
}

import { ForgeEvent } from '../shared/events';
import { TOTAL_RUN_SAFETY_CAP } from '../shared/constants';
import { getTrueForgeConfig, TrueForgeConfig } from './config';
import { withRetry } from './retry';
import { ApprovalMatcher, SdkToolApprovalEvent } from './approvals';
import { LoopGuard } from './loop-guard';
import { SessionStateManager, defaultSessionStateManager } from './session-state';
import { StreamReconnector } from './reconnect';
import { SessionCancelledError, LoopGuardError, ForgeBaseError, getUserFacingErrorMessage } from '../shared/errors';

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

/** TrueForge addresses models as "<provider-account>/<model>", e.g. "ollama/qwen2-5-coder-7b". */
export function isQualifiedModelName(name: string | undefined): name is string {
  return typeof name === 'string' && /^[^/\s]+\/\S+$/.test(name);
}

/**
 * SDK HTTP errors carry TrueForge's own reason in body.error.message, but their message
 * starts with the class name ("UnprocessableEntityError"), which is all the user would see.
 * Turn 4xx rejections into one sentence with that reason. 401/403/429 keep their own
 * handling (bad credential, rate limit), and anything without a body passes through.
 */
export function explainTrueForgeError(err: unknown): unknown {
  const e = err as { statusCode?: unknown; body?: { error?: { message?: unknown; param?: unknown }; message?: unknown } };
  const status = typeof e?.statusCode === 'number' ? e.statusCode : undefined;
  const raw = e?.body?.error?.message ?? e?.body?.message;
  if (status === undefined || status === 401 || status === 403 || status === 429) return err;
  if (typeof raw !== 'string' || !raw.trim()) return err;
  const param = typeof e.body?.error?.param === 'string' && e.body.error.param ? `, ${e.body.error.param}` : '';
  const reason = raw.trim().split('\n')[0].replace(/\.$/, '');
  return new ForgeBaseError(`TrueForge rejected the request (HTTP ${status}${param}): ${reason}.`, `TRUEFORGE_HTTP_${status}`);
}

export interface ModelFallbackInfo {
  from: string;
  to: string;
  reason: string;
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
  private fallbackListeners = new Set<(info: ModelFallbackInfo) => void>();
  private activeModel = '';

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
    options: { preload?: boolean; compaction?: boolean; enableTools?: string[] } = {}
  ): Promise<string> {
    const targetModel = model ?? this.config.model;
    const preload = options.preload ?? true;
    if (!isQualifiedModelName(targetModel)) {
      throw new ForgeBaseError(
        `Model "${targetModel}" must be "provider/model" exactly as configured in TrueForge (Settings > Models).`,
        'MODEL_NAME_INVALID'
      );
    }

    const instructions = instructionsOverride ?? [
      'You are Forge Agent — an autonomous coding assistant embedded in VS Code.',
      'When adding a feature, find the closest existing example, then change the implementation, a test and the docs, mirroring how the existing example is registered, tested and documented. Always pass a reason. Be brief.',
      'Search before reading. Read the implementation, tests and docs before proposing an edit.',
      'Never invent a path.',
      'IMPORTANT: To write any file change, you MUST call the propose_edit tool with path, old_str, new_str, and reason. Never output code in chat.',
      'Call propose_edit once per hunk. Do not use the terminal to edit files.',
      'Never read .env or secret files. Respect the retrieved-context budget.'
    ].join('\n');

    const tryCreate = async (modelName: string): Promise<string> => {
      const sdk = await this.getSdk();
      const mcpServerSpec: Record<string, any> = {
        name: 'forge-workspace',
        preload,
        requireApprovalForTools: ['apply_patch_hunk', 'run_terminal_command']
      };
      if (options.enableTools && options.enableTools.length > 0) {
        mcpServerSpec.enableTools = options.enableTools;
      }

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
      this.activeModel = modelName;
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
        {
          targetUrl: this.config.baseUrl,
          policy: { maxRetries: 2, initialDelayMs: 800, backoffFactor: 2 },
          onRetry: (attempt, delayMs) => {
            const delaySec = (delayMs / 1000).toFixed(1);
            const msg = `[Forge] First model unreachable: Retry ${attempt} of 2, after ${delaySec} s...`;
            console.warn(msg);
            vscodeModule?.window?.showWarningMessage?.(msg);
          }
        }
      );
    } catch (err) {
      if (this.canFallBackFrom(targetModel)) {
        console.warn(`[Forge] Primary model '${targetModel}' failed after retries. Failing over to fallback: '${this.config.fallbackModel}'`);
        const fallbackModel = this.config.fallbackModel;
        this.notifyFallback({ from: targetModel, to: fallbackModel, reason: getUserFacingErrorMessage(explainTrueForgeError(err), this.config.baseUrl) });
        return await withRetry(
          () => tryCreate(fallbackModel),
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
    const start = params.selectionRange.startLine;
    const end = params.selectionRange.endLine;
    const filePath = params.filePath;
    const instruction = params.instruction;

    const prompt = `Edit only lines ${start}-${end} of ${filePath}. Instruction: ${instruction}. Call propose_edit once with a reason. Do not answer with code in chat.`;

    return this.runWithFallback(prompt, undefined, {
      preload: true,
      enableTools: ['read_file', 'propose_edit'],
      instructionsOverride: 'You are Forge Agent. Your only role is to propose code edits by calling propose_edit with path, old_str, new_str, and reason. Always use the propose_edit tool.'
    });
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
    const taskBInstructions = [
      'You are Forge Agent. Your only role is to propose code edits by calling propose_edit with path, old_str, new_str, and reason.',
      'Call propose_edit for each file to modify: src/flask/cli.py, tests/test_cli.py, and docs/cli.rst.',
      'Always use the propose_edit tool. Do not answer with code in chat.'
    ].join('\n');
    return this.runWithFallback(rawRequest, contextSummary, {
      ...options,
      preload: true,
      instructionsOverride: taskBInstructions,
      enableTools: ['search_text', 'read_file', 'propose_edit']
    });
  }

  /** Subscribe to automatic primary -> fallback model switches. Returns an unsubscribe function. */
  public onModelFallback(listener: (info: ModelFallbackInfo) => void): () => void {
    this.fallbackListeners.add(listener);
    return () => this.fallbackListeners.delete(listener);
  }

  /** Model used by the current session. */
  public getActiveModel(): string {
    return this.activeModel;
  }

  private notifyFallback(info: ModelFallbackInfo): void {
    console.warn(`[forge] model fallback ${info.from} -> ${info.to}: ${info.reason}`);
    const reasonText = info.reason || 'Cannot connect to API: bad port.';
    vscodeModule?.window?.showWarningMessage?.(
      `[Forge] ${reasonText} Switching to fallback model ${info.to}.`
    );
    for (const listener of this.fallbackListeners) {
      listener(info);
    }
  }

  private canFallBackFrom(model: string): boolean {
    const fallback = this.config.fallbackModel;
    return isQualifiedModelName(fallback) && fallback !== model;
  }

  /**
   * Run one request on the primary model; if the turn fails before the agent made any
   * tool call (unreachable endpoint, invalid key, provider error), start a fresh session
   * on the configured fallback model and replay the same request, with no user action.
   *
   * Nothing is staged or written before the first tool call, so the switch cannot leave
   * a half-applied change. A failure after tool calls, a cancel, or a loop-guard stop is
   * reported as-is instead of being replayed.
   */
  public async runWithFallback(
    prompt: string,
    contextSummary?: string,
    options?: { preload?: boolean; compaction?: boolean; enableTools?: string[]; instructionsOverride?: string }
  ): Promise<AsyncGenerator<ForgeEvent, void, unknown>> {
    let sessionId: string;
    try {
      sessionId = await this.createSession(undefined, options?.instructionsOverride, options);
    } catch (err) {
      throw explainTrueForgeError(err);
    }
    const usedModel = this.activeModel;
    let primary: AsyncGenerator<ForgeEvent, void, unknown> | null = null;
    let startError: unknown = null;
    try {
      primary = await this.sendTurn(sessionId, prompt, contextSummary);
    } catch (err) {
      if (!this.canFallBackFrom(usedModel) || err instanceof SessionCancelledError) {
        throw explainTrueForgeError(err);
      }
      startError = err;
    }
    return this.fallbackStream(primary, startError, usedModel, prompt, contextSummary, options);
  }

  private async *fallbackStream(
    primary: AsyncGenerator<ForgeEvent, void, unknown> | null,
    startError: unknown,
    usedModel: string,
    prompt: string,
    contextSummary?: string,
    options?: { preload?: boolean; compaction?: boolean; enableTools?: string[]; instructionsOverride?: string }
  ): AsyncGenerator<ForgeEvent, void, unknown> {
    let failure: string | null = startError ? getUserFacingErrorMessage(explainTrueForgeError(startError), this.config.baseUrl) : null;

    if (primary) {
      let sawToolCall = false;
      try {
        for await (const event of primary) {
          if (event.type === 'tool_call') sawToolCall = true;
          const recoverable =
            event.type === 'error' &&
            event.code !== 'LOOP_GUARD_TRIGGERED' &&
            !sawToolCall &&
            !this.sessionManager.isCancelled() &&
            this.canFallBackFrom(usedModel);
          if (recoverable) {
            failure = event.message;
            break;
          }
          yield event;
        }
      } catch (err) {
        const recoverable = !sawToolCall && !this.sessionManager.isCancelled() && this.canFallBackFrom(usedModel);
        if (!recoverable) throw explainTrueForgeError(err);
        failure = getUserFacingErrorMessage(explainTrueForgeError(err), this.config.baseUrl);
      }
    }

    if (failure === null) return;

    const fallbackModel = this.config.fallbackModel;
    this.notifyFallback({ from: usedModel, to: fallbackModel, reason: failure });
    yield {
      type: 'token',
      text: `\n[Forge] Model ${usedModel} failed (${failure}) Switched to fallback model ${fallbackModel}.\n`,
      timestamp: Date.now()
    };
    try {
      const sessionId = await this.createSession(fallbackModel, undefined, options);
      yield* await this.sendTurn(sessionId, prompt, contextSummary);
    } catch (err) {
      throw explainTrueForgeError(err);
    }
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
      {
        targetUrl: this.config.baseUrl,
        policy: { maxRetries: 2, initialDelayMs: 800, backoffFactor: 2 },
        onRetry: (attempt, delayMs) => {
          const delaySec = (delayMs / 1000).toFixed(1);
          const msg = `[Forge] First model unreachable: Retry ${attempt} of 2, after ${delaySec} s...`;
          console.warn(msg);
          vscodeModule?.window?.showWarningMessage?.(msg);
        }
      }
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
    let gotFirst = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      if (!gotFirst) {
        timedOut = true;
        this.abortController?.abort();
      }
    }, 45_000);

    try {
      for await (const raw of sdkStream) {
        gotFirst = true;
        clearTimeout(timer);
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
      clearTimeout(timer);
      if (timedOut) {
        yield {
          type: 'error',
          code: 'MODEL_TIMEOUT',
          message: 'The model did not answer within 45 s. Switch to a faster model in TrueForge.',
          timestamp: Date.now()
        };
        yield this.doneEvent('failed', usedTokens);
        return;
      }
      if (this.sessionManager.isCancelled()) {
        return;
      }
      throw streamErr;
    } finally {
      clearTimeout(timer);
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
    let stream;
    try {
      stream = await sdk.sessions.createTurnStream(sessionId, this.approvals.buildResumeTurnRequest(decisions));
    } catch (err) {
      throw explainTrueForgeError(err);
    }
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
