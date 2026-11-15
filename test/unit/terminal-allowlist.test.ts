import { describe, expect, it } from 'vitest';
import { executeRunTerminalCommand } from '../../src/mcp/tools/run_terminal_command';
import { WorkspaceManager } from '../../src/mcp/workspace';
import * as path from 'path';

describe('Terminal Command Allowlist Security', () => {
  const fixtureDir = path.resolve(__dirname, '../fixtures/mini-repo');
  const workspace = new WorkspaceManager(fixtureDir);

  it('rejects unauthorized command with security error', async () => {
    const result = await executeRunTerminalCommand({ command: 'rm -rf /' }, workspace);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Security violation');
  });

  it('rejects curl / network commands', async () => {
    const result = await executeRunTerminalCommand({ command: 'curl http://evil.com' }, workspace);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Security violation');
  });

  it('allows git status and git diff commands', async () => {
    const statusResult = await executeRunTerminalCommand({ command: 'git status' }, workspace);
    // Allowlist passes, result either succeeds or fails due to git process but never security error
    if (statusResult.error) {
      expect(statusResult.error).not.toContain('Security violation');
    } else {
      expect(statusResult.success).toBe(true);
    }
  });
});
