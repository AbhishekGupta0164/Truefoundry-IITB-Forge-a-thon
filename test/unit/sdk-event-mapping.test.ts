/**
 * test/unit/sdk-event-mapping.test.ts
 *
 * Verifies that TrueForgeClient maps the real @truefoundry/trueforge-sdk v0.184 turn
 * events (model.message.delta, model.message, tool.response, tool.approval_required,
 * turn.done) to ForgeEvents, and that approval decisions resume the paused turn with
 * `user.tool_approval` input items through sessions.createTurnStream.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TrueForgeClient, parseToolArguments, resolveToolName } from '../../src/trueforge/client';
import { SessionStateManager } from '../../src/trueforge/session-state';
import { AgentPanelProvider } from '../../src/ui/panel';
import { ForgeEvent } from '../../src/shared/events';

type RawEvent = Record<string, unknown>;

function streamOf(events: RawEvent[]): AsyncIterable<RawEvent> {
  return (async function* () {
    for (const e of events) yield e;
  })();
}

function makeFakeSdk(turns: RawEvent[][]) {
  const createTurnStream = vi.fn().mockImplementation(async () => streamOf(turns.shift() ?? []));
  return {
    createTurnStream,
    sdk: {
      sessions: {
        create: vi.fn().mockResolvedValue({ data: { id: 'sess-1' } }),
        createTurnStream,
        cancel: vi.fn().mockResolvedValue({})
      }
    }
  };
}

function makeClient(turns: RawEvent[][]) {
  const fake = makeFakeSdk(turns);
  const client = new TrueForgeClient({ baseUrl: 'http://127.0.0.1:8790', fallbackModel: undefined }, new SessionStateManager());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).sdk = fake.sdk;
  return { client, ...fake };
}

async function collect(stream: AsyncIterable<ForgeEvent>): Promise<ForgeEvent[]> {
  const out: ForgeEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

const toolCall = (id: string, name: string, args: Record<string, unknown>) => ({
  id,
  type: 'function',
  function: { name: `forge-workspace__${name}`, arguments: JSON.stringify(args) },
  toolInfo: { type: 'mcp', name, serverId: 'srv-1', serverName: 'forge-workspace' }
});

describe('TrueForge SDK event mapping', () => {
  it('streams delta content, tool calls, tool responses and turn completion', async () => {
    const { client } = makeClient([[
      { type: 'model.message.delta', id: 'e1', threadId: 't1', content: 'Search' },
      { type: 'model.message.delta', id: 'e2', threadId: 't1', content: 'ing...' },
      {
        type: 'model.message', id: 'e3', threadId: 't1', createdAt: 'x',
        toolCalls: [toolCall('call-1', 'search_text', { query: 'def get_debug_flag', reason: 'locate the function' })],
        usage: { inputTokens: 100, outputTokens: 20 }
      },
      { type: 'tool.response', id: 'e4', threadId: 't1', createdAt: 'x', toolCallId: 'call-1', content: 'src/flask/helpers.py:27' },
      { type: 'turn.done', id: 'e5', threadId: 't1', createdAt: 'x', state: { status: 'done', completedAt: 'x', output: null, requiredActions: [] } }
    ]]);

    const sessionId = await client.createSession();
    const events = await collect(await client.sendTurn(sessionId, 'find it'));

    const tokens = events.filter((e) => e.type === 'token').map((e) => (e as { text: string }).text);
    expect(tokens.join('')).toBe('Searching...');

    const call = events.find((e) => e.type === 'tool_call');
    expect(call).toMatchObject({
      toolCallId: 'call-1',
      name: 'search_text',
      arguments: { query: 'def get_debug_flag', reason: 'locate the function' }
    });

    const result = events.find((e) => e.type === 'tool_result');
    expect(result).toMatchObject({ result: { toolCallId: 'call-1', name: 'search_text', success: true, output: 'src/flask/helpers.py:27' } });

    const done = events[events.length - 1];
    expect(done).toMatchObject({ type: 'done', status: 'completed', budget: { usedTokens: 120 } });
  });

  it('turns a failed turn into a clear error followed by a failed done', async () => {
    const { client } = makeClient([[
      { type: 'turn.done', id: 'e1', threadId: 't1', createdAt: 'x', state: { status: 'error', completedAt: 'x', message: 'Connection refused' } }
    ]]);
    const sessionId = await client.createSession();
    const events = await collect(await client.sendTurn(sessionId, 'go'));
    expect(events.map((e) => e.type)).toEqual(['error', 'done']);
    expect(events[0]).toMatchObject({ code: 'TURN_FAILED', message: 'Connection refused' });
    expect(events[1]).toMatchObject({ status: 'failed' });
  });

  it('maps a cancelled turn to a cancelled done', async () => {
    const { client } = makeClient([[
      { type: 'turn.done', id: 'e1', threadId: 't1', createdAt: 'x', state: { status: 'cancelled', completedAt: 'x', reason: 'user' } }
    ]]);
    const sessionId = await client.createSession();
    const events = await collect(await client.sendTurn(sessionId, 'go'));
    expect(events).toEqual([expect.objectContaining({ type: 'done', status: 'cancelled' })]);
  });

  it('prefers the MCP tool name and keeps malformed arguments visible', () => {
    expect(resolveToolName({ id: 'a', function: { name: 'srv__read_file' }, toolInfo: { type: 'mcp', name: 'read_file' } })).toBe('read_file');
    expect(resolveToolName({ id: 'a', function: { name: 'read_file' } })).toBe('read_file');
    expect(parseToolArguments('{"path":"a.py"}')).toEqual({ path: 'a.py' });
    expect(parseToolArguments('{bad')).toEqual({ _unparsedArguments: '{bad' });
    expect(parseToolArguments(undefined)).toEqual({});
  });
});

describe('Approval resume through sessions.createTurnStream', () => {
  const approvalTurn = (ids: { id: string; name: string; args: Record<string, unknown> }[]): RawEvent[] => [
    { type: 'model.message', id: 'm1', threadId: 'thread-main', createdAt: 'x', toolCalls: ids.map((c) => toolCall(c.id, c.name, c.args)) },
    { type: 'tool.approval_required', id: 'a1', threadId: 'thread-main', createdAt: 'x', toolCalls: ids.map((c) => ({ id: c.id, sourceEventId: 'm1' })) },
    { type: 'turn.done', id: 'd1', threadId: 'thread-main', createdAt: 'x', state: { status: 'done', completedAt: 'x', output: null, requiredActions: [] } }
  ];
  const resumedTurn: RawEvent[] = [
    { type: 'tool.response', id: 'r1', threadId: 'thread-main', createdAt: 'x', toolCallId: 'call-t', content: 'denied' },
    { type: 'turn.done', id: 'd2', threadId: 'thread-main', createdAt: 'x', state: { status: 'done', completedAt: 'x', output: null, requiredActions: [] } }
  ];

  let client: TrueForgeClient;
  let createTurnStream: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ client, createTurnStream } = makeClient([
      approvalTurn([{ id: 'call-t', name: 'run_terminal_command', args: { argv: ['pytest', 'tests/test_cli.py', '-q'] } }]),
      resumedTurn
    ]));
  });

  it('emits one approval event per paused tool call, keyed by the SDK tool call id', async () => {
    const sessionId = await client.createSession();
    const events = await collect(await client.sendTurn(sessionId, 'run tests'));
    const approval = events.find((e) => e.type === 'approval');
    expect(approval).toMatchObject({ requestId: 'call-t', action: 'run_terminal_command' });
    expect(client.getPendingApprovalIds()).toEqual(['call-t']);
  });

  it('resumes with a user.tool_approval input item and no user message', async () => {
    const sessionId = await client.createSession();
    await collect(await client.sendTurn(sessionId, 'run tests'));

    const resumed = await client.decideApproval(sessionId, 'call-t', 'reject', 'Not now');
    expect(resumed).not.toBeNull();
    expect(createTurnStream).toHaveBeenLastCalledWith('sess-1', {
      input: [{
        type: 'user.tool_approval',
        threadId: 'thread-main',
        toolCallId: 'call-t',
        approval: { status: 'deny', reason: 'Not now' }
      }]
    });

    const events = await collect(resumed!);
    expect(events[events.length - 1]).toMatchObject({ type: 'done', status: 'completed' });
    expect(client.getPendingApprovalIds()).toEqual([]);
  });

  it('waits for every call in a batch before resuming once with all decisions', async () => {
    ({ client, createTurnStream } = makeClient([
      approvalTurn([
        { id: 'call-a', name: 'run_terminal_command', args: { argv: ['git', 'status'] } },
        { id: 'call-b', name: 'run_terminal_command', args: { argv: ['git', 'diff'] } }
      ]),
      resumedTurn
    ]));
    const sessionId = await client.createSession();
    await collect(await client.sendTurn(sessionId, 'check'));
    const callsBefore = createTurnStream.mock.calls.length;

    expect(await client.decideApproval(sessionId, 'call-a', 'accept')).toBeNull();
    expect(createTurnStream.mock.calls.length).toBe(callsBefore);

    expect(await client.decideApproval(sessionId, 'call-b', 'accept')).not.toBeNull();
    const input = createTurnStream.mock.calls[createTurnStream.mock.calls.length - 1][1].input;
    expect(input.map((i: { toolCallId: string; approval: { status: string } }) => [i.toolCallId, i.approval.status]))
      .toEqual([['call-a', 'allow'], ['call-b', 'allow']]);
  });

  it('denies an apply_patch_hunk approval for a hunk the reviewer has never seen', async () => {
    ({ client, createTurnStream } = makeClient([
      approvalTurn([{ id: 'call-w', name: 'apply_patch_hunk', args: { patch_id: 'p-unknown', hunk_id: 'h-unknown' } }]),
      resumedTurn
    ]));
    const sessionId = await client.createSession();
    await collect(await client.sendTurn(sessionId, 'write'));

    await client.decideApproval(sessionId, 'call-w', 'accept');
    const input = createTurnStream.mock.calls[createTurnStream.mock.calls.length - 1][1].input;
    expect(input[0]).toMatchObject({ toolCallId: 'call-w', approval: { status: 'deny' } });
  });

  it('rejects a decision for a tool call that is not paused', async () => {
    const sessionId = await client.createSession();
    await expect(client.decideApproval(sessionId, 'call-missing', 'accept')).rejects.toThrow(/No pending approval/);
  });
});

describe('Agent panel approval flow', () => {
  it('keeps the run open while paused, then renders the resumed turn after a decision', async () => {
    const { client } = makeClient([
      [
        { type: 'model.message', id: 'm1', threadId: 'th', createdAt: 'x', toolCalls: [toolCall('call-t', 'run_terminal_command', { argv: ['git', 'status'] })] },
        { type: 'tool.approval_required', id: 'a1', threadId: 'th', createdAt: 'x', toolCalls: [{ id: 'call-t', sourceEventId: 'm1' }] },
        { type: 'turn.done', id: 'd1', threadId: 'th', createdAt: 'x', state: { status: 'done', completedAt: 'x', output: null, requiredActions: [] } }
      ],
      [
        { type: 'model.message.delta', id: 'r0', threadId: 'th', content: 'Done.' },
        { type: 'turn.done', id: 'd2', threadId: 'th', createdAt: 'x', state: { status: 'done', completedAt: 'x', output: null, requiredActions: [] } }
      ]
    ]);
    const panel = new AgentPanelProvider(undefined, client);
    const posted: { type: string; [k: string]: unknown }[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    panel.postMessage = (msg: any) => { posted.push(msg); };

    await panel.submitRawPrompt('check the repo');
    expect(posted.find((m) => m.type === 'approval_required')).toMatchObject({
      requestId: 'call-t',
      toolName: 'run_terminal_command',
      args: { argv: ['git', 'status'] }
    });
    expect(posted.some((m) => m.type === 'run_completed')).toBe(false);

    await panel.handleIncomingMessage({
      type: 'approve_tool',
      requestId: 'call-t',
      decision: { hunkId: 'call-t', decision: 'accept', timestamp: Date.now() }
    });
    expect(posted.some((m) => m.type === 'token' && m.text === 'Done.')).toBe(true);
    expect(posted[posted.length - 1]).toMatchObject({ type: 'run_completed', status: 'completed' });
  });

  it('routes CodeLens decisions to a paused apply_patch_hunk call for that hunk only', async () => {
    const { client } = makeClient([[
      { type: 'model.message', id: 'm1', threadId: 'th', createdAt: 'x', toolCalls: [toolCall('call-w', 'apply_patch_hunk', { patch_id: 'p1', hunk_id: 'h1' })] },
      { type: 'tool.approval_required', id: 'a1', threadId: 'th', createdAt: 'x', toolCalls: [{ id: 'call-w', sourceEventId: 'm1' }] }
    ], []]);
    const panel = new AgentPanelProvider(undefined, client);
    panel.postMessage = () => undefined;
    await panel.submitRawPrompt('edit');

    expect(await panel.decideHunkApproval('p1', 'h-other', 'reject')).toBe(false);
    expect(await panel.decideHunkApproval('p1', 'h1', 'reject')).toBe(true);
    expect(client.getPendingApprovalIds()).toEqual([]);
  });
});
