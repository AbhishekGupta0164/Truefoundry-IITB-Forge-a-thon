import { ForgeEvent } from '../shared/events';
import { getTrueForgeConfig, TrueForgeConfig } from './config';
import { withRetry } from './retry';
import { parseSSEStream } from './stream';
import { ApprovalMatcher, ResumePayload } from './approvals';

export interface CreateSessionResponse {
  sessionId: string;
}

export class TrueForgeClient {
  private config: TrueForgeConfig;
  public readonly approvals = new ApprovalMatcher();

  constructor(configOverride?: Partial<TrueForgeConfig>) {
    this.config = { ...getTrueForgeConfig(), ...configOverride };
  }

  public async createSession(): Promise<string> {
    return await withRetry(async () => {
      const res = await fetch(`${this.config.baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mcpPort: this.config.mcpPort })
      });
      if (!res.ok) {
        throw new Error(`Failed to create TrueForge session: HTTP ${res.status}`);
      }
      const data = await res.json() as CreateSessionResponse;
      return data.sessionId;
    });
  }

  public async sendTurn(
    sessionId: string,
    prompt: string,
    contextSummary?: string
  ): Promise<AsyncGenerator<ForgeEvent, void, unknown>> {
    const res = await fetch(`${this.config.baseUrl}/sessions/${sessionId}/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, contextSummary })
    });

    if (!res.ok || !res.body) {
      throw new Error(`Failed to send turn: HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    return parseSSEStream(reader);
  }

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

  public async cancel(sessionId: string): Promise<void> {
    await fetch(`${this.config.baseUrl}/sessions/${sessionId}/cancel`, {
      method: 'POST'
    }).catch(() => {});
  }
}
