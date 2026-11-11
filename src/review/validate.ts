import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

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
