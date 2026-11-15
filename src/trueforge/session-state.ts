/**
 * SessionStateManager — tracks active TrueForge session state for reconnection,
 * deduplication, and cancellation tracking.
 */

export interface ActiveSession {
  sessionId: string;
  turnId?: string;
  lastSequence: number;
  seenEventIds: Set<string>;
  startedAt: number;
  isCancelled: boolean;
}

export class SessionStateManager {
  private session: ActiveSession | null = null;

  public setSession(sessionId: string, turnId?: string): void {
    this.session = {
      sessionId,
      turnId,
      lastSequence: 0,
      seenEventIds: new Set<string>(),
      startedAt: Date.now(),
      isCancelled: false
    };
  }

  public getSession(): ActiveSession | null {
    return this.session;
  }

  public setTurnId(turnId: string): void {
    if (this.session) {
      this.session.turnId = turnId;
    }
  }

  public markCancelled(): void {
    if (this.session) {
      this.session.isCancelled = true;
    }
  }

  public isCancelled(): boolean {
    return this.session ? this.session.isCancelled : false;
  }

  public recordEvent(eventId?: string, sequence?: number): void {
    if (!this.session) return;
    if (eventId) {
      this.session.seenEventIds.add(eventId);
    }
    if (typeof sequence === 'number' && sequence > this.session.lastSequence) {
      this.session.lastSequence = sequence;
    } else {
      this.session.lastSequence += 1;
    }
  }

  public hasSeenEvent(eventId?: string): boolean {
    if (!this.session || !eventId) return false;
    return this.session.seenEventIds.has(eventId);
  }

  public advanceSequence(): void {
    if (this.session) {
      this.session.lastSequence += 1;
    }
  }

  public clearSession(): void {
    this.session = null;
  }
}

export const defaultSessionStateManager = new SessionStateManager();
