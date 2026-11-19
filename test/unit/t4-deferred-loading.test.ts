/**
 * test/unit/t4-deferred-loading.test.ts
 *
 * Verifies T4: Deferred tool loading in the live session (the B4 10-point anchor).
 * - createSession passes preload: false on agent.spec.mcpServers[0].preload by default.
 * - preload can be toggled to true if compaction is used instead.
 * - compaction config is properly attached when requested.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TrueForgeClient } from '../../src/trueforge/client';

describe('T4: Deferred tool loading in live session', () => {
  let mockSdk: any;
  let capturedSessionPayload: any;

  beforeEach(() => {
    capturedSessionPayload = null;
    mockSdk = {
      sessions: {
        create: vi.fn().mockImplementation(async (payload: any) => {
          capturedSessionPayload = payload;
          return { data: { id: 'sess-t4-test-123' } };
        }),
        createTurnStream: vi.fn().mockImplementation(async () => {
          async function* emptyStream() {}
          return emptyStream();
        })
      }
    };
  });

  it('createSession defaults to preload: false on mcpServers entry (deferred discovery)', async () => {
    const client = new TrueForgeClient({ baseUrl: 'http://localhost:8790' });
    vi.spyOn(client, 'getSdk').mockResolvedValue(mockSdk);

    const sessionId = await client.createSession();
    expect(sessionId).toBe('sess-t4-test-123');
    expect(mockSdk.sessions.create).toHaveBeenCalledTimes(1);

    const mcpServers = capturedSessionPayload?.agent?.spec?.mcpServers;
    expect(mcpServers).toBeDefined();
    expect(mcpServers).toHaveLength(1);
    expect(mcpServers[0].name).toBe('forge-workspace');
    expect(mcpServers[0].preload).toBe(false);
  });

  it('createSession respects explicit preload: true option', async () => {
    const client = new TrueForgeClient({ baseUrl: 'http://localhost:8790' });
    vi.spyOn(client, 'getSdk').mockResolvedValue(mockSdk);

    await client.createSession('ollama/qwen2-5-coder-7b', undefined, { preload: true });

    const mcpServers = capturedSessionPayload?.agent?.spec?.mcpServers;
    expect(mcpServers[0].preload).toBe(true);
  });

  it('createSession configures compaction when compaction: true is passed', async () => {
    const client = new TrueForgeClient({ baseUrl: 'http://localhost:8790' });
    vi.spyOn(client, 'getSdk').mockResolvedValue(mockSdk);

    await client.createSession('ollama/qwen2-5-coder-7b', undefined, { preload: true, compaction: true });

    const spec = capturedSessionPayload?.agent?.spec;
    expect(spec.mcpServers[0].preload).toBe(true);
    expect(spec.config?.contextManagement?.compaction).toBeDefined();
  });

  it('runTaskB invokes createSession with deferred tool loading', async () => {
    const client = new TrueForgeClient({ baseUrl: 'http://localhost:8790' });
    vi.spyOn(client, 'getSdk').mockResolvedValue(mockSdk);
    const createSessionSpy = vi.spyOn(client, 'createSession');

    await client.runTaskB('Add flask config command');

    expect(createSessionSpy).toHaveBeenCalled();
    const lastCall = createSessionSpy.mock.calls[0];
    const options = lastCall[2];
    expect(options?.preload ?? false).toBe(false);
  });
});
