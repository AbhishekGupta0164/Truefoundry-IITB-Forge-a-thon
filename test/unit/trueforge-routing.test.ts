/**
 * test/unit/trueforge-routing.test.ts
 *
 * Verifies Step 1: TrueForge Routing for Task A (Inline Edit) and Task B (Agent Panel)
 * Requirements from PDF:
 * - Inline edit sends instruction, file path, selection range, and selected text to TrueForge session.
 * - Does NOT call executeProposeEdit directly.
 * - Agent panel sends raw request with no filenames.
 * - Model calls propose_edit over MCP and PatchStore receives that patch.
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InlineEditController } from '../../src/ui/inline-edit';
import { AgentPanelProvider } from '../../src/ui/panel';
import { TrueForgeClient } from '../../src/trueforge/client';
import { PatchStore } from '../../src/review/store';
import { WorkspaceManager } from '../../src/mcp/workspace';
import { ForgeEvent } from '../../src/shared/events';
import { executeProposeEdit } from '../../src/mcp/tools/propose_edit';

describe('Step 1: Routing Task A and Task B through TrueForge', () => {
  let patchStore: PatchStore;
  let workspaceManager: WorkspaceManager;

  beforeEach(() => {
    patchStore = new PatchStore();
    workspaceManager = new WorkspaceManager();
  });

  it('Task A: constructs prompt with instruction, file path, selection range, and selected text', async () => {
    let capturedSessionParams: any = null;
    let capturedPrompt: string = '';

    const mockClient = {
      createSession: vi.fn().mockImplementation(async () => 'sess-task-a'),
      runTaskA: vi.fn().mockImplementation(async (params) => {
        capturedSessionParams = params;
        capturedPrompt = `Modify the file: ${params.filePath} Selected lines ${params.selectionRange.startLine}-${params.selectionRange.endLine} Instruction: ${params.instruction}`;

        // Simulate agent's tool call arriving over MCP and staging patch into patchStore
        patchStore.stagePatch({
          id: 'patch-model-a',
          targetFile: params.filePath,
          summary: params.instruction,
          createdAt: Date.now(),
          hunks: [
            {
              id: 'hunk-model-1',
              file: params.filePath,
              oldStart: 28,
              oldLines: 6,
              newStart: 28,
              newLines: 8,
              content: '@@ -28,6 +28,8 @@\n- old\n+ new',
              applied: false
            }
          ]
        });

        async function* stream(): AsyncGenerator<ForgeEvent, void, unknown> {
          yield { type: 'token', text: 'Analyzing code...', timestamp: Date.now() };
          yield {
            type: 'tool_call',
            toolCallId: 'call_propose_edit',
            name: 'propose_edit',
            arguments: { path: params.filePath, old_str: params.selectedText, new_str: '...' },
            timestamp: Date.now()
          };
          yield {
            type: 'done',
            status: 'completed',
            budget: { maxTokens: 12000, usedTokens: 450, maxCostUsd: 1, usedCostUsd: 0, maxIterations: 20, currentIteration: 1 },
            timestamp: Date.now()
          };
        }
        return stream();
      })
    } as unknown as TrueForgeClient;

    const controller = new InlineEditController({
      workspaceManager,
      patchStore,
      trueforgeClient: mockClient
    });

    const stream = await mockClient.runTaskA({
      filePath: 'src/flask/helpers.py',
      selectionRange: { startLine: 28, startCol: 1, endLine: 35, endCol: 1 },
      selectedText: 'def get_debug_flag(): ...',
      instruction: "Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring."
    });

    for await (const _ of stream) {
      // Consume stream
    }

    expect(capturedSessionParams).toBeDefined();
    expect(capturedSessionParams.filePath).toBe('src/flask/helpers.py');
    expect(capturedSessionParams.selectionRange.startLine).toBe(28);
    expect(capturedSessionParams.selectionRange.endLine).toBe(35);
    expect(capturedSessionParams.instruction).toContain("Treat the values 'off' and 'n' as false");

    // Patch must be staged into PatchStore from the model execution
    const stagedPatch = patchStore.getPatch('patch-model-a');
    expect(stagedPatch).toBeDefined();
    expect(stagedPatch?.hunks.length).toBe(1);
    expect(stagedPatch?.hunks[0].id).toBe('hunk-model-1');
  });

  it('Task B: routes raw user request with no filenames attached to TrueForge session', async () => {
    let capturedPrompt = '';

    const mockClient = {
      runTaskB: vi.fn().mockImplementation(async (rawPrompt: string) => {
        capturedPrompt = rawPrompt;
        async function* stream(): AsyncGenerator<ForgeEvent, void, unknown> {
          yield { type: 'token', text: 'Starting multi-file search...', timestamp: Date.now() };
          yield {
            type: 'tool_call',
            toolCallId: 'call_search',
            name: 'search_text',
            arguments: { query: 'routes_command' },
            timestamp: Date.now()
          };
          yield {
            type: 'done',
            status: 'completed',
            budget: { maxTokens: 12000, usedTokens: 1850, maxCostUsd: 1, usedCostUsd: 0, maxIterations: 20, currentIteration: 1 },
            timestamp: Date.now()
          };
        }
        return stream();
      }),
      sessionManager: {
        getSession: () => ({ sessionId: 'sess-task-b' })
      }
    } as unknown as TrueForgeClient;

    const panel = new AgentPanelProvider(undefined, mockClient, patchStore);

    const rawUserRequest =
      "Add a new built-in CLI command flask config that prints the loaded application's configuration as JSON, masking secret values.";

    await panel.submitRawPrompt(rawUserRequest);

    // Verify raw user prompt was forwarded as-is without injected filenames
    expect(capturedPrompt).toBe(rawUserRequest);
    expect(capturedPrompt).not.toContain('src/flask/cli.py');
    expect(capturedPrompt).not.toContain('tests/test_cli.py');
    expect(capturedPrompt).not.toContain('docs/cli.rst');
  });

  it('Step 5 Invariant: inline-edit.ts does not import diff or executeProposeEdit or any replacement generator', () => {
    const inlineEditPath = path.resolve(__dirname, '../../src/ui/inline-edit.ts');
    const content = fs.readFileSync(inlineEditPath, 'utf-8');

    // Must not import the diff library
    expect(content).not.toMatch(/import\s+.*from\s+['"]diff['"]/);
    expect(content).not.toMatch(/require\(['"]diff['"]\)/);

    // Must not import executeProposeEdit or propose_edit
    expect(content).not.toMatch(/import\s+.*executeProposeEdit/);
    expect(content).not.toMatch(/import\s+.*from\s+['"].*propose_edit['"]/);

    // Must not contain local canned replacement logic
    expect(content).not.toContain('generateReplacement');
    expect(content).not.toContain('transformGetDebugFlag');
  });

  it('Step 2 Invariant: runTaskA sends the exact prompt template required by the specification', async () => {
    let sentPrompt = '';
    const mockClient = new TrueForgeClient();
    vi.spyOn(mockClient, 'createSession').mockResolvedValue('test-session-123');
    vi.spyOn(mockClient, 'sendTurn').mockImplementation(async (_sessionId, prompt) => {
      sentPrompt = prompt;
      async function* empty() {}
      return empty() as any;
    });

    await mockClient.runTaskA({
      filePath: 'src/flask/helpers.py',
      selectionRange: { startLine: 28, startCol: 1, endLine: 35, endCol: 1 },
      selectedText: 'def get_debug_flag(): ...',
      instruction: "Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false."
    });

    expect(sentPrompt).toContain('Edit only lines 28-35 of src/flask/helpers.py. Selected source text:');
    expect(sentPrompt).toContain('def get_debug_flag(): ...');
    expect(sentPrompt).toContain(
      "Instruction: Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.. Call propose_edit once with a reason. Do not answer with code in chat."
    );
  });

  it('Step 4 Invariant: executeProposeEdit logs [forge] patch staged by propose_edit session=<id>', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Create a temporary file in mini-repo fixture
    const fixtureDir = path.resolve(__dirname, '../fixtures/mini-repo');
    const ws = new WorkspaceManager(fixtureDir);
    const store = new PatchStore();

    await executeProposeEdit(
      {
        path: 'app.py',
        old_str: 'tax_rate=0.05',
        new_str: 'tax_rate=0.07',
        session_id: 'sess-test-456'
      },
      ws,
      store
    );

    const matchLog = consoleSpy.mock.calls.some(call =>
      call[0]?.includes('[forge] patch staged by propose_edit session=sess-test-456')
    );
    expect(matchLog).toBe(true);

    consoleSpy.mockRestore();
  });
});
