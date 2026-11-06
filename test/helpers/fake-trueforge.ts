/**
 * test/helpers/fake-trueforge.ts
 * Scripted fake TrueForge event generator to test UI and stream consumers
 * without requiring a live daemon.
 */

import { ForgeEvent } from '../../src/shared/events';

export async function* fakeEventStream(): AsyncGenerator<ForgeEvent, void, unknown> {
  const now = Date.now();

  yield {
    type: 'token',
    text: 'Inspecting workspace structure...',
    timestamp: now
  };

  yield {
    type: 'tool_call',
    toolCallId: 'call-101',
    name: 'search_text',
    arguments: { query: 'SECRET_KEY', reason: 'Audit secret definitions' },
    timestamp: now + 50
  };

  yield {
    type: 'tool_result',
    result: {
      toolCallId: 'call-101',
      name: 'search_text',
      success: true,
      output: 'demo/app.py:10: app.config["SECRET_KEY"] = ...'
    },
    timestamp: now + 150
  };

  yield {
    type: 'approval',
    requestId: 'req-001',
    action: 'apply_patch_hunk',
    requiresManualReview: true,
    timestamp: now + 250
  };

  yield {
    type: 'done',
    status: 'completed',
    budget: {
      maxTokens: 100000,
      usedTokens: 1250,
      maxCostUsd: 2.0,
      usedCostUsd: 0.02,
      maxIterations: 30,
      currentIteration: 2
    },
    timestamp: now + 400
  };
}
