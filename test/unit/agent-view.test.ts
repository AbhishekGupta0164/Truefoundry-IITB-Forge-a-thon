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
    const client = new TrueForgeClient({ baseUrl: 'http://127.0.0.1:8790' });
    const panel = new AgentPanelProvider(undefined, client, undefined, new ContextLedger());
    panel.setExtensionUri((vscode as any).Uri.file('/ext'));
    const submit = vi.spyOn(panel, 'submitRawPrompt').mockResolvedValue();
    const { view, listeners, posted } = fakeView();
    panel.resolveWebviewView(view as any);

    await listeners[0]({ type: 'submit_prompt', prompt: 'Add a flask config command' });
    expect(submit).toHaveBeenCalledWith('Add a flask config command');

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
});
