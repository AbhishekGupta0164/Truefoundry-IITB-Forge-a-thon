import { describe, expect, it } from 'vitest';
import { validateHunk, assertHunkApplicable } from '../../src/shared/validation';
import { Hunk } from '../../src/shared/types';
import { StaleHunkError } from '../../src/shared/errors';
import * as diff from 'diff';

describe('Patch and Hunk Validation', () => {
  const sampleHunk: Hunk = {
    id: 'hunk-001',
    file: 'src/app.py',
    oldStart: 1,
    oldLines: 3,
    newStart: 1,
    newLines: 4,
    content: '@@ -1,3 +1,4 @@\n def hello():\n-    return "old"\n+    return "new"\n+    # updated\n'
  };

  it('validates a structurally sound hunk', () => {
    expect(validateHunk(sampleHunk)).toBe(true);
  });

  it('rejects a hunk with path traversal in target file', () => {
    const maliciousHunk: Hunk = {
      ...sampleHunk,
      file: '../outside.py'
    };
    expect(validateHunk(maliciousHunk)).toBe(false);
  });

  it('rejects a hunk targeting sensitive files', () => {
    const secretHunk: Hunk = {
      ...sampleHunk,
      file: '.env'
    };
    expect(validateHunk(secretHunk)).toBe(false);
  });

  it('throws StaleHunkError when hunk line range exceeds file contents', () => {
    const shortFileContent = 'line 1\nline 2';
    const outOfBoundsHunk: Hunk = {
      ...sampleHunk,
      oldStart: 50,
      oldLines: 5
    };

    expect(() => assertHunkApplicable(shortFileContent, outOfBoundsHunk)).toThrow(StaleHunkError);
  });

  it('successfully computes unified diff with diff library', () => {
    const oldText = 'console.log("hello");\n';
    const newText = 'console.log("hello world");\n';
    const patchResult = diff.createPatch('sample.ts', oldText, newText);

    expect(patchResult).toContain('--- sample.ts');
    expect(patchResult).toContain('+++ sample.ts');
    expect(patchResult).toContain('+console.log("hello world");');
  });
});
