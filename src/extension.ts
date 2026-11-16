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
import { defaultReviewManager } from './review/manager';
import { defaultTrueForgeClient } from './trueforge/client';

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

  // Hunk review commands (CodeLens and UI actions)
  const acceptHunkCmd = vscode.commands.registerCommand(
    'forge.acceptHunk',
    async (patchId: string, hunkId: string) => {
      try {
        await defaultReviewManager.acceptHunk(patchId, hunkId);
        defaultCodeLensProvider.refresh();
        vscode.window.showInformationMessage(`Forge: Accepted hunk ${hunkId}`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Forge: Failed to accept hunk: ${err.message}`);
      }
    }
  );

  const rejectHunkCmd = vscode.commands.registerCommand(
    'forge.rejectHunk',
    async (patchId: string, hunkId: string) => {
      try {
        defaultReviewManager.rejectHunk(patchId, hunkId);
        defaultCodeLensProvider.refresh();
        vscode.window.showInformationMessage(`Forge: Rejected hunk ${hunkId}`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Forge: Failed to reject hunk: ${err.message}`);
      }
    }
  );

  // Agent Webview Panel
  const openPanelCmd = vscode.commands.registerCommand('forge.openPanel', () => {
    defaultAgentPanel.show();
  });

  // Wire cancellation callback to TrueForge client
  defaultCancelManager.onCancel(async () => {
    await defaultTrueForgeClient.cancel();
  });

  // Cancel active run
  const cancelCmd = vscode.commands.registerCommand('forge.cancel', async () => {
    const stats = await defaultCancelManager.cancelAll();
    if (vscode.window.activeTextEditor) {
      defaultDiffViewManager.clearDecorations(vscode.window.activeTextEditor);
    }
    defaultCodeLensProvider.refresh();
    defaultReviewManager.updateStatusBar();
    vscode.window.showInformationMessage(stats.message);
  });

  // Undo whole task via inverse edits
  const undoTaskCmd = vscode.commands.registerCommand('forge.undoTask', async () => {
    const res = await defaultUndoManager.undoTask();
    if (vscode.window.activeTextEditor) {
      defaultDiffViewManager.clearDecorations(vscode.window.activeTextEditor);
    }
    defaultCodeLensProvider.refresh();
    defaultReviewManager.updateStatusBar();
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

  // Register virtual document content providers for native vscode.diff
  const contentProvider = defaultDiffViewManager.getContentProvider();
  const originalDocProvider = vscode.workspace.registerTextDocumentContentProvider(
    'forge-original',
    contentProvider
  );
  const proposedDocProvider = vscode.workspace.registerTextDocumentContentProvider(
    'forge-proposed',
    contentProvider
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
    originalDocProvider,
    proposedDocProvider,
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
