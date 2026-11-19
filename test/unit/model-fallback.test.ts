/**
 * test/unit/model-fallback.test.ts
 *
 * Task C resilience: when a run on the primary model fails before any tool call,
 * TrueForgeClient starts a new session on forge.fallbackModel and replays the same
 * request with no user action. It never replays after tool calls or a cancel, and
 * rejects model names that are not "provider/model".
 */

import { describe, it, expect, vi } from 'vitest';
import { TrueForgeClient, isQualifiedModelName, ModelFallbackInfo } from '../../src/trueforge/client';
import { SessionStateManager } from '../../src/trueforge/session-state';
import { ForgeEvent } from '../../src/shared/events';

type RawEvent = Record<string, unknown>;

const failedTurn = (message: string): RawEvent[] => [
  { type: 'turn.done', id: 'd-err', threadId: 't', createdAt: 'x', state: { status: 'error', completedAt: 'x', message } }
];
const okTurn = (text: string): RawEvent[] => [
  { type: 'model.message.delta', id: 'ok1', threadId: 't', content: text },
  { type: 'turn.done', id: 'ok2', threadId: 't', createdAt: 'x', state: { status: 'done', completedAt: 'x', output: null, requiredActions: [] } }
];

/**
 * Fake SDK where each model has its own scripted turn. A model mapped to an Error makes
 * createTurnStream throw (TrueForge unreachable for that model).
 */
function makeClient(byModel: Record<string, RawEvent[] | Error>, fallbackModel = 'ollama/llama-3-2-3b') {
  const sessionModel = new Map<string, string>();
  let n = 0;
  const create = vi.fn().mockImplementation(async (req: { agent: { spec: { model: { name: string } } } }) => {
    const id = `sess-${++n}`;
    sessionModel.set(id, req.agent.spec.model.name);
    return { data: { id } };
  });
  const createTurnStream = vi.fn().mockImplementation(async (sessionId: string) => {
    const script = byModel[sessionModel.get(sessionId) ?? ''];
    if (script instanceof Error) throw script;
    return (async function* () {
      for (const e of script ?? []) yield e;
    })();
  });
  const client = new TrueForgeClient(
    { baseUrl: 'http://127.0.0.1:8790', model: 'gemini/gemini-2-0-flash', fallbackModel },
    new SessionStateManager()
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).sdk = { sessions: { create, createTurnStream, cancel: vi.fn() } };
  const switches: ModelFallbackInfo[] = [];
  client.onModelFallback((info) => switches.push(info));
  return { client, create, switches };
}

async function collect(stream: AsyncIterable<ForgeEvent>): Promise<ForgeEvent[]> {
  const out: ForgeEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

const text = (events: ForgeEvent[]) =>
  events.filter((e) => e.type === 'token').map((e) => (e as { text: string }).text).join('');

describe('Second-model fallback', () => {
  it('switches to the fallback model when the primary turn fails before any tool call', async () => {
    const { client, create, switches } = makeClient({
      'gemini/gemini-2-0-flash': failedTurn('Invalid API key'),
      'ollama/llama-3-2-3b': okTurn('Edit proposed.')
    });

    const events = await collect(await client.runTaskB('add flask config'));

    expect(create.mock.calls.map((c) => c[0].agent.spec.model.name)).toEqual(['gemini/gemini-2-0-flash', 'ollama/llama-3-2-3b']);
    expect(switches).toEqual([{ from: 'gemini/gemini-2-0-flash', to: 'ollama/llama-3-2-3b', reason: 'Invalid API key' }]);
    expect(text(events)).toContain('Switched to fallback model ollama/llama-3-2-3b');
    expect(text(events)).toContain('Edit proposed.');
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(events[events.length - 1]).toMatchObject({ type: 'done', status: 'completed' });
    expect(client.getActiveModel()).toBe('ollama/llama-3-2-3b');
  });

  it('also falls back for inline edit when the primary endpoint cannot be reached at all', async () => {
    const { client, switches } = makeClient({
      'gemini/gemini-2-0-flash': new Error('fetch failed: connect ECONNREFUSED 127.0.0.1:9'),
      'ollama/llama-3-2-3b': okTurn('ok')
    });

    const events = await collect(await client.runTaskA({
      filePath: 'src/flask/helpers.py',
      selectionRange: { startLine: 27, startCol: 1, endLine: 40, endCol: 1 },
      selectedText: 'def get_debug_flag() -> bool:',
      instruction: "Treat 'off' and 'n' as false"
    }));

    expect(switches).toHaveLength(1);
    expect(switches[0].to).toBe('ollama/llama-3-2-3b');
    expect(events[events.length - 1]).toMatchObject({ type: 'done', status: 'completed' });
  }, 30000);

  it('reports the error instead of replaying once the agent has made a tool call', async () => {
    const { client, create, switches } = makeClient({
      'gemini/gemini-2-0-flash': [
        {
          type: 'model.message', id: 'm', threadId: 't', createdAt: 'x',
          toolCalls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"src/flask/cli.py"}' } }]
        },
        ...failedTurn('Provider returned 500')
      ],
      'ollama/llama-3-2-3b': okTurn('should not run')
    });

    const events = await collect(await client.runTaskB('add flask config'));

    expect(create).toHaveBeenCalledTimes(1);
    expect(switches).toHaveLength(0);
    expect(events.map((e) => e.type)).toEqual(['tool_call', 'error', 'done']);
    expect(events[2]).toMatchObject({ status: 'failed' });
  });

  it('does not fall back when no fallback model is configured', async () => {
    const { client, create, switches } = makeClient({ 'gemini/gemini-2-0-flash': failedTurn('Invalid API key') }, '');

    const events = await collect(await client.runTaskB('x'));

    expect(create).toHaveBeenCalledTimes(1);
    expect(switches).toHaveLength(0);
    expect(events.find((e) => e.type === 'error')).toMatchObject({ message: 'Invalid API key' });
  });

  it('does not fall back to the same model', async () => {
    const { client, create } = makeClient({ 'gemini/gemini-2-0-flash': failedTurn('down') }, 'gemini/gemini-2-0-flash');
    await collect(await client.runTaskB('x'));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('rejects a model name that is not provider/model before calling TrueForge', async () => {
    const { client, create } = makeClient({});
    await expect(client.createSession('qwen2.5-coder:7b')).rejects.toThrow(/must be "provider\/model"/);
    expect(create).not.toHaveBeenCalled();
  });

  it('recognises qualified model names', () => {
    expect(isQualifiedModelName('ollama/llama-3-2-3b')).toBe(true);
    expect(isQualifiedModelName('openai-main/gpt-4o-mini')).toBe(true);
    expect(isQualifiedModelName('qwen2.5-coder:7b')).toBe(false);
    expect(isQualifiedModelName('')).toBe(false);
    expect(isQualifiedModelName('/model')).toBe(false);
  });
});
