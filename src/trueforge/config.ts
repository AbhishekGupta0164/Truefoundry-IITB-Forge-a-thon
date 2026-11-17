import type * as vscodeTypes from 'vscode';

let vscodeModule: typeof vscodeTypes | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  vscodeModule = require('vscode');
} catch {
  // Running outside VS Code
}

export interface TrueForgeConfig {
  baseUrl: string;
  mcpPort: number;
  timeoutMs: number;
  model: string;
  fallbackModel: string;
  temperature: number;
  trueforgeVersion: string;
}

export function getTrueForgeConfig(): TrueForgeConfig {
  let baseUrl = process.env.TRUEFORGE_BASE_URL || 'http://localhost:8790';
  let mcpPort = Number(process.env.MCP_PORT || 8765);
  let timeoutMs = 30000;
  let model = process.env.TRUEFORGE_MODEL || 'qwen2.5-coder:14b';
  let fallbackModel = process.env.TRUEFORGE_FALLBACK_MODEL || 'qwen2.5-coder:7b';
  let temperature = 0;
  let trueforgeVersion = process.env.TRUEFORGE_VERSION || '0.184.3';

  try {
    const config = vscodeModule?.workspace?.getConfiguration?.('forge');
    if (config) {
      baseUrl = config.get<string>('trueforgeUrl', baseUrl).replace(/\/+$/, '');
      mcpPort = config.get<number>('mcpPort', mcpPort);
      timeoutMs = config.get<number>('timeoutMs', timeoutMs);
      model = config.get<string>('model', model);
      fallbackModel = config.get<string>('fallbackModel', fallbackModel);
      temperature = config.get<number>('temperature', temperature);
      trueforgeVersion = config.get<string>('trueforgeVersion', trueforgeVersion);
    }
  } catch {
    // Ignore outside VS Code
  }

  return {
    baseUrl,
    mcpPort,
    timeoutMs,
    model,
    fallbackModel,
    temperature,
    trueforgeVersion
  };
}
