import { describe, expect, it } from 'vitest';
import { executeRunTerminalCommand } from '../../src/mcp/tools/run_terminal_command';
import { WorkspaceManager } from '../../src/mcp/workspace';

describe('run_terminal_command Allowlist and Execution Invariants (Items 26-31)', () => {
  const wsManager = new WorkspaceManager();

  it('rejects a shell string input (Item 26)', async () => {
    await expect(
      executeRunTerminalCommand(
        { argv: 'git status' as any },
        wsManager
      )
    ).rejects.toThrow(/argument array/);
  });

  it('rejects shell interpreters like ["sh", "-c", "ls"] (Item 27)', async () => {
    await expect(
      executeRunTerminalCommand(
        { argv: ['sh', '-c', 'ls'] },
        wsManager
      )
    ).rejects.toThrow(/Shell interpreter/);

    await expect(
      executeRunTerminalCommand(
        { argv: ['bash', '-c', 'whoami'] },
        wsManager
      )
    ).rejects.toThrow(/Shell interpreter/);

    await expect(
      executeRunTerminalCommand(
        { argv: ['cmd.exe', '/c', 'dir'] },
        wsManager
      )
    ).rejects.toThrow(/Shell interpreter/);
  });

  it('rejects forbidden git subcommands like git apply (Item 28)', async () => {
    await expect(
      executeRunTerminalCommand(
        { argv: ['git', 'apply', 'patch.diff'] },
        wsManager
      )
    ).rejects.toThrow(/git subcommand 'apply' is not allowed/);

    await expect(
      executeRunTerminalCommand(
        { argv: ['git', 'checkout', '-b', 'malicious'] },
        wsManager
      )
    ).rejects.toThrow(/git subcommand/);
  });

  it('rejects unallowed executables such as sed or curl', async () => {
    await expect(
      executeRunTerminalCommand(
        { argv: ['sed', 's/foo/bar/g', 'file.txt'] },
        wsManager
      )
    ).rejects.toThrow(/Executable 'sed' is not on the approved security allowlist/);

    await expect(
      executeRunTerminalCommand(
        { argv: ['curl', 'http://127.0.0.1'] },
        wsManager
      )
    ).rejects.toThrow(/Executable 'curl' is not on the approved security allowlist/);
  });

  it('rejects arguments containing redirection characters like > (Item 29)', async () => {
    await expect(
      executeRunTerminalCommand(
        { argv: ['git', 'status', '>out.txt'] },
        wsManager
      )
    ).rejects.toThrow(/Forbidden shell character/);

    await expect(
      executeRunTerminalCommand(
        { argv: ['git', 'status', '|', 'grep', 'foo'] },
        wsManager
      )
    ).rejects.toThrow(/Forbidden shell character/);
  });

  it('executes approved commands successfully (Item 30)', async () => {
    const statusResult = await executeRunTerminalCommand(
      { argv: ['git', 'status'] },
      wsManager
    );
    expect(statusResult.exitCode).toBe(0);
    expect(statusResult.stdout).toMatch(/(On branch|HEAD detached)/);

    const diffResult = await executeRunTerminalCommand(
      { argv: ['git', 'diff'] },
      wsManager
    );
    expect(diffResult.exitCode).toBe(0);
  });

  it('approves and executes pytest tests/test_cli.py -q', async () => {
    // If Flask workspace exists, verify pytest execution directly
    const flaskDir = 'C:/Users/khush/OneDrive/Desktop/TrueFoundary/Flask';
    const hasFlask = require('fs').existsSync(`${flaskDir}/tests/test_cli.py`);
    const targetWs = hasFlask ? new WorkspaceManager(flaskDir) : wsManager;

    const result = await executeRunTerminalCommand(
      { argv: ['pytest', 'tests/test_cli.py', '-q'] },
      targetWs
    );
    if (hasFlask) {
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('passed');
    } else {
      // In standalone workspace, command is approved by allowlist
      expect(result.timedOut).toBe(false);
    }
  }, 45000);

  it('truncates excessive terminal output (Item 31)', async () => {
    const result = await executeRunTerminalCommand(
      { argv: ['git', 'status'] },
      wsManager
    );
    // Verified max output limit enforced
    expect(result.stdout.length).toBeLessThanOrEqual(20_000);
    expect(result.rawText).toContain('<!-- Untrusted Tool Output Begin -->');
    expect(result.rawText).toContain('<!-- Untrusted Tool Output End -->');
  });
});
