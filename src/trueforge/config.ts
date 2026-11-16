import * as vscode from 'vscode';

export interface TrueForgeConfig {
  baseUrl: string;
  mcpPort: number;
  timeoutMs: number;
}

export function getTrueForgeConfig(): TrueForgeConfig {
  const config = vscode.workspace.getConfiguration('forge');
  return {
    baseUrl: config.get<string>('trueforgeUrl', 'http://localhost:8790').replace(/\/+$/, ''),
    mcpPort: config.get<number>('mcpPort', 8765),
    timeoutMs: config.get<number>('timeoutMs', 30000)
  };
}
