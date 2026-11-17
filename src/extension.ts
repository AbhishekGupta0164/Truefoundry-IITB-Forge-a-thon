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
import { startTrueForge, stopTrueForge, getLastLogLines } from './runtime/launcher';
import { runSelfTest } from './runtime/self-test';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

let mcpServerManager: MCPServerManager | null = null;

export async function activate(context: vscode.ExtensionContext) {
  console.log('Forge Agent extension is now active!');

  // ── T5: Runtime output channel ───────────────────────────────────────────
  const runtimeOut = vscode.window.createOutputChannel('Forge Runtime');

  /** Helper: run startTrueForge and update status bar. */
  async function doStartAll(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('forge');
    const url = cfg.get<string>('trueforgeUrl', 'http://localhost:8790');
    const version = cfg.get<string>('trueforgeVersion', '0.184.3');
    const model = cfg.get<string>('model', '');

    defaultStatusBar.setStarting();
    const result = await startTrueForge(runtimeOut, url, version);

    if (result === 'ready') {
      defaultStatusBar.setRuntimeReady(model);
    } else if (result === 'migration-error') {
      defaultStatusBar.setDown();
      const choice = await vscode.window.showWarningMessage(
        'TrueForge migration error — data directory incompatible.',
        'Reset TrueForge data'
      );
      if (choice === 'Reset TrueForge data') {
        const dataDir =
          cfg.get<string>('trueforgeDataDir', '') ||
          path.join(os.homedir(), '.trueforge');
        const bakDir = dataDir + '.bak';
        try {
          if (fs.existsSync(bakDir)) {
            fs.rmSync(bakDir, { recursive: true, force: true });
          }
          fs.renameSync(dataDir, bakDir);
          runtimeOut.appendLine(`[Forge] Renamed ${dataDir} → ${bakDir}`);
          await doStartAll(); // retry after reset
        } catch (e: any) {
          vscode.window.showErrorMessage(`Forge: Failed to reset data dir: ${e.message}`);
        }
      }
    } else {
      // timeout
      defaultStatusBar.setDown();
      const lastLog = getLastLogLines();
      vscode.window.showErrorMessage(
        `Forge: TrueForge did not start within 60 s.\n\nLast log:\n${lastLog}`
      );
    }
  }

  // Initialize and start MCP Server
  const authenticator = new MCPAuthenticator(context.secrets);
  mcpServerManager = new MCPServerManager(authenticator);

  const config = vscode.workspace.getConfiguration('forge');
  const port = config.get<number>('mcpPort', 8765);

  // ── T5: Auto-start TrueForge ─────────────────────────────────────────────
  const autoStart = config.get<boolean>('autoStart', true);
  if (autoStart) {
    doStartAll().catch(console.error);
  }

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

  // Cancel active run (T6: one-gesture undo, AbortController, panel update)
  const cancelCmd = vscode.commands.registerCommand('forge.cancel', async () => {
    // 1. Immediately abort running tasks, call sessions.cancel, discard unapplied patches
    const stats = defaultCancelManager.cancelAll();

    // 2. Show 'Cancelled' in panel within one second
    defaultAgentPanel.postMessage({ type: 'run_completed', status: 'cancelled' });

    // 3. Clear diff view decorations & update status bar
    if (vscode.window.activeTextEditor) {
      defaultDiffViewManager.clearDecorations(vscode.window.activeTextEditor);
    }
    defaultCodeLensProvider.refresh();
    defaultReviewManager.clear();
    defaultReviewManager.updateStatusBar();

    // 4. If any hunks were already applied, show notification with Undo/Keep
    if (stats.appliedHunks > 0) {
      const choice = await vscode.window.showInformationMessage(
        `${stats.appliedHunks} hunks were already applied. Undo them?`,
        'Undo',
        'Keep'
      );
      if (choice === 'Undo') {
        await vscode.commands.executeCommand('forge.undoTask');
      }
    } else {
      vscode.window.showInformationMessage(stats.message);
    }
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

  // ── T5: Runtime commands ─────────────────────────────────────────────────

  const startAllCmd = vscode.commands.registerCommand('forge.startAll', async () => {
    await doStartAll();
  });

  const stopAllCmd = vscode.commands.registerCommand('forge.stopAll', () => {
    stopTrueForge();
    defaultStatusBar.setDown();
    vscode.window.showInformationMessage('Forge: TrueForge stopped.');
  });

  const selfTestCmd = vscode.commands.registerCommand('forge.selfTest', async () => {
    await runSelfTest();
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
    startAllCmd,
    stopAllCmd,
    selfTestCmd,
    copyMcpConfigCmd,
    codeLensDisposable,
    originalDocProvider,
    proposedDocProvider,
    runtimeOut,
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
  stopTrueForge();
  if (mcpServerManager) {
    await mcpServerManager.stop();
    mcpServerManager = null;
  }
}
