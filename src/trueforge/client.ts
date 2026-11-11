/**
 * TrueForge SDK client wrapper — Stage 1 M1
 *
 * Uses @truefoundry/trueforge-sdk (sessions.create + createTurnStream) instead
 * of raw fetch, so the extension works with the versioned SDK contract.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TrueForgeInstance = any;
import { ForgeEvent } from '../shared/events';
import { MCP_CONSTANTS, TOTAL_RUN_SAFETY_CAP } from '../shared/constants';
import { getTrueForgeConfig, TrueForgeConfig } from './config';
import { withRetry } from './retry';
import { ApprovalMatcher, ResumePayload } from './approvals';

export class TrueForgeClient {
  private config: TrueForgeConfig;
  private sdk: TrueForgeInstance = null;
  public readonly approvals = new ApprovalMatcher();

  constructor(configOverride?: Partial<TrueForgeConfig>) {
    this.config = { ...getTrueForgeConfig(), ...configOverride };
  }

  private async getSdk(): Promise<TrueForgeInstance> {
    if (!this.sdk) {
      const { TrueForge: TrueForgeClass } = await import('@truefoundry/trueforge-sdk');
      this.sdk = new TrueForgeClass({
        baseUrl: this.config.baseUrl,
        timeoutInSeconds: Math.ceil(this.config.timeoutMs / 1000)
      });
    }
    return this.sdk;
  }

  /** Create a new inline-agent session and return its ID. */
  public async createSession(model?: string): Promise<string> {
    return await withRetry(async () => {
      const sdk = await this.getSdk();
      const { data: session } = await sdk.sessions.create({
        agent: {
          spec: {
            model: { name: model ?? 'ollama/llama3.2:3b' },
            instructions: [
              'You are Forge Agent — an autonomous coding assistant embedded in VS Code.',
              'You receive a user task plus a context summary assembled from the workspace.',
              'You may use the available MCP tools to read files, search symbols, and propose',
              'patch hunks. Every file write MUST go through the apply_patch_hunk tool.',
              'Never read .env or secret files. Respect the retrieved-context budget.',
              `MCP server is at http://${MCP_CONSTANTS.HOST}:${this.config.mcpPort}/sse`
            ].join('\n')
          }
        }
      });
      return session.id;
    });
  }

  /**
   * Stream a turn through the SDK's SSE endpoint and yield ForgeEvent objects
   * that our extension's event loop understands.
   */
  public async sendTurn(
    sessionId: string,
    prompt: string,
    contextSummary?: string
  ): Promise<AsyncGenerator<ForgeEvent, void, unknown>> {
    const fullPrompt = contextSummary
      ? `<context>\n${contextSummary}\n</context>\n\n${prompt}`
      : prompt;

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
  }

  /** Convert the SDK's raw event stream to our internal ForgeEvent union. */
  private async *_adaptStream(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sdkStream: AsyncIterable<any>
  ): AsyncGenerator<ForgeEvent, void, unknown> {
    let usedTokens = 0;

    for await (const raw of sdkStream) {
      const event = raw?.data ?? raw;
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
          yield {
            type: 'tool_call',
            toolCallId: event.tool_call_id ?? event.id ?? '',
            name: event.name ?? '',
            arguments: event.arguments ?? {},
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
        case 'session.turn.stop':
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
        // approval requests forwarded as-is when the SDK surfaces them
        case 'approval_request': {
          yield {
            type: 'approval',
            requestId: event.request_id ?? event.id ?? '',
            action: event.action ?? '',
            requiresManualReview: true,
            timestamp: Date.now()
          };
          break;
        }
        default:
          // Ignore unknown SDK event types silently
          break;
      }
    }

    // Stream ended without explicit done event — emit completed
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

  /** Resume a turn after a manual approval from the user. */
  public async sendApprovalResume(
    sessionId: string,
    payload: ResumePayload
  ): Promise<void> {
    // The SDK does not expose a typed approval-resume method yet,
    // so we fall back to a direct POST using the SDK's internal fetch context.
    const res = await fetch(`${this.config.baseUrl}/sessions/${sessionId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      throw new Error(`Failed to send approval resume: HTTP ${res.status}`);
    }
  }

  /** Soft-cancel the current turn. Fire-and-forget. */
  public async cancel(sessionId: string): Promise<void> {
    await fetch(`${this.config.baseUrl}/sessions/${sessionId}/cancel`, {
      method: 'POST'
    }).catch(() => {});
  }
}
