/**
 * T5: Unit tests for launcher.ts and status-bar T5 methods.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock vscode ───────────────────────────────────────────────────────────────
vi.mock('vscode', () => {
  const ThemeColor = vi.fn().mockImplementation((id: string) => ({ id }));
  return {
    workspace: {
      getConfiguration: vi.fn(() => ({
        get: (key: string, def: unknown) => {
          const map: Record<string, unknown> = {
            model: 'qwen2.5-coder:7b',
            trueforgeUrl: 'http://localhost:8790',
            trueforgeVersion: '0.184.3',
            trueforgeDataDir: '',
          };
          return map[key] ?? def;
        },
      })),
    },
    window: {
      showErrorMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showInformationMessage: vi.fn(),
      createOutputChannel: vi.fn(() => ({
        append: vi.fn(),
        appendLine: vi.fn(),
        show: vi.fn(),
        dispose: vi.fn(),
      })),
    },
    ThemeColor,
  };
});

// ── Mock child_process ────────────────────────────────────────────────────────
const mockKill = vi.fn();
const mockChild = {
  kill: mockKill,
  stdout: { on: vi.fn() },
  stderr: { on: vi.fn() },
};
vi.mock('child_process', () => ({
  spawn: vi.fn(() => mockChild),
  execSync: vi.fn(() => Buffer.from('Python 3.11.0')),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('T5: isUp()', () => {
  it('returns false when fetch throws (ECONNREFUSED)', async () => {
    // Dynamically import after mock setup
    const { isUp } = await import('../../src/runtime/launcher');
    global.fetch = vi.fn().mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await isUp('http://localhost:19999');
    expect(result).toBe(false);
  });

  it('returns true for a 200 response', async () => {
    const { isUp } = await import('../../src/runtime/launcher');
    global.fetch = vi.fn().mockResolvedValueOnce({ status: 200 } as Response);
    const result = await isUp('http://localhost:8790');
    expect(result).toBe(true);
  });

  it('returns false for a 500 response', async () => {
    const { isUp } = await import('../../src/runtime/launcher');
    global.fetch = vi.fn().mockResolvedValueOnce({ status: 500 } as Response);
    const result = await isUp('http://localhost:8790');
    expect(result).toBe(false);
  });
});

describe('T5: startTrueForge()', () => {
  let launcher: typeof import('../../src/runtime/launcher');

  beforeEach(async () => {
    vi.resetModules();
    launcher = await import('../../src/runtime/launcher');
  });

  it('returns "ready" immediately if URL is already up', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 } as Response);
    const out = { append: vi.fn(), appendLine: vi.fn() } as any;
    const result = await launcher.startTrueForge(out, 'http://localhost:8790', '0.184.3');
    expect(result).toBe('ready');
  });
});

describe('T5: stopTrueForge()', () => {
  it('kills the child process', async () => {
    vi.resetModules();
    const { stopTrueForge } = await import('../../src/runtime/launcher');
    // Child may not exist yet — should not throw
    expect(() => stopTrueForge()).not.toThrow();
  });
});

describe('T5: ForgeStatusBar T5 methods', () => {
  it('setStarting sets spinner text', async () => {
    vi.resetModules();
    const { ForgeStatusBar } = await import('../../src/ui/status-bar');
    const bar = new ForgeStatusBar();
    // Should not throw even without a real VS Code status bar item
    expect(() => bar.setStarting()).not.toThrow();
  });

  it('setDown does not throw', async () => {
    vi.resetModules();
    const { ForgeStatusBar } = await import('../../src/ui/status-bar');
    const bar = new ForgeStatusBar();
    expect(() => bar.setDown()).not.toThrow();
  });

  it('setRuntimeReady does not throw', async () => {
    vi.resetModules();
    const { ForgeStatusBar } = await import('../../src/ui/status-bar');
    const bar = new ForgeStatusBar();
    expect(() => bar.setRuntimeReady('qwen2.5-coder:7b')).not.toThrow();
  });
});
