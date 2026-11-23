/**
 * test/unit/mention-context.test.ts
 *
 * Explicit @file / @symbol mentions in agent mode become context for the agent, within
 * the retrieved-context budget, and show up in the context map. A prompt without
 * mentions is sent exactly as typed, with no filenames added.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMentionContext, parseMentions } from '../../src/context/mentions';
import { ContextLedger } from '../../src/context/ledger';
import { WorkspaceManager } from '../../src/mcp/workspace';
import { AgentPanelProvider } from '../../src/ui/panel';
import { TrueForgeClient } from '../../src/trueforge/client';

let root: string;
let ws: WorkspaceManager;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-mentions-'));
  fs.mkdirSync(path.join(root, 'src', 'pkg'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'src', 'pkg', 'cli.py'),
    ['import click', '', '', 'def routes_command():', '    """Show routes."""', '    return 1', ''].join('\n')
  );
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=1\n');
  ws = new WorkspaceManager(root);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('parseMentions', () => {
  it('accepts the editor shorthand @path/file.ext as a file mention', () => {
    const parsed = parseMentions('Update @src/pkg/cli.py and keep tests green.');
    expect(parsed.files).toEqual(['src/pkg/cli.py']);
    expect(parsed.cleanPrompt).toBe('Update and keep tests green.');
  });

  it('does not treat an e-mail style or bare @word as a file', () => {
    expect(parseMentions('ping @team about it').files).toEqual([]);
  });
});

describe('buildMentionContext', () => {
  it('leaves a prompt without mentions untouched and adds no context', async () => {
    const prompt = 'Add a new built-in CLI command flask config that prints the loaded configuration.';
    const ctx = await buildMentionContext(prompt, ws, new ContextLedger());
    expect(ctx.prompt).toBe(prompt);
    expect(ctx.contextSummary).toBe('');
    expect(ctx.entries).toEqual([]);
  });

  it('includes a mentioned file and a mentioned symbol, and records why', async () => {
    const ledger = new ContextLedger();
    const ctx = await buildMentionContext('Change @file:src/pkg/cli.py so that @symbol:routes_command sorts output', ws, ledger);

    expect(ctx.prompt).toBe('Change so that sorts output');
    expect(ctx.contextSummary).toContain('### @file: src/pkg/cli.py (lines 1-7 of 7)');
    expect(ctx.contextSummary).toContain('### @symbol routes_command: src/pkg/cli.py');
    expect(ctx.contextSummary).toContain('def routes_command():');
    expect(ctx.entries.map((e) => e.type)).toEqual(['file', 'symbol']);
    expect(ledger.getEntries().every((e) => e.reason.startsWith('mentioned by the user'))).toBe(true);
  });

  it('reports mentions it cannot use instead of dropping them silently', async () => {
    const ctx = await buildMentionContext('Look at @src/pkg/missing.py and @file:.env and @symbol:no_such_fn', ws, new ContextLedger());
    const reasons = Object.fromEntries(ctx.unresolved.map((u) => [u.mention, u.reason]));
    expect(reasons['@src/pkg/missing.py']).toMatch(/not found/);
    expect(reasons['@.env']).toMatch(/denied|Security/i);
    expect(reasons['@symbol:no_such_fn']).toMatch(/no definition/);
    expect(ctx.contextSummary).toBe('');
  });
});

describe('Agent panel sends mentions as context', () => {
  it('passes the resolved context to TrueForge and shows it in the context map', async () => {
    const client = new TrueForgeClient({ baseUrl: 'http://127.0.0.1:8790' });
    const runTaskB = vi.spyOn(client, 'runTaskB').mockResolvedValue((async function* () {
      yield { type: 'done' as const, status: 'completed' as const, budget: { maxTokens: 1, usedTokens: 0, maxCostUsd: 0, usedCostUsd: 0, maxIterations: 1, currentIteration: 1 }, timestamp: 0 };
    })());
    const panel = new AgentPanelProvider(undefined, client, undefined, new ContextLedger(), ws);
    const posted: { type: string; [k: string]: unknown }[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    panel.postMessage = (m: any) => { posted.push(m); };

    await panel.submitRawPrompt('Rename the command in @src/pkg/cli.py');

    expect(runTaskB).toHaveBeenCalledWith('Rename the command in', expect.stringContaining('### @file: src/pkg/cli.py'));
    expect(posted[0]).toEqual({ type: 'run_started' });
    expect(posted.find((m) => m.type === 'context_update')).toMatchObject({ entries: [expect.objectContaining({ uri: 'src/pkg/cli.py' })] });
    expect(posted[posted.length - 1]).toEqual({ type: 'run_completed', status: 'completed' });
  });

  it('sends a mention-free prompt as typed with no context block', async () => {
    const client = new TrueForgeClient({ baseUrl: 'http://127.0.0.1:8790' });
    const runTaskB = vi.spyOn(client, 'runTaskB').mockResolvedValue((async function* () { /* empty run */ })());
    const panel = new AgentPanelProvider(undefined, client, undefined, new ContextLedger(), ws);
    panel.postMessage = () => undefined;
    await panel.submitRawPrompt('Add a flask config command');
    expect(runTaskB).toHaveBeenCalledWith('Add a flask config command', undefined);
  });
});
