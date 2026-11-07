import * as crypto from 'crypto';
import * as vscode from 'vscode';

const SECRET_KEY = 'forge.mcpBearerToken';

export class MCPAuthenticator {
  constructor(private readonly secretStorage: vscode.SecretStorage) {}

  public async getOrCreateToken(): Promise<string> {
    let token = await this.secretStorage.get(SECRET_KEY);
    if (!token) {
      token = crypto.randomBytes(32).toString('hex');
      await this.secretStorage.store(SECRET_KEY, token);
    }
    return token;
  }

  public async validateToken(providedToken?: string): Promise<boolean> {
    if (!providedToken) {
      return false;
    }
    const currentToken = await this.getOrCreateToken();
    if (providedToken.length !== currentToken.length) {
      return false;
    }
    return crypto.timingSafeEqual(
      Buffer.from(providedToken, 'utf-8'),
      Buffer.from(currentToken, 'utf-8')
    );
  }
}
