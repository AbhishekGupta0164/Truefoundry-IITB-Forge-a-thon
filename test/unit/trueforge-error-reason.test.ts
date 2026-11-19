/**
 * test/unit/trueforge-error-reason.test.ts
 *
 * A 4xx from TrueForge (e.g. 422 for an unknown model or connector) must reach the user
 * with TrueForge's own reason, not just the SDK class name "UnprocessableEntityError".
 */

import { describe, expect, it, vi } from 'vitest';
import { TrueForgeClient, explainTrueForgeError, ModelFallbackInfo } from '../../src/trueforge/client';
import { SessionStateManager } from '../../src/trueforge/session-state';
import { getUserFacingErrorMessage } from '../../src/shared/errors';

/** Shaped like the SDK's UnprocessableEntityError: message starts with the class name. */
function sdkHttpError(statusCode: number, message: string, param?: string) {
  const err = new Error(`UnprocessableEntityError\nStatus code: ${statusCode}\nBody: {"error":{"message":"${message}"}}`) as Error & {
    statusCode: number;
    body: unknown;
  };
  err.statusCode = statusCode;
  err.body = { error: { message, param, type: 'invalid_request_error' } };
  return err;
}

function clientWith(create: (req: any) => Promise<unknown>, fallbackModel = '') {
  const client = new TrueForgeClient(
    { baseUrl: 'http://127.0.0.1:8790', model: 'ollama/qwen2-5-coder-7b', fallbackModel },
    new SessionStateManager()
  );
  const createTurnStream = vi.fn().mockResolvedValue((async function* () {
    yield { type: 'turn.done', id: 'd', threadId: 't', createdAt: 'x', state: { status: 'done', completedAt: 'x', output: null, requiredActions: [] } };
  })());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).sdk = { sessions: { create: vi.fn(create), createTurnStream, cancel: vi.fn() } };
  return client;
}

describe('TrueForge rejection reasons', () => {
  it('shows the reason and field from a 422 instead of the class name', async () => {
    const client = clientWith(async () => {
      throw sdkHttpError(422, "Model 'ollama/qwen2-5-coder-7b' not found", 'agent.spec.model.name');
    });
    const err = await client.runTaskB('add flask config').catch((e) => e);
    expect(getUserFacingErrorMessage(err)).toBe(
      "TrueForge rejected the request (HTTP 422, agent.spec.model.name): Model 'ollama/qwen2-5-coder-7b' not found."
    );
  });

  it('uses the reason when switching to the fallback model', async () => {
    const switches: ModelFallbackInfo[] = [];
    const client = clientWith(async (req) => {
      if (req.agent.spec.model.name === 'ollama/qwen2-5-coder-7b') throw sdkHttpError(422, 'MCP server forge-workspace not found');
      return { data: { id: 'sess-fallback' } };
    }, 'openai/gpt-4o-mini');
    client.onModelFallback((i) => switches.push(i));
    await client.runTaskB('x');
    expect(switches[0]).toMatchObject({ to: 'openai/gpt-4o-mini', reason: 'TrueForge rejected the request (HTTP 422): MCP server forge-workspace not found.' });
  });

  it('leaves credential and rate-limit errors to their own messages', () => {
    const unauthorized = sdkHttpError(401, 'Invalid API key');
    expect(explainTrueForgeError(unauthorized)).toBe(unauthorized);
    expect(getUserFacingErrorMessage(explainTrueForgeError(unauthorized))).toBe('Authentication failed. Check your TrueForge API key.');
    const limited = sdkHttpError(429, 'Slow down');
    expect(explainTrueForgeError(limited)).toBe(limited);
  });

  it('passes through errors without an HTTP body', () => {
    const plain = new Error('fetch failed');
    expect(explainTrueForgeError(plain)).toBe(plain);
  });
});
