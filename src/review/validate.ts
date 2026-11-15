import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { Hunk } from '../shared/types';

export interface SelectionRange {
  startLine: number; // 1-based line number
  endLine: number;   // 1-based line number
}

export interface ScopeValidationResult {
  inScope: boolean;
  hunk: Hunk;
  badge?: string;
  defaultRejected: boolean;
  reason?: string;
}

/**
 * Scope Guard:
 * In Task A, flag any hunk outside the selected range with an "outside selection" badge,
 * rejected by default.
 */
export function validateHunkScope(hunk: Hunk, selection?: SelectionRange): ScopeValidationResult {
  if (!selection) {
    return {
      inScope: true,
      hunk,
      defaultRejected: false
    };
  }

  const hunkStart = hunk.oldStart;
  const hunkEnd = hunk.oldLines > 0 ? hunk.oldStart + hunk.oldLines - 1 : hunk.oldStart;

  const isWithin = hunkStart >= selection.startLine && hunkEnd <= selection.endLine;
  const overlaps = Math.max(hunkStart, selection.startLine) <= Math.min(hunkEnd, selection.endLine);

  if (!overlaps && !isWithin) {
    return {
      inScope: false,
      hunk,
      badge: 'outside selection',
      defaultRejected: true,
      reason: `Hunk lines ${hunkStart}-${hunkEnd} are outside selected range ${selection.startLine}-${selection.endLine}`
    };
  }

  return {
    inScope: true,
    hunk,
    defaultRejected: false
  };
}

/**
 * Filter and annotate multiple hunks against a selected line range.
 */
export function applyScopeGuardToHunks(hunks: Hunk[], selection?: SelectionRange): ScopeValidationResult[] {
  return hunks.map(hunk => validateHunkScope(hunk, selection));
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates Python code using scripts/check_py.py or direct python3 AST execution.
 */
export function validatePythonSource(source: string, workspaceRoot?: string): ValidationResult {
  const scriptPath = path.resolve(workspaceRoot || process.cwd(), 'scripts', 'check_py.py');
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

  try {
    if (fs.existsSync(scriptPath)) {
      let output: string;
      try {
        output = execFileSync(pythonCmd, [scriptPath], {
          input: source,
          encoding: 'utf-8',
          timeout: 5000
        });
      } catch (err: any) {
        // If primary python command failed with ENOENT, try fallback command
        const fallbackCmd = pythonCmd === 'python' ? 'python3' : 'python';
        output = execFileSync(fallbackCmd, [scriptPath], {
          input: source,
          encoding: 'utf-8',
          timeout: 5000
        });
      }

      const parsed = JSON.parse(output);
      const errors = Array.isArray(parsed.errors)
        ? parsed.errors.map((e: any) => typeof e === 'string' ? e : e.message || JSON.stringify(e))
        : [];
      return {
        valid: parsed.valid ?? (errors.length === 0),
        errors
      };
    }

    // Fallback: run python -c with ast.parse
    try {
      execFileSync(pythonCmd, ['-c', 'import ast, sys; ast.parse(sys.stdin.read())'], {
        input: source,
        encoding: 'utf-8',
        timeout: 5000
      });
    } catch {
      const fallbackCmd = pythonCmd === 'python' ? 'python3' : 'python';
      execFileSync(fallbackCmd, ['-c', 'import ast, sys; ast.parse(sys.stdin.read())'], {
        input: source,
        encoding: 'utf-8',
        timeout: 5000
      });
    }
    return { valid: true, errors: [] };
  } catch (err: any) {
    const errorMsg = err.stderr ? String(err.stderr).trim() : err.message;
    return {
      valid: false,
      errors: [errorMsg || 'Syntax error in Python source']
    };
  }
}

/**
 * Validates a file on disk.
 */
export async function validateFile(filePath: string, workspaceRoot?: string): Promise<ValidationResult> {
  if (!fs.existsSync(filePath)) {
    return { valid: false, errors: [`File does not exist: ${filePath}`] };
  }
  const ext = path.extname(filePath).toLowerCase();
  const content = fs.readFileSync(filePath, 'utf-8');

  if (ext === '.py') {
    return validatePythonSource(content, workspaceRoot);
  }

  // Non-python files are considered valid if read successfully
  return { valid: true, errors: [] };
}
