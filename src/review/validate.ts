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
  /** Non-blocking notes, e.g. that no Python interpreter was found. */
  warnings?: string[];
}

/** Locate scripts/check_py.py next to the extension, not relative to the process cwd. */
function findCheckScript(): string | undefined {
  const candidates = [
    path.resolve(__dirname, '..', 'scripts', 'check_py.py'), // dist/extension.js -> <ext>/scripts
    path.resolve(__dirname, '..', '..', 'scripts', 'check_py.py') // src/review/validate.ts -> <repo>/scripts
  ];
  return candidates.find((c) => fs.existsSync(c));
}

/**
 * Python interpreters to try, best first: the workspace's own virtualenv (so the project's
 * installed packages resolve), then python3 / python from PATH.
 */
function pythonCandidates(workspaceRoot?: string): string[] {
  const out: string[] = [];
  if (workspaceRoot) {
    for (const venv of ['.venv', 'venv']) {
      const bin = process.platform === 'win32'
        ? path.join(workspaceRoot, venv, 'Scripts', 'python.exe')
        : path.join(workspaceRoot, venv, 'bin', 'python');
      if (fs.existsSync(bin)) out.push(bin);
    }
  }
  out.push(...(process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python']));
  return out;
}

interface RunResult { stdout: string; stderr: string; status: number }

/** Run the first interpreter that exists. Only a missing executable moves on to the next one. */
function runPython(args: string[], input: string, workspaceRoot?: string): RunResult | null {
  for (const cmd of pythonCandidates(workspaceRoot)) {
    try {
      const stdout = execFileSync(cmd, args, { input, encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] });
      return { stdout, stderr: '', status: 0 };
    } catch (err: any) {
      if (err?.code === 'ENOENT') continue;
      return {
        stdout: String(err?.stdout ?? ''),
        stderr: String(err?.stderr ?? err?.message ?? ''),
        status: typeof err?.status === 'number' ? err.status : 1
      };
    }
  }
  return null;
}

/**
 * Validates Python source: syntax, plus phantom-import detection for imports the edit adds.
 *
 * @param source        the full file content after the edit
 * @param workspaceRoot the workspace the file belongs to (its virtualenv is used if present)
 * @param baseline      the file content before the edit; imports it already had are not re-checked
 */
export function validatePythonSource(source: string, workspaceRoot?: string, baseline?: string): ValidationResult {
  const script = findCheckScript();
  const result = script
    ? runPython([script, '--json-stdin'], JSON.stringify({ source, baseline: baseline ?? null }), workspaceRoot)
    : runPython(['-c', 'import ast, sys; ast.parse(sys.stdin.read())'], source, workspaceRoot);

  if (result === null) {
    return { valid: true, errors: [], warnings: ['No Python interpreter found; Python syntax check skipped.'] };
  }

  if (script) {
    try {
      const parsed = JSON.parse(result.stdout);
      const errors: string[] = Array.isArray(parsed.errors)
        ? parsed.errors.map((e: any) => (typeof e === 'string' ? e : e.line ? `line ${e.line}: ${e.message}` : e.message || JSON.stringify(e)))
        : [];
      return { valid: parsed.valid ?? errors.length === 0, errors };
    } catch {
      return { valid: false, errors: [result.stderr.trim() || 'Python check failed without a result'] };
    }
  }
  return result.status === 0
    ? { valid: true, errors: [] }
    : { valid: false, errors: [result.stderr.trim().split('\n').pop() || 'Syntax error in Python source'] };
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
    // After accept the edit is already reviewed; check syntax, not imports the file already had.
    return validatePythonSource(content, workspaceRoot, content);
  }

  // Non-python files are considered valid if read successfully
  return { valid: true, errors: [] };
}
