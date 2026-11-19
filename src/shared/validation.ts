import * as path from 'path';
import { Hunk } from './types';
import { SECURITY_ALLOWLIST } from './constants';
import { StaleHunkError } from './errors';

const BLOCKED_SEGMENT_PATTERNS = [
  /^\.env(\..+)?$/i,
  /^\.git$/i,
  /^\.forge-secrets.*$/i
];

const BLOCKED_FILENAME_PATTERNS = [
  /\.(key|pem|pkcs12|pfx|p12)$/i,
  /^id_(rsa|ed25519|dsa|ecdsa)/i,
  /^\.env(\..+)?$/i,
  /^\.forge-secrets/i
];

/**
 * Validates that a path is relative or workspace-confined, stays strictly within workspace,
 * and does not access forbidden secret, git, or configuration files.
 */
export function isPathSafe(filePath: string, workspaceRoot?: string): boolean {
  if (!filePath || typeof filePath !== 'string') {
    return false;
  }

  // Reject null bytes
  if (filePath.includes('\0')) {
    return false;
  }

  // Reject UNC paths
  if (filePath.startsWith('\\\\') || filePath.startsWith('//')) {
    return false;
  }

  // Normalize separators to forward slash for segment analysis
  const uniformPath = filePath.replace(/\\/g, '/');
  const segments = uniformPath.split('/').filter(s => s.length > 0 && s !== '.');

  // Reject directory traversal attempts with ..
  if (segments.includes('..') || uniformPath.startsWith('..')) {
    return false;
  }

  // Check if absolute path or Windows drive letter
  const isAbs = path.isAbsolute(filePath) || /^[a-zA-Z]:/.test(filePath);
  if (isAbs) {
    if (!workspaceRoot) {
      return false;
    }
    const resolvedPath = path.resolve(filePath);
    const resolvedRoot = path.resolve(workspaceRoot);
    const lowerResolved = resolvedPath.toLowerCase();
    const lowerRoot = resolvedRoot.toLowerCase();
    if (lowerResolved !== lowerRoot && !lowerResolved.startsWith(lowerRoot + path.sep)) {
      return false;
    }
  }

  // Reject forbidden segments anywhere in the path
  for (const seg of segments) {
    for (const pattern of BLOCKED_SEGMENT_PATTERNS) {
      if (pattern.test(seg)) {
        return false;
      }
    }
  }

  // Reject forbidden filenames/extensions
  const baseName = path.basename(filePath);
  for (const pattern of BLOCKED_FILENAME_PATTERNS) {
    if (pattern.test(baseName)) {
      return false;
    }
  }

  // If workspaceRoot is provided, ensure resolved path stays strictly within root
  if (workspaceRoot) {
    const fullPath = path.resolve(workspaceRoot, filePath);
    const resolvedRoot = path.resolve(workspaceRoot);
    const lowerFull = fullPath.toLowerCase();
    const lowerRoot = resolvedRoot.toLowerCase();
    if (lowerFull !== lowerRoot && !lowerFull.startsWith(lowerRoot + path.sep)) {
      return false;
    }
  }

  return true;
}

/**
 * Validates whether a command matches the allowed security list.
 */
export function isCommandAllowed(command: string): boolean {
  if (!command || typeof command !== 'string') {
    return false;
  }
  const trimmed = command.trim();
  return (SECURITY_ALLOWLIST.ALLOWED_COMMANDS as readonly string[]).includes(trimmed);
}

export interface ArgvValidationResult {
  allowed: boolean;
  reason?: string;
  executable?: string;
  args?: string[];
}

/**
 * Strictly validates an argument array (argv) for terminal command execution.
 */
