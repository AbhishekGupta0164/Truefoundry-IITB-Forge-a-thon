/**
 * SessionStateManager — tracks the active TrueForge session for reconnect.
 */

export interface ActiveSession {
  sessionId: string;
  lastSequence: number;
  startedAt: number;
}

export class SessionStateManager {
  private session: ActiveSession | null = null;

  public setSession(sessionId: string): void {
    this.session = { sessionId, lastSequence: 0, startedAt: Date.now() };
  }

  public getSession(): ActiveSession | null {
    return this.session;
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
