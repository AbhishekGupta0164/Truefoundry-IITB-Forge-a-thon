import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkspaceManager } from '../../src/mcp/workspace';

describe('Workspace Security and Confinement (Items 6-13)', () => {
  let tempWorkspace: string;
  let outsideDir: string;
  let workspaceManager: WorkspaceManager;

  beforeAll(() => {
    // Create temporary workspace directory
    tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-workspace-test-'));
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-outside-test-'));

    // Create sample valid file inside workspace
    fs.mkdirSync(path.join(tempWorkspace, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tempWorkspace, 'src', 'app.ts'), 'export const app = 1;');

    // Create outside file
    fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'SUPER_SECRET_OUTSIDE');

    // Create a symlink to outside file inside workspace (if os permits)
    try {
      fs.symlinkSync(
        path.join(outsideDir, 'secret.txt'),
        path.join(tempWorkspace, 'symlink-escape.txt')
      );
    } catch {
      // Symlinks may require admin on Windows; if not allowed, fallback
    }

    // Create a symlinked directory pointing outside
    try {
      fs.symlinkSync(
        outsideDir,
        path.join(tempWorkspace, 'symlink-dir-escape'),
        'junction'
      );
    } catch {
      // Junction/symlink fallback
    }

    workspaceManager = new WorkspaceManager(tempWorkspace);
  });

  afterAll(() => {
    try {
      fs.rmSync(tempWorkspace, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    } catch {
      // Cleanup best-effort
    }
  });

  it('resolves safe workspace-relative paths correctly', () => {
    const resolved = workspaceManager.resolveSafePath('src/app.ts');
    expect(resolved).toBe(path.join(tempWorkspace, 'src', 'app.ts'));
  });

  it('rejects path traversal with .. (Item 6)', () => {
    expect(() => workspaceManager.resolveSafePath('../secret.txt')).toThrow(/Security violation/);
    expect(() => workspaceManager.resolveSafePath('src/../../outside.txt')).toThrow(/Security violation/);
    expect(() => workspaceManager.resolveSafePath('..')).toThrow(/Security violation/);
  });

  it('rejects absolute paths outside the workspace (Item 7)', () => {
    const outsideFile = path.join(outsideDir, 'secret.txt');
    expect(() => workspaceManager.resolveSafePath(outsideFile)).toThrow(/Security violation/);
  });

  it('rejects Windows-style traversal and drive paths (Item 8)', () => {
    expect(() => workspaceManager.resolveSafePath('..\\..\\secret.txt')).toThrow(/Security violation/);
    expect(() => workspaceManager.resolveSafePath('C:\\Windows\\System32\\calc.exe')).toThrow(/Security violation/);
    expect(() => workspaceManager.resolveSafePath('\\\\evil-share\\data')).toThrow(/Security violation/);
  });

  it('rejects symlink escape when target points outside workspace (Item 9)', () => {
    const symlinkPath = path.join(tempWorkspace, 'symlink-escape.txt');
    if (fs.existsSync(symlinkPath)) {
      expect(() => workspaceManager.resolveSafePath('symlink-escape.txt')).toThrow(/Symlink escape/);
    }
  });

  it('rejects symlinked parent directory escape even when target does not exist (Item 10)', () => {
    const symlinkDir = path.join(tempWorkspace, 'symlink-dir-escape');
    if (fs.existsSync(symlinkDir)) {
      expect(() => workspaceManager.resolveSafePath('symlink-dir-escape/nonexistent-child.txt')).toThrow(
        /Symlink/
      );
    }
  });

  it('rejects .env files and variants (Item 11)', () => {
    expect(() => workspaceManager.resolveSafePath('.env')).toThrow(/Security violation/);
    expect(() => workspaceManager.resolveSafePath('.env.local')).toThrow(/Security violation/);
    expect(() => workspaceManager.resolveSafePath('.env.production')).toThrow(/Security violation/);
    expect(() => workspaceManager.resolveSafePath('config/.env.test')).toThrow(/Security violation/);
  });

  it('rejects .git access and directories (Item 12)', () => {
    expect(() => workspaceManager.resolveSafePath('.git')).toThrow(/Security violation/);
    expect(() => workspaceManager.resolveSafePath('.git/config')).toThrow(/Security violation/);
    expect(() => workspaceManager.resolveSafePath('.git/HEAD')).toThrow(/Security violation/);
  });

  it('rejects private key and secret files (Item 13)', () => {
    expect(() => workspaceManager.resolveSafePath('keys/server.key')).toThrow(/Security violation/);
    expect(() => workspaceManager.resolveSafePath('certs/cert.pem')).toThrow(/Security violation/);
    expect(() => workspaceManager.resolveSafePath('.forge-secrets.json')).toThrow(/Security violation/);
  });
});