export function validateArgv(argv: unknown): ArgvValidationResult {
  if (!Array.isArray(argv)) {
    return { allowed: false, reason: 'Command must be an argument array (argv), not a shell string' };
  }
  if (argv.length === 0) {
    return { allowed: false, reason: 'Command argv array cannot be empty' };
  }

  for (const item of argv) {
    if (typeof item !== 'string') {
      return { allowed: false, reason: 'All argv elements must be strings' };
    }
    // Reject shell redirection, pipes, command chaining, and control characters
    if (/[><|;&\r\n`$]/.test(item)) {
      return { allowed: false, reason: `Forbidden shell character or redirection in argument: ${item}` };
    }
  }

  const [rawExe, ...args] = argv as string[];
  const exeBase = path.basename(rawExe).toLowerCase().replace(/\.exe$/, '');

  // Reject shell interpreters
  const FORBIDDEN_INTERPRETERS = ['sh', 'bash', 'zsh', 'csh', 'fish', 'cmd', 'powershell', 'pwsh'];
  if (FORBIDDEN_INTERPRETERS.includes(exeBase)) {
    return { allowed: false, reason: `Shell interpreter '${rawExe}' is strictly forbidden` };
  }

  // 1. git status, git diff
  if (exeBase === 'git') {
    const sub = args[0]?.toLowerCase();
    if (sub === 'status' || sub === 'diff') {
      return { allowed: true, executable: rawExe, args };
    }
    return { allowed: false, reason: `git subcommand '${sub}' is not allowed (only status and diff are permitted)` };
  }

  // 2. pytest (e.g. pytest tests/test_cli.py -q)
  if (exeBase === 'pytest') {
    return { allowed: true, executable: rawExe, args };
  }

  // 3. python (e.g. python -m pytest ..., python -c "from flask.helpers...", python scripts/symbols.py ...)
  if (exeBase === 'python' || exeBase === 'python3') {
    const isTaskACheck = args[0] === '-c' && typeof args[1] === 'string' && args[1].includes('get_debug_flag');
    const isPytestModule = args[0] === '-m' && args[1] === 'pytest';
    const isSymbolsScript = typeof args[0] === 'string' && args[0].includes('symbols.py');
    if (isTaskACheck || isPytestModule || isSymbolsScript) {
      return { allowed: true, executable: rawExe, args };
    }
    return { allowed: false, reason: `python command is not on the approved allowlist: ${argv.join(' ')}` };
  }

  // 4. flask (--help, or --app ... config)
  if (exeBase === 'flask') {
    if (args[0] === '--help') {
      return { allowed: true, executable: rawExe, args };
    }
    if (args[0] === '--app' && args.length >= 3 && args[2] === 'config') {
      const appTarget = args[1];
      if (isPathSafe(appTarget)) {
        return { allowed: true, executable: rawExe, args };
      }
      return { allowed: false, reason: `Unsafe flask --app target: ${appTarget}` };
    }
    return { allowed: false, reason: `flask command is not on the approved allowlist: ${argv.join(' ')}` };
  }

  // 5. npm (e.g. npm test)
  if (exeBase === 'npm') {
    if (args[0] === 'test') {
      return { allowed: true, executable: rawExe, args };
    }
    return { allowed: false, reason: `npm subcommand is not allowed: ${args[0]}` };
  }

  return { allowed: false, reason: `Executable '${rawExe}' is not on the approved security allowlist` };
}

/**
 * Verifies that a hunk has required fields and valid diff content.
 */
export function validateHunk(hunk: Hunk): boolean {
  if (!hunk || !hunk.id || !hunk.file) {
    return false;
  }
  if (typeof hunk.oldStart !== 'number' || typeof hunk.newStart !== 'number') {
    return false;
  }
  if (!hunk.content || typeof hunk.content !== 'string') {
    return false;
  }
  return isPathSafe(hunk.file);
}

/**
 * Validates that target content has not become stale before applying hunk.
 */
export function assertHunkApplicable(originalContent: string, hunk: Hunk): void {
  if (!validateHunk(hunk)) {
    throw new StaleHunkError(hunk.id, `Hunk ${hunk.id} failed structural validation`);
  }

  // Verify hunk lines exist in original content
  const originalLines = originalContent.split('\n');
  if (hunk.oldStart < 1 || (hunk.oldLines > 0 && hunk.oldStart > originalLines.length + 1)) {
    throw new StaleHunkError(hunk.id, `Hunk line range ${hunk.oldStart} out of bounds for ${hunk.file}`);
  }
}
