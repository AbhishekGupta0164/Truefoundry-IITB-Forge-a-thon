import { ForgeEvent } from '../shared/events';
import { SessionStateManager } from './session-state';
import { withRetry } from './retry';

export class StreamReconnector {
  constructor(
    private readonly sessionManager: SessionStateManager,
    private readonly fetchStream: (sessionId: string, lastSequence: number) => Promise<AsyncGenerator<ForgeEvent, void, unknown>>
  ) {}

  public async rejoin(): Promise<AsyncGenerator<ForgeEvent, void, unknown>> {
    const session = this.sessionManager.getSession();
    if (!session) {
      throw new Error('No active session found to reconnect');
    }

    return await withRetry(async () => {
      return await this.fetchStream(session.sessionId, session.lastSequence);
    });
  }
}
