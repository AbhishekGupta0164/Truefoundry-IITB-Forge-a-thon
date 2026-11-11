import * as vscode from 'vscode';
import { MCPAuthenticator } from './mcp/auth';
import { MCPServerManager } from './mcp/server';

let mcpServerManager: MCPServerManager | null = null;

export async function activate(context: vscode.ExtensionContext) {
  console.log('Forge Agent extension is now active!');

  // Initialize and start MCP Server
  const authenticator = new MCPAuthenticator(context.secrets);
  mcpServerManager = new MCPServerManager(authenticator);

  const config = vscode.workspace.getConfiguration('forge');
  const port = config.get<number>('mcpPort', 8765);

  try {
    await mcpServerManager.start({ port });
    console.log(`Forge MCP server started on 127.0.0.1:${port}/mcp`);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to start Forge MCP server: ${err.message}`);
  }

  const inlineEditCmd = vscode.commands.registerCommand('forge.inlineEdit', async () => {
    vscode.window.showInformationMessage('Forge: Inline Edit initiated');
  });

  const openPanelCmd = vscode.commands.registerCommand('forge.openPanel', () => {
    vscode.window.showInformationMessage('Forge: Opening Agent Panel');
  });

  const cancelCmd = vscode.commands.registerCommand('forge.cancel', () => {
    vscode.window.showInformationMessage('Forge: Run cancelled');
  });

  const undoTaskCmd = vscode.commands.registerCommand('forge.undoTask', () => {
    vscode.window.showInformationMessage('Forge: Whole Task Undone');
  });

  const copyMcpConfigCmd = vscode.commands.registerCommand('forge.copyMcpConfig', async () => {
    const activePort = mcpServerManager ? mcpServerManager.getPort() : port;
    const token = await authenticator.getOrCreateToken();

    const mcpConfig = JSON.stringify(
      {
        mcpServers: {
          /* eslint-disable-next-line @typescript-eslint/naming-convention */
          'forge-workspace': {
            url: `http://127.0.0.1:${activePort}/mcp`,
            headers: {
              /* eslint-disable-next-line @typescript-eslint/naming-convention */
              Authorization: `Bearer ${token}`
            }
          }
        }
      },
      null,
      2
    );
    await vscode.env.clipboard.writeText(mcpConfig);
    vscode.window.showInformationMessage('Forge: MCP connector settings copied to clipboard');
  });

  context.subscriptions.push(
    inlineEditCmd,
    openPanelCmd,
    cancelCmd,
    undoTaskCmd,
    copyMcpConfigCmd,
    {
      dispose: () => {
        if (mcpServerManager) {
          mcpServerManager.stop().catch(console.error);
        }
      }
    }
  );
}

export async function deactivate() {
  if (mcpServerManager) {
    await mcpServerManager.stop();
    mcpServerManager = null;
  }
}
