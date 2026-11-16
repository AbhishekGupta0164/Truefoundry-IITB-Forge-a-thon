import { ForgeEvent } from '../shared/events';
import { SessionStateManager, defaultSessionStateManager } from './session-state';
import { withRetry } from './retry';
import { SessionCancelledError } from '../shared/errors';

export class StreamReconnector {
  constructor(
    private readonly sessionManager: SessionStateManager = defaultSessionStateManager,
    private readonly fetchStream?: (
      sessionId: string,
      lastSequence: number,
      turnId?: string
    ) => Promise<AsyncGenerator<ForgeEvent, void, unknown>>
  ) {}

  /**
   * Rejoins a dropped event stream from the last processed sequence.
   */
  public async rejoin(
    customFetch?: (
      sessionId: string,
      lastSequence: number,
      turnId?: string
    ) => Promise<AsyncGenerator<ForgeEvent, void, unknown>>
  ): Promise<AsyncGenerator<ForgeEvent, void, unknown>> {
    const session = this.sessionManager.getSession();
    if (!session) {
      throw new Error('No active session found to reconnect');
    }

    if (session.isCancelled) {
      throw new SessionCancelledError();
    }

    const fetcher = customFetch ?? this.fetchStream;
    if (!fetcher) {
      throw new Error('No stream fetcher provided for reconnection');
    }

    return await withRetry(async () => {
      return await fetcher(session.sessionId, session.lastSequence, session.turnId);
    });
  }
}
