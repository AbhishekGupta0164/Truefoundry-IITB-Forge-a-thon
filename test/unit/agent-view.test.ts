/**
 * test/unit/agent-view.test.ts
 *
 * The agent chat as a side bar webview view: it must load the bundled script and styles
 * from <extension>/dist (otherwise the view renders blank), route webview messages to the
 * provider, and receive the provider's messages.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { AgentPanelProvider, setPanelVscodeApi } from '../../src/ui/panel';
import { TrueForgeClient } from '../../src/trueforge/client';
import { ContextLedger } from '../../src/context/ledger';
import { PatchStore } from '../../src/review/store';
import { defaultDiffViewManager } from '../../src/review/diff-view';

function fakeView() {
  const listeners: ((msg: any) => unknown)[] = [];
  const posted: unknown[] = [];
  const webview = {
    options: {} as Record<string, unknown>,
    html: '',
    cspSource: 'vscode-webview://test',
    asWebviewUri: (uri: { fsPath: string }) => ({ toString: () => `vscode-webview://test${uri.fsPath}` }),
    onDidReceiveMessage: (cb: (msg: any) => unknown) => { listeners.push(cb); return { dispose() {} }; },
    postMessage: async (m: unknown) => { posted.push(m); return true; }
  };
  const view = {
    viewType: AgentPanelProvider.sidebarViewId,
    webview,
    show: vi.fn(),
    onDidDispose: (_cb: () => void) => ({ dispose() {} })
  };
  return { view, webview, listeners, posted };
}

describe('Agent chat side bar view', () => {
  beforeAll(() => setPanelVscodeApi({ ...(vscode as any), commands: { ...(vscode as any).commands, executeCommand: vi.fn() } }));
  afterAll(() => setPanelVscodeApi(undefined));

  it('loads dist/webview.js and dist/styles.css with a nonce, and enables scripts', () => {
    const panel = new AgentPanelProvider(undefined, new TrueForgeClient({ baseUrl: 'http://127.0.0.1:8790' }), undefined, new ContextLedger());
    panel.setExtensionUri((vscode as any).Uri.file('/ext'));
    const { view, webview } = fakeView();

    panel.resolveWebviewView(view as any);

    expect(webview.options).toMatchObject({ enableScripts: true });
    expect(webview.html).toMatch(/<script nonce="[^"]+" src="vscode-webview:\/\/test\/ext\/dist\/webview\.js"><\/script>/);
    expect(webview.html).toContain('href="vscode-webview://test/ext/dist/styles.css"');
    expect(webview.html).toMatch(/script-src 'nonce-[^']+'/);
  });

  it('routes messages from the view to the provider and posts back to the view', async () => {
    const client = new TrueForgeClient({
      baseUrl: 'http://127.0.0.1:8791',
      model: 'google/gemini-live',
      fallbackModel: 'openai/gpt-live'
    });
    const panel = new AgentPanelProvider(undefined, client, undefined, new ContextLedger());
    panel.setExtensionUri((vscode as any).Uri.file('/ext'));
    const submit = vi.spyOn(panel, 'submitRawPrompt').mockResolvedValue();
    const { view, listeners, posted } = fakeView();
    panel.resolveWebviewView(view as any);

    await listeners[0]({ type: 'submit_prompt', prompt: 'Add a flask config command' });
    expect(submit).toHaveBeenCalledWith('Add a flask config command');

    await listeners[0]({ type: 'request_state' });
    expect(posted).toContainEqual({
      type: 'model_config',
      primary: 'google/gemini-live',
      fallback: 'openai/gpt-live',
      baseUrl: 'http://127.0.0.1:8791'
    });

    panel.postMessage({ type: 'token', text: 'hello' });
    expect(posted).toContainEqual({ type: 'token', text: 'hello' });
  });

  it('show() reveals the existing view instead of opening another panel', async () => {
    const panel = new AgentPanelProvider(undefined, new TrueForgeClient({ baseUrl: 'http://127.0.0.1:8790' }), undefined, new ContextLedger());
    const { view } = fakeView();
    panel.resolveWebviewView(view as any);
    await panel.show();
    expect(view.show).toHaveBeenCalledWith(false);
  });

  it('opens a real staged diff before rendering the apply approval request', async () => {
    const patchStore = new PatchStore();
    patchStore.stagePatch({
      id: 'patch-review-before-approval',
      targetFile: 'helpers.py',
      summary: 'test proposal',
      createdAt: Date.now(),
      initialContent: 'value = 1\n',
      hunks: [{
        id: 'hunk-review-before-approval', file: 'helpers.py', oldStart: 1, oldLines: 1,
        newStart: 1, newLines: 1, content: '-value = 1\n+value = 2', applied: false
      }]
    });
    const panel = new AgentPanelProvider(undefined, new TrueForgeClient(), patchStore, new ContextLedger());
    const order: string[] = [];
    panel.postMessage = (message) => { order.push(message.type); };
    const openDiff = vi.spyOn(defaultDiffViewManager, 'openDiffEditor').mockImplementation(async () => {
      order.push('diff_opened');
    });
    async function* stream() {
      yield { type: 'tool_result' as const, result: { toolCallId: 'propose-1', name: 'propose_edit', success: true, output: 'staged' }, timestamp: Date.now() };
      yield { type: 'approval' as const, requestId: 'apply-1', action: 'apply_patch_hunk', requiresManualReview: true, timestamp: Date.now() };
      yield { type: 'done' as const, status: 'completed' as const, budget: { maxTokens: 1, usedTokens: 1, maxCostUsd: 1, usedCostUsd: 0, maxIterations: 1, currentIteration: 1 }, timestamp: Date.now() };
    }

    await panel.consumeStream(stream());

    expect(order.indexOf('diff_opened')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('diff_opened')).toBeLessThan(order.indexOf('approval_required'));
    openDiff.mockRestore();
  });
});
