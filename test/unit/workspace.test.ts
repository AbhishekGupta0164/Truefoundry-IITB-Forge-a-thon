import { describe, expect, it } from 'vitest';
import { WorkspaceManager } from '../../src/mcp/workspace';
import * as path from 'path';

describe('WorkspaceManager Path Confinement', () => {
  const fixtureDir = path.resolve(__dirname, '../fixtures/mini-repo');
  const workspace = new WorkspaceManager(fixtureDir);

  it('resolves safe relative path', () => {
    const resolved = workspace.resolveSafePath('app.py');
    expect(resolved).toBe(path.join(fixtureDir, 'app.py'));
  });

  it('rejects path traversal with ..', () => {
    expect(() => workspace.resolveSafePath('../secret.txt')).toThrow(/Security violation/);
  });

  it('rejects sensitive files (.env)', () => {
    expect(() => workspace.resolveSafePath('.env')).toThrow(/Security violation/);
  });

  it('rejects .git path', () => {
    expect(() => workspace.resolveSafePath('.git/config')).toThrow(/Security violation/);
  });
});
