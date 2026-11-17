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
import { ApprovalMatcher, ResumePayload } from './approvals';
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

export class TrueForgeClient {
  private config: TrueForgeConfig;
  private sdk: TrueForgeInstance = null;
  public readonly approvals = new ApprovalMatcher();
  public readonly loopGuard = new LoopGuard();
  public readonly sessionManager: SessionStateManager;
  public readonly reconnector: StreamReconnector;
  private abortController: AbortController | null = null;

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
          yield {
            type: 'done',
            status: 'cancelled',
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
            const text: string = event.delta?.text ?? '';
            if (text) {
              yield { type: 'token', text, timestamp: Date.now() };
            }
            break;
          }

          case 'tool.call': {
            const callId = event.tool_call_id ?? event.id ?? '';
            const toolName = event.name ?? '';
            const args = event.arguments ?? {};

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
                yield {
                  type: 'done',
                  status: 'cancelled',
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
            break;
          }

          case 'tool.call.result': {
            yield {
              type: 'tool_result',
              result: {
                toolCallId: event.tool_call_id ?? '',
                name: event.name ?? '',
                success: !event.error,
                output: typeof event.output === 'string' ? event.output : JSON.stringify(event.output),
                error: event.error ? String(event.error) : undefined
              },
              timestamp: Date.now()
            };
            break;
          }

          case 'usage': {
            usedTokens = event.total_tokens ?? 0;
            break;
          }

          case 'error': {
            yield {
              type: 'error',
              code: event.code ?? 'UNKNOWN',
              message: event.message ?? String(event),
              timestamp: Date.now()
            };
            return;
          }

          case 'tool.approval_required':
          case 'approval_request': {
            yield {
              type: 'approval',
              requestId: event.request_id ?? event.id ?? '',
              action: event.action ?? 'apply_patch_hunk',
              requiresManualReview: true,
              timestamp: Date.now()
            };
            break;
          }

          case 'session.turn.stop':
          case 'turn.done':
          case 'done': {
            yield {
              type: 'done',
              status: event.status === 'cancelled' ? 'cancelled' : 'completed',
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
    yield {
      type: 'done',
      status: 'completed',
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

  /**
   * Resume a turn after a manual approval from the user.
   */
  public async sendApprovalResume(
    sessionId: string,
    payload: ResumePayload
  ): Promise<void> {
    const res = await fetch(`${this.config.baseUrl}/sessions/${sessionId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      throw new Error(`Failed to send approval resume: HTTP ${res.status}`);
    }
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
