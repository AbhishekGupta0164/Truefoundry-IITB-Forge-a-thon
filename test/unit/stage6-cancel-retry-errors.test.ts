/**
 * test/unit/stage6-cancel-retry-errors.test.ts
 *
 * Verifies Step 3 (Stage 6) of TrueForge Build Plan:
 * - Cancellation lifecycle (calls cancel(), discards unapproved, prevents later apply, preserves applied)
 * - Connection retry mechanism (3 retries with exponential backoff, rate limit delay, immediate bad key fail)
 * - Single-sentence error message mapping (no stack traces)
 * - Session reconnection and event deduplication
 * - Agent loop guard (stops at 20 calls, stops at 3 identical consecutive calls)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CancelManager } from '../../src/review/cancel';
import { PatchStore } from '../../src/review/store';
import { withRetry, classifyError, isRetryable } from '../../src/trueforge/retry';
import { LoopGuard } from '../../src/trueforge/loop-guard';
import { SessionStateManager } from '../../src/trueforge/session-state';
import { StreamReconnector } from '../../src/trueforge/reconnect';
import {
  BadCredentialError,
  ModelUnreachableError,
  RateLimitedError,
  LoopGuardError,
  SessionCancelledError,
  getUserFacingErrorMessage
} from '../../src/shared/errors';
import { ForgeEvent } from '../../src/shared/events';

describe('Step 3 (Stage 6): Cancel, Retry, Errors, Reconnect, and Loop Guard', () => {
  let patchStore: PatchStore;
  let cancelManager: CancelManager;

  beforeEach(() => {
    patchStore = new PatchStore();
    cancelManager = new CancelManager(patchStore);
  });

  // ==========================================
  // A. Cancellation
  // ==========================================
  describe('A. Cancellation Lifecycle', () => {
    it('discards all unapproved patches while tracking stats', async () => {
      patchStore.stagePatch({
        id: 'patch-1',
        targetFile: 'src/flask/cli.py',
        summary: 'Add config command',
        createdAt: Date.now(),
        hunks: [
          {
            id: 'hunk-1',
            file: 'src/flask/cli.py',
            oldStart: 10,
            oldLines: 2,
            newStart: 10,
            newLines: 4,
            content: '@@ -10,2 +10,4 @@\n+ new code',
            applied: false
          }
        ]
      });

      const cancelHook = vi.fn().mockResolvedValue(undefined);
      cancelManager.onCancel(cancelHook);

      const stats = await cancelManager.cancelAll('session-123');

      expect(cancelHook).toHaveBeenCalledTimes(1);
      expect(stats.cancelledPatches).toBe(1);
      expect(stats.abandonedHunks).toBe(1);
      expect(stats.appliedHunks).toBe(0);
      expect(patchStore.getAllPatches().length).toBe(0);
      expect(stats.message).toContain('No files modified');
    });

    it('informs user if an approved hunk was already applied before cancel', async () => {
      patchStore.stagePatch({
        id: 'patch-2',
        targetFile: 'src/flask/cli.py',
        summary: 'Two hunk patch',
        createdAt: Date.now(),
        hunks: [
          {
            id: 'hunk-a',
            file: 'src/flask/cli.py',
            oldStart: 10,
            oldLines: 2,
            newStart: 10,
            newLines: 4,
            content: '@@ -10,2 +10,4 @@\n+ hunk a',
            applied: true // Already applied
          },
          {
            id: 'hunk-b',
            file: 'src/flask/cli.py',
            oldStart: 25,
            oldLines: 1,
            newStart: 25,
            newLines: 3,
            content: '@@ -25,1 +25,3 @@\n+ hunk b',
            applied: false // Unapproved
          }
        ]
      });

      const stats = await cancelManager.cancelAll('session-456');
      expect(stats.appliedHunks).toBe(1);
      expect(stats.abandonedHunks).toBe(1);
      expect(stats.message).toContain('Note: 1 previously approved hunk(s) were already applied');
    });

    it('refuses any later apply attempt on a cancelled patch', async () => {
      patchStore.stagePatch({
        id: 'patch-cancelled',
        targetFile: 'src/flask/helpers.py',
        summary: 'To cancel',
        createdAt: Date.now(),
        hunks: []
      });

      await cancelManager.cancelAll();

      expect(cancelManager.isCancelled('patch-cancelled')).toBe(true);
      expect(() => {
        cancelManager.assertNotCancelled('patch-cancelled');
      }).toThrowError(SessionCancelledError);
    });
  });

  // ==========================================
  // B. Retry Mechanism
  // ==========================================
  describe('B. Retry Mechanism', () => {
    it('retries temporary connection failures up to 3 times with backoff', async () => {
      let attempts = 0;
      const delaysRecorded: number[] = [];

      const mockOperation = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts <= 3) {
          throw new Error('fetch failed: ECONNREFUSED');
        }
        return 'success-after-retries';
      });

      const result = await withRetry(mockOperation, {
        policy: { maxRetries: 3, initialDelayMs: 10, backoffFactor: 2 },
        onRetry: (_att, delay) => delaysRecorded.push(delay)
      });

      expect(result).toBe('success-after-retries');
      expect(attempts).toBe(4); // 1 initial + 3 retries
      expect(delaysRecorded).toEqual([10, 20, 40]);
    });

    it('fails immediately with zero retries for invalid API keys (401/403)', async () => {
      let attempts = 0;
      const mockOp = vi.fn().mockImplementation(async () => {
        attempts++;
        throw new BadCredentialError();
      });

      await expect(
        withRetry(mockOp, { policy: { maxRetries: 3, initialDelayMs: 10 } })
      ).rejects.toThrow(BadCredentialError);

      expect(attempts).toBe(1); // No retries!
    });

    it('honors server-provided Retry-After delay for 429 rate limit responses', async () => {
      let attempts = 0;
      const delaysRecorded: number[] = [];

      const mockOp = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          const err = new RateLimitedError(0.05); // 50ms
          throw err;
        }
        return 'rate-limit-resolved';
      });

      const res = await withRetry(mockOp, {
        policy: { maxRetries: 2, initialDelayMs: 10 },
        onRetry: (_att, delay) => delaysRecorded.push(delay)
      });

      expect(res).toBe('rate-limit-resolved');
      expect(delaysRecorded[0]).toBe(50); // 50ms from retryAfter
    });
  });

  // ==========================================
  // C. Error Classification and Clean Messages
  // ==========================================
  describe('C. Single-Sentence User-Facing Error Messages', () => {
    it('maps ModelUnreachableError to clean plain sentence without stack trace', () => {
      const err = new ModelUnreachableError('http://127.0.0.1:9/v1');
      const msg = getUserFacingErrorMessage(err);
      expect(msg).toBe("Can't reach the model at http://127.0.0.1:9/v1. Check TrueForge settings.");
      expect(msg).not.toContain('\n');
      expect(msg).not.toContain('\n    at ');
    });

    it('maps BadCredentialError to clean single-sentence message', () => {
      const err = new BadCredentialError();
      const msg = getUserFacingErrorMessage(err);
      expect(msg).toBe('Authentication failed. Check your TrueForge API key.');
    });

    it('maps RateLimitedError to plain single-sentence message', () => {
      const errWithSecs = new RateLimitedError(30);
      expect(getUserFacingErrorMessage(errWithSecs)).toBe('Rate limit reached. Please retry after 30s.');

      const errGeneric = new RateLimitedError();
      expect(getUserFacingErrorMessage(errGeneric)).toBe('Rate limit reached. Please retry after the indicated delay.');
    });

    it('maps LoopGuardError cleanly without stack traces', () => {
      const err1 = new LoopGuardError('max_calls');
      expect(getUserFacingErrorMessage(err1)).toContain('exceeded maximum safety cap of 20 tool calls');

      const err2 = new LoopGuardError('repeated_call', 'read_file');
      expect(getUserFacingErrorMessage(err2)).toContain("tool call 'read_file' repeated 3 times in a row");
    });
  });

  // ==========================================
  // D. Session Reconnection and Deduplication
  // ==========================================
  describe('D. Session Reconnection and Deduplication', () => {
    it('persists session ID, turn ID, and last sequence number', () => {
      const state = new SessionStateManager();
      state.setSession('sess-100', 'turn-1');
      state.recordEvent('evt-1', 1);
      state.recordEvent('evt-2', 2);

      const active = state.getSession();
      expect(active?.sessionId).toBe('sess-100');
      expect(active?.turnId).toBe('turn-1');
      expect(active?.lastSequence).toBe(2);
    });

    it('deduplicates previously seen events', () => {
      const state = new SessionStateManager();
      state.setSession('sess-200');
      state.recordEvent('evt-abc', 1);

      expect(state.hasSeenEvent('evt-abc')).toBe(true);
      expect(state.hasSeenEvent('evt-xyz')).toBe(false);
    });

    it('rejoins dropped stream without starting a new session', async () => {
      const state = new SessionStateManager();
      state.setSession('sess-rejoin', 'turn-99');
      state.recordEvent('evt-5', 5);

      const fetchStreamMock = vi.fn().mockImplementation(async (sessId, lastSeq, turnId) => {
        expect(sessId).toBe('sess-rejoin');
        expect(lastSeq).toBe(5);
        expect(turnId).toBe('turn-99');
        async function* gen(): AsyncGenerator<ForgeEvent, void, unknown> {
          yield { type: 'token', text: 'reconnected token', timestamp: Date.now() };
        }
        return gen();
      });

      const reconnector = new StreamReconnector(state, fetchStreamMock);
      const stream = await reconnector.rejoin();

      const events: ForgeEvent[] = [];
      for await (const ev of stream) {
        events.push(ev);
      }

      expect(events.length).toBe(1);
      expect(events[0].type).toBe('token');
      expect(fetchStreamMock).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================
  // E. Agent Loop Guard
  // ==========================================
  describe('E. Agent Loop Guard', () => {
    it('stops execution after 20 tool calls', () => {
      const guard = new LoopGuard(20, 3);

      for (let i = 1; i <= 20; i++) {
        expect(() => {
          guard.recordAndCheck({ name: `tool_${i}`, arguments: { index: i } });
        }).not.toThrow();
      }

      expect(() => {
        guard.recordAndCheck({ name: 'tool_21', arguments: { index: 21 } });
      }).toThrowError(LoopGuardError);
    });

    it('stops execution if the same tool call repeats 3 times consecutively', () => {
      const guard = new LoopGuard(20, 3);

      guard.recordAndCheck({ name: 'search_text', arguments: { query: 'flask' } });
      guard.recordAndCheck({ name: 'search_text', arguments: { query: 'flask' } });

      expect(() => {
        guard.recordAndCheck({ name: 'search_text', arguments: { query: 'flask' } });
      }).toThrowError(LoopGuardError);
    });

    it('does not trigger repeat count when arguments differ', () => {
      const guard = new LoopGuard(20, 3);

      guard.recordAndCheck({ name: 'read_file', arguments: { path: 'a.py' } });
      guard.recordAndCheck({ name: 'read_file', arguments: { path: 'b.py' } });
      guard.recordAndCheck({ name: 'read_file', arguments: { path: 'c.py' } });

      expect(guard.getTotalCalls()).toBe(3);
    });
  });
});
