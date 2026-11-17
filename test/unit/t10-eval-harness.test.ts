import { describe, it, expect } from 'vitest';
import { scoreTaskA, scoreTaskB, computeMatrixRow, SingleRun } from '../../eval/rubric';

describe('T10: Real Evaluation Harness & Machine-Scored Rubric', () => {
  describe('Task A Rubric Scorer', () => {
    it('passes for valid Python code with proper docstring and case-insensitive false check', () => {
      const code = [
        'def get_debug_flag() -> bool:',
        '    """Get whether debug mode is enabled.',
        '    Returns False for values: 0, false, no, off, n (case-insensitively).',
        '    """',
        '    val = os.environ.get("FLASK_DEBUG")',
        '    return bool(val and val.lower() not in {"0", "false", "no", "off", "n"})'
      ].join('\n');

      const result = scoreTaskA(code);
      expect(result.syntaxValid).toBe(true);
      expect(result.evaluatesValues).toBe(true);
      expect(result.docstringListsAll).toBe(true);
      expect(result.onlyTargetChanged).toBe(true);
      expect(result.passed).toBe(true);
      expect(result.failures.length).toBe(0);
    });

    it('fails when docstring does not list all false values', () => {
      const code = [
        'def get_debug_flag() -> bool:',
        '    """Get whether debug mode is enabled.',
        '    Returns False for false values.',
        '    """',
        '    val = os.environ.get("FLASK_DEBUG")',
        '    return bool(val and val.lower() not in {"0", "false", "no", "off", "n"})'
      ].join('\n');

      const result = scoreTaskA(code);
      expect(result.docstringListsAll).toBe(false);
      expect(result.passed).toBe(false);
      expect(result.failures.some(f => f.includes('Docstring missing'))).toBe(true);
    });

    it('fails when syntax error is present', () => {
      const code = 'def get_debug_flag() -> bool: return def invalid';
      const result = scoreTaskA(code);
      expect(result.syntaxValid).toBe(false);
      expect(result.passed).toBe(false);
    });
  });

  describe('Task B Rubric Scorer', () => {
    it('passes when all 5 criteria are met', () => {
      const result = scoreTaskB({
        modifiedFiles: ['src/flask/cli.py', 'tests/test_cli.py', 'docs/cli.rst'],
        toolCallsCount: 4,
        testPassed: true,
        helpListsConfig: true,
        secretsMasked: true,
        workspaceClean: true
      });

      expect(result.passed).toBe(true);
      expect(result.minFilesChanged).toBe(true);
      expect(result.testPassed).toBe(true);
      expect(result.helpListsConfig).toBe(true);
      expect(result.secretsMasked).toBe(true);
      expect(result.workspaceClean).toBe(true);
    });

    it('fails when fewer than 3 files are modified', () => {
      const result = scoreTaskB({
        modifiedFiles: ['src/flask/cli.py', 'tests/test_cli.py'],
        toolCallsCount: 2,
        testPassed: true
      });

      expect(result.minFilesChanged).toBe(false);
      expect(result.passed).toBe(false);
      expect(result.failures.some(f => f.includes('Expected >= 3 files'))).toBe(true);
    });

    it('fails when secrets are unmasked', () => {
      const result = scoreTaskB({
        modifiedFiles: ['src/flask/cli.py', 'tests/test_cli.py', 'docs/cli.rst'],
        toolCallsCount: 3,
        secretsMasked: false
      });

      expect(result.secretsMasked).toBe(false);
      expect(result.passed).toBe(false);
      expect(result.failures.some(f => f.includes('Secret keys not masked'))).toBe(true);
    });
  });

  describe('Multi-Model Matrix Computer', () => {
    it('calculates pass rate, median latency, tokens, flake rate, and common failure', () => {
      const runs: SingleRun[] = [
        {
          runIndex: 1,
          task: 'Task A',
          passed: true,
          latencyMs: 1200,
          tokensUsed: 400,
          toolCallsCount: 1
        },
        {
          runIndex: 2,
          task: 'Task A',
          passed: true,
          latencyMs: 1400,
          tokensUsed: 450,
          toolCallsCount: 1
        },
        {
          runIndex: 3,
          task: 'Task A',
          passed: false,
          latencyMs: 1800,
          tokensUsed: 500,
          toolCallsCount: 1,
          failureReason: 'Docstring missing false values'
        },
        {
          runIndex: 1,
          task: 'Task B',
          passed: true,
          latencyMs: 4000,
          tokensUsed: 1200,
          toolCallsCount: 4
        },
        {
          runIndex: 2,
          task: 'Task B',
          passed: true,
          latencyMs: 4200,
          tokensUsed: 1300,
          toolCallsCount: 4
        },
        {
          runIndex: 3,
          task: 'Task B',
          passed: true,
          latencyMs: 4500,
          tokensUsed: 1250,
          toolCallsCount: 4
        }
      ];

      const row = computeMatrixRow('Claude 3.5 Sonnet', 'strong_hosted', runs);
      expect(row.modelName).toBe('Claude 3.5 Sonnet');
      expect(row.totalRuns).toBe(6);
      expect(row.passRate).toBe(83); // 5/6 = 83%
      expect(row.medianLatencyMs).toBe(2900); // median of [1200, 1400, 1800, 4000, 4200, 4500]
      expect(row.medianTokens).toBe(850);
      expect(row.medianToolCalls).toBe(3);
      expect(row.flakeRate).toBe(50); // Task A had a flake
      expect(row.commonFailure).toBe('Docstring missing false values');
    });
  });
});
