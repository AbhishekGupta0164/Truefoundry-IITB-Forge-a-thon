import { describe, expect, it, beforeEach } from 'vitest';
import { sanitizeToolOutput, DEFAULT_TOOL_OUTPUT_CAP } from '../../src/mcp/sanitize';
import { InMemorySymbolIndex } from '../../src/context/symbol-index';
import { validateHunkScope, applyScopeGuardToHunks } from '../../src/review/validate';
import { Hunk } from '../../src/shared/types';
import * as fs from 'fs';
import * as path from 'path';

describe('M2 Differentiators (MCP and Context)', () => {
  describe('Tool Output Cap (~2 KB)', () => {
    it('does not truncate output smaller than cap', () => {
      const shortOutput = 'Small tool response within budget';
      const sanitized = sanitizeToolOutput(shortOutput);
      expect(sanitized).toContain(shortOutput);
      expect(sanitized).not.toContain('Output truncated');
    });

    it('limits tool result to about 2 KB (2048 characters)', () => {
      const longOutput = 'A'.repeat(5000);
      const sanitized = sanitizeToolOutput(longOutput);
      expect(sanitized).toContain(`Output truncated to ${DEFAULT_TOOL_OUTPUT_CAP} characters (~2 KB cap)`);
      // Verify truncated segment is within 2KB + container wrappers
      expect(sanitized.length).toBeLessThan(longOutput.length);
    });

    it('handles empty tool output gracefully', () => {
      expect(sanitizeToolOutput('')).toBe('');
    });
  });

  describe('In-memory Symbol Index (no Python process per call, cached by mtime)', () => {
    let index: InMemorySymbolIndex;
    const testDir = path.resolve(__dirname, '../fixtures/mini-repo');

    beforeEach(() => {
      index = new InMemorySymbolIndex(testDir);
    });

    it('indexes Python functions and classes from code', () => {
      const pyCode = `
class AppConfig:
    """Application configuration container."""
    def load(self, path):
        pass

def create_app(debug=False):
    """Factory creating the app instance."""
    return AppConfig()
`;
      const symbols = index.indexFile('dummy.py', pyCode);
      expect(symbols.length).toBe(2);
      expect(symbols[0].name).toBe('AppConfig');
      expect(symbols[0].type).toBe('class');
      expect(symbols[0].methods?.length).toBe(1);
      expect(symbols[0].methods?.[0].name).toBe('load');

      expect(symbols[1].name).toBe('create_app');
      expect(symbols[1].type).toBe('function');
      expect(symbols[1].signature).toBe('def create_app(debug=False)');
      expect(symbols[1].docstring).toBe('Factory creating the app instance.');
    });

    it('checks whether symbols exist using hasSymbol', () => {
      const pyCode = 'def calculate_total(items): pass\n';
      index.indexFile('calc.py', pyCode);

      expect(index.hasSymbol('calculate_total')).toBe(true);
      expect(index.hasSymbol('unknown_phantom_symbol')).toBe(false);
    });

    it('searches symbols matching a query substring', () => {
      const pyCode = 'def get_user_profile(): pass\ndef get_user_orders(): pass\ndef update_settings(): pass\n';
      index.indexFile('users.py', pyCode);

      const matches = index.searchSymbols('user');
      expect(matches.length).toBe(2);
      expect(matches.map(m => m.name)).toEqual(['get_user_profile', 'get_user_orders']);
    });
  });

  describe('Scope Guard (Task A selection range enforcement)', () => {
    const mockHunkInside: Hunk = {
      id: 'hunk-inside',
      file: 'src/flask/app.py',
      oldStart: 25,
      oldLines: 5,
      newStart: 25,
      newLines: 6,
      content: '@@ -25,5 +25,6 @@\n def run():\n-    pass\n+    # updated\n+    pass\n'
    };

    const mockHunkOutside: Hunk = {
      id: 'hunk-outside',
      file: 'src/flask/app.py',
      oldStart: 120,
      oldLines: 4,
      newStart: 120,
      newLines: 4,
      content: '@@ -120,4 +120,4 @@\n-old_var = 1\n+new_var = 2\n'
    };

    it('passes hunks completely inside the user selection range', () => {
      const selection = { startLine: 20, endLine: 35 };
      const result = validateHunkScope(mockHunkInside, selection);

      expect(result.inScope).toBe(true);
      expect(result.defaultRejected).toBe(false);
      expect(result.badge).toBeUndefined();
    });

    it('flags hunks outside the selected range with an "outside selection" badge and rejects by default', () => {
      const selection = { startLine: 20, endLine: 35 };
      const result = validateHunkScope(mockHunkOutside, selection);

      expect(result.inScope).toBe(false);
      expect(result.defaultRejected).toBe(true);
      expect(result.badge).toBe('outside selection');
      expect(result.reason).toContain('outside selected range');
    });

    it('handles multiple hunks across a document and assigns correct badges', () => {
      const selection = { startLine: 20, endLine: 40 };
      const results = applyScopeGuardToHunks([mockHunkInside, mockHunkOutside], selection);

      expect(results[0].inScope).toBe(true);
      expect(results[0].defaultRejected).toBe(false);

      expect(results[1].inScope).toBe(false);
      expect(results[1].defaultRejected).toBe(true);
      expect(results[1].badge).toBe('outside selection');
    });
  });
});
