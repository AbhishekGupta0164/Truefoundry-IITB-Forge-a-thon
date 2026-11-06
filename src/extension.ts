import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  console.log('Forge Agent extension is now active!');

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
    const config = vscode.workspace.getConfiguration('forge');
    const port = config.get<number>('mcpPort', 8765);
    const mcpConfig = JSON.stringify(
      {
        mcpServers: {
          /* eslint-disable-next-line @typescript-eslint/naming-convention */
          'forge-workspace': {
            url: `http://127.0.0.1:${port}/sse`
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
    copyMcpConfigCmd
  );
}

export function deactivate() {}
