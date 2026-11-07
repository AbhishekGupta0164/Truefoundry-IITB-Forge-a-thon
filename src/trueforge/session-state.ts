import * as vscode from 'vscode';

export interface PersistedSession {
  sessionId: string;
  turnId?: string;
  lastSequence: number;
  updatedAt: number;
}

const SESSION_KEY = 'forge.activeSession';

export class SessionStateManager {
  constructor(private readonly context: vscode.ExtensionContext) {}

  public getSession(): PersistedSession | undefined {
    return this.context.workspaceState.get<PersistedSession>(SESSION_KEY);
  }

  public async setSession(session: PersistedSession): Promise<void> {
    await this.context.workspaceState.update(SESSION_KEY, session);
  }

  public async updateSequence(sequence: number): Promise<void> {
    const session = this.getSession();
    if (session) {
      session.lastSequence = sequence;
      session.updatedAt = Date.now();
      await this.setSession(session);
    }
  }

  public async clearSession(): Promise<void> {
    await this.context.workspaceState.update(SESSION_KEY, undefined);
  }
}
