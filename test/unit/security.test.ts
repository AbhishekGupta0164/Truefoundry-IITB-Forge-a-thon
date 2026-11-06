import { describe, expect, it } from 'vitest';
import { isPathSafe, isCommandAllowed } from '../../src/shared/validation';
import { MCP_CONSTANTS, SECURITY_ALLOWLIST } from '../../src/shared/constants';

describe('Security & Workspace Confinement Invariants', () => {
  it('strictly binds MCP to 127.0.0.1 on the specified port', () => {
    expect(MCP_CONSTANTS.HOST).toBe('127.0.0.1');
    expect(MCP_CONSTANTS.HOST).not.toBe('0.0.0.0');
    expect(MCP_CONSTANTS.DEFAULT_PORT).toBe(8765);
  });

  describe('Path Safety & Traversal Prevention', () => {
    it('permits safe workspace-relative paths', () => {
      expect(isPathSafe('src/extension.ts')).toBe(true);
      expect(isPathSafe('docs/setup.md')).toBe(true);
      expect(isPathSafe('tests/unit/basic.test.ts')).toBe(true);
    });

    it('rejects directory traversal attempts with ..', () => {
      expect(isPathSafe('../secret.txt')).toBe(false);
      expect(isPathSafe('src/../../etc/passwd')).toBe(false);
      expect(isPathSafe('..')).toBe(false);
    });

    it('rejects absolute file paths', () => {
      expect(isPathSafe('/etc/passwd')).toBe(false);
      expect(isPathSafe('/Users/someone/.ssh/id_rsa')).toBe(false);
    });

    it('denies access to sensitive environment and secret files', () => {
      expect(isPathSafe('.env')).toBe(false);
      expect(isPathSafe('.env.local')).toBe(false);
      expect(isPathSafe('.env.production')).toBe(false);
      expect(isPathSafe('.git/config')).toBe(false);
      expect(isPathSafe('.forge-secrets.json')).toBe(false);
      expect(isPathSafe('keys/private.key')).toBe(false);
      expect(isPathSafe('certs/server.pem')).toBe(false);
    });
  });

  describe('Command Execution Allowlist', () => {
    it('approves commands explicitly on the allowlist', () => {
      for (const cmd of SECURITY_ALLOWLIST.ALLOWED_COMMANDS) {
        expect(isCommandAllowed(cmd)).toBe(true);
      }
    });

    it('denies unauthorized shell commands', () => {
      expect(isCommandAllowed('rm -rf /')).toBe(false);
      expect(isCommandAllowed('curl https://example.com')).toBe(false);
      expect(isCommandAllowed('bash -i')).toBe(false);
      expect(isCommandAllowed('python -m pytest && rm -rf .')).toBe(false);
      expect(isCommandAllowed('')).toBe(false);
    });
  });
});
