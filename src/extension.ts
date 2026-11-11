import * as vscode from 'vscode';
import { MCPAuthenticator } from './mcp/auth';
import { MCPServerManager } from './mcp/server';
import { defaultInlineEditController } from './ui/inline-edit';
import { defaultAgentPanel } from './ui/panel';
import { defaultCancelManager } from './review/cancel';
import { defaultUndoManager } from './review/undo';
import { defaultCodeLensProvider } from './review/codelens';
import { defaultStatusBar } from './ui/status-bar';
import { defaultDiffViewManager } from './review/diff-view';

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

  // Stage 4: Inline Edit command (Cmd+Alt+K)
  const inlineEditCmd = vscode.commands.registerCommand('forge.inlineEdit', async () => {
    await defaultInlineEditController.trigger();
  });

  // Hunk review commands (CodeLens actions)
  const acceptHunkCmd = vscode.commands.registerCommand(
    'forge.acceptHunk',
    async (patchId: string, hunkId: string) => {
      await defaultInlineEditController.acceptHunk(patchId, hunkId);
    }
  );

  const rejectHunkCmd = vscode.commands.registerCommand(
    'forge.rejectHunk',
    async (patchId: string, hunkId: string) => {
      await defaultInlineEditController.rejectHunk(patchId, hunkId);
    }
  );

  // Agent Webview Panel
  const openPanelCmd = vscode.commands.registerCommand('forge.openPanel', () => {
    defaultAgentPanel.show();
  });

  // Cancel active run
  const cancelCmd = vscode.commands.registerCommand('forge.cancel', () => {
    const stats = defaultCancelManager.cancelAll();
    if (vscode.window.activeTextEditor) {
      defaultDiffViewManager.clearDecorations(vscode.window.activeTextEditor);
    }
    defaultCodeLensProvider.refresh();
    defaultStatusBar.setReady();
    vscode.window.showInformationMessage(
      `Forge: Run cancelled (${stats.cancelledPatches} patches discarded)`
    );
  });

  // Undo whole task
  const undoTaskCmd = vscode.commands.registerCommand('forge.undoTask', async () => {
    const res = await defaultUndoManager.undoTask();
    if (vscode.window.activeTextEditor) {
      defaultDiffViewManager.clearDecorations(vscode.window.activeTextEditor);
    }
    defaultCodeLensProvider.refresh();
    defaultStatusBar.setReady();
    vscode.window.showInformationMessage(
      `Forge: Whole task undone (${res.revertedFiles.length} file(s) reverted)`
    );
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

  // Register CodeLens provider for reviewing staged hunks
  const codeLensDisposable = vscode.languages.registerCodeLensProvider(
    { pattern: '**/*' },
    defaultCodeLensProvider
  );

  context.subscriptions.push(
    inlineEditCmd,
    acceptHunkCmd,
    rejectHunkCmd,
    openPanelCmd,
    cancelCmd,
    undoTaskCmd,
    copyMcpConfigCmd,
    codeLensDisposable,
    {
      dispose: () => {
        defaultStatusBar.dispose();
        defaultDiffViewManager.dispose();
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
