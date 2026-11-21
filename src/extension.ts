import * as vscode from 'vscode';
import { MCPAuthenticator } from './mcp/auth';
import { MCPServerManager } from './mcp/server';
import { defaultInlineEditController } from './ui/inline-edit';
import { AgentPanelProvider, defaultAgentPanel } from './ui/panel';
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

  // Demo Task A: stage the get_debug_flag edit directly (bypasses model for demo recording)
  const demoTaskACmd = vscode.commands.registerCommand('forge.demoTaskA', async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage('Forge: No workspace folder open');
      return;
    }
    const wsRoot = workspaceFolders[0].uri.fsPath;
    let relPath = 'src/flask/helpers.py';
    let absPath = require('path').join(wsRoot, relPath);
    if (!require('fs').existsSync(absPath)) {
      relPath = 'flask/src/flask/helpers.py';
      absPath = require('path').join(wsRoot, relPath);
    }
    if (!require('fs').existsSync(absPath)) {
      vscode.window.showErrorMessage(`Forge: Cannot find ${relPath} — open the Flask folder`);
      return;
    }

    const { executeProposeEdit } = await import('./mcp/tools/propose_edit.js');
    const { WorkspaceManager } = await import('./mcp/workspace.js');
    const { defaultPatchStore } = await import('./review/store.js');
    const wm = new WorkspaceManager(wsRoot);

    defaultStatusBar.setWorking('TrueForge: Staging Task A edit...');
    try {
      await executeProposeEdit(
        {
          path: relPath,
          old_str:
'def get_debug_flag() -> bool:\n    """Get whether debug mode should be enabled for the app, indicated by the\n    :envvar:`FLASK_DEBUG` environment variable. The default is ``False``.\n    """\n    val = os.environ.get("FLASK_DEBUG")\n    return bool(val and val.lower() not in {"0", "false", "no"})',
          new_str:
'def get_debug_flag() -> bool:\n    """Get whether debug mode should be enabled for the app, indicated by the\n    :envvar:`FLASK_DEBUG` environment variable. The default is ``False``.\n\n    Values treated as false are: ``"0"``, ``"false"``, ``"no"``, ``"off"``,\n    and ``"n"`` (case-insensitive).\n    """\n    val = os.environ.get("FLASK_DEBUG")\n    return bool(val and val.lower() not in {"0", "false", "no", "off", "n"})',
          reason: 'Treat off and n as false per task instruction'
        },
        wm,
        defaultPatchStore
      );

      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(absPath));
      const editor = await vscode.window.showTextDocument(doc);
      const patches = defaultPatchStore.getAllPatches();
      const patch = patches[patches.length - 1];
      if (patch && patch.hunks.length > 0) {
        defaultDiffViewManager.renderHunkDecorations(editor, patch.hunks);
        defaultCodeLensProvider.refresh();
        defaultStatusBar.setPendingReviews(patch.hunks.length);
        vscode.window.showInformationMessage(
          `Forge: Task A — ${patch.hunks.length} hunk(s) proposed. Click Accept above the green block.`
        );
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Forge Demo Task A: ${err.message}`);
      defaultStatusBar.setReady();
    }
  });

  // Hunk review commands (CodeLens and UI actions)
  const acceptHunkCmd = vscode.commands.registerCommand(
    'forge.acceptHunk',
    async (patchId: string, hunkId: string) => {
      try {
        // If the agent is paused waiting to apply this hunk, approve the TrueForge call
        // so the write happens through apply_patch_hunk on the harness side.
        if (await defaultAgentPanel.decideHunkApproval(patchId, hunkId, 'accept')) {
          defaultCodeLensProvider.refresh();
          vscode.window.showInformationMessage(`Forge: Approved hunk ${hunkId}`);
          return;
        }
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
        if (await defaultAgentPanel.decideHunkApproval(patchId, hunkId, 'reject')) {
          defaultCodeLensProvider.refresh();
          vscode.window.showInformationMessage(`Forge: Denied hunk ${hunkId}`);
          return;
        }
        defaultReviewManager.rejectHunk(patchId, hunkId);
        defaultCodeLensProvider.refresh();
        vscode.window.showInformationMessage(`Forge: Rejected hunk ${hunkId}`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Forge: Failed to reject hunk: ${err.message}`);
      }
    }
  );

  // Agent chat: a side bar view (Forge Agent icon in the activity bar; drag it to the
  // right-hand Secondary Side Bar for a Cursor-style layout). The webview loads its
  // script and styles from <extension>/dist, so it needs the extension URI.
  defaultAgentPanel.setExtensionUri(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(AgentPanelProvider.sidebarViewId, defaultAgentPanel, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );
  const openPanelCmd = vscode.commands.registerCommand('forge.openPanel', async () => {
    await defaultAgentPanel.show();
  });

  // Tell the user when a run switched to the fallback model (Task C resilience)
  const fallbackSub = defaultTrueForgeClient.onModelFallback((info) => {
    vscode.window.showWarningMessage(
      `Forge: ${info.from} failed (${info.reason}) Switched to fallback model ${info.to}.`
    );
  });
  context.subscriptions.push({ dispose: fallbackSub });

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
    demoTaskACmd,
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
