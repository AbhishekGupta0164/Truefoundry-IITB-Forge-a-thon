// import * as path from 'path';
// import { Hunk } from './types';
// import { SECURITY_ALLOWLIST } from './constants';
// import { StaleHunkError } from './errors';


 

//   const BLOCKED_PATTERNS = [
//   /^\.env(?:\..+)?$/i,
//   /^\.git(?:[\\/].*)?$/i,
//   /^\.forge-secrets(?:\..*)?$/i,
//   /\.(?:key|pem)$/i
// ];


// /**
//  * Validates that a path is relative, stays strictly within workspace,
//  * and does not access forbidden secret or configuration files.
//  */
// export function isPathSafe(filePath: string, workspaceRoot?: string): boolean {
//   if (!filePath || typeof filePath !== 'string') {
//     return false;
//   }

//   // Reject paths containing directory traversal
//   const normalized = path.normalize(filePath);
//   if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
//     return false;
//   }

//   // Reject forbidden files (.env, .git, secret keys)
//   const baseName = path.basename(normalized);
//   for (const pattern of BLOCKED_PATTERNS) {
//     if (pattern.test(baseName) || pattern.test(normalized)) {
//       return false;
//     }
//   }

//   // If workspaceRoot is provided, ensure resolved path stays within root
//   if (workspaceRoot) {
//     const fullPath = path.resolve(workspaceRoot, normalized);
//     const resolvedRoot = path.resolve(workspaceRoot);
//     if (!fullPath.startsWith(resolvedRoot + path.sep) && fullPath !== resolvedRoot) {
//       return false;
//     }
//   }

//   return true;
// }

// /**
//  * Validates whether a command matches the allowed security list.
//  */
// export function isCommandAllowed(command: string): boolean {
//   if (!command || typeof command !== 'string') {
//     return false;
//   }
//   const trimmed = command.trim();
//   return (SECURITY_ALLOWLIST.ALLOWED_COMMANDS as readonly string[]).includes(trimmed);
// }

// /**
//  * Verifies that a hunk has required fields and valid diff content.
//  */
// export function validateHunk(hunk: Hunk): boolean {
//   if (!hunk || !hunk.id || !hunk.file) {
//     return false;
//   }
//   if (typeof hunk.oldStart !== 'number' || typeof hunk.newStart !== 'number') {
//     return false;
//   }
//   if (!hunk.content || typeof hunk.content !== 'string') {
//     return false;
//   }
//   return isPathSafe(hunk.file);
// }

// /**
//  * Validates that target content has not become stale before applying hunk.
//  */
// export function assertHunkApplicable(originalContent: string, hunk: Hunk): void {
//   if (!validateHunk(hunk)) {
//     throw new StaleHunkError(hunk.id, `Hunk ${hunk.id} failed structural validation`);
//   }

//   // Verify hunk lines exist in original content
//   const originalLines = originalContent.split('\n');
//   if (hunk.oldStart < 1 || (hunk.oldLines > 0 && hunk.oldStart > originalLines.length + 1)) {
//     throw new StaleHunkError(hunk.id, `Hunk line range ${hunk.oldStart} out of bounds for ${hunk.file}`);
//   }
// }

import * as path from 'path';

import { Hunk } from './types';

import { SECURITY_ALLOWLIST } from './constants';

import { StaleHunkError } from './errors';

const BLOCKED_PATTERNS = [
  /^\.env(?:\..+)?$/i,
  /^\.git(?:[\\/].*)?$/i,
  /^\.forge-secrets(?:\..*)?$/i,
  /\.(?:key|pem)$/i
];

/**
 * Validates that a path is relative, stays strictly within workspace,
 * and does not access forbidden secret or configuration files.
 */
export function isPathSafe(filePath: string, workspaceRoot?: string): boolean {
  if (!filePath || typeof filePath !== 'string') {
    return false;
  }

  // Reject absolute paths, including Windows paths
  if (
    path.isAbsolute(filePath) ||
    /^[a-zA-Z]:[\\/]/.test(filePath) ||
    filePath.startsWith('\\\\')
  ) {
    return false;
  }

  // Normalize both Windows and Unix-style separators
  const normalized = path.posix.normalize(filePath.replace(/\\/g, '/'));

  // Reject paths containing directory traversal
  if (normalized === '..' || normalized.startsWith('../')) {
    return false;
  }

  // Reject forbidden files and directories
  const segments = normalized.split('/');

  for (const segment of segments) {
    if (BLOCKED_PATTERNS.some(pattern => pattern.test(segment))) {
      return false;
    }
  }

  // If workspaceRoot is provided, ensure resolved path stays within root
  if (workspaceRoot) {
    const fullPath = path.resolve(workspaceRoot, normalized);
    const resolvedRoot = path.resolve(workspaceRoot);
    const relativePath = path.relative(resolvedRoot, fullPath);

    if (
      relativePath === '..' ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
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

  if (
    hunk.oldStart < 1 ||
    (hunk.oldLines > 0 && hunk.oldStart > originalLines.length + 1)
  ) {
    throw new StaleHunkError(
      hunk.id,
      `Hunk line range ${hunk.oldStart} out of bounds for ${hunk.file}`
    );
  }
}
