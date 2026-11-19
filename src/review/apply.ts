/**
 * Core hunk application logic.
 * Safely applies unified diff hunks to source files.
 */

import * as fs from 'fs';
import { Hunk } from '../shared/types';
import { StaleHunkError } from '../shared/errors';

/** Context (' ') and removed ('-') lines of a hunk, i.e. what must be in the file before it applies. */
export function hunkOldLines(hunk: Hunk): string[] {
  return hunk.content
    .split('\n')
    .filter((l) => l.startsWith(' ') || l.startsWith('-'))
    .map((l) => l.slice(1));
}

const sameLine = (a: string | undefined, b: string) => a !== undefined && (a === b || a.trim() === b.trim());

/**
 * Find where a hunk's old lines sit in the current file (0-based), or -1 if they are not
 * there unambiguously.
 *
 * Hunks of one patch are computed against the same original file, so once an earlier hunk
 * adds or removes lines, later hunks move. The expected position is tried first; otherwise
 * the old lines must occur exactly once elsewhere in the file. Lines the user changed, or
 * text that appears more than once, give -1 and the hunk is treated as stale.
 */
export function locateHunk(fileLines: string[], oldLines: string[], expectedIndex: number): number {
  if (oldLines.length === 0) {
    return Math.min(Math.max(0, expectedIndex), fileLines.length);
  }
  const matchesAt = (start: number) =>
    start >= 0 && start + oldLines.length <= fileLines.length && oldLines.every((line, i) => sameLine(fileLines[start + i], line));

  if (matchesAt(expectedIndex)) return expectedIndex;
  const found: number[] = [];
  for (let start = 0; start + oldLines.length <= fileLines.length; start++) {
    if (matchesAt(start)) {
      found.push(start);
      if (found.length > 1) return -1;
    }
  }
  return found.length === 1 ? found[0] : -1;
}

export function applyHunkToContent(originalContent: string, hunk: Hunk): string {
  const originalLines = originalContent.split('\n');
  const hunkLines = hunk.content.split('\n');

  // Parse lines to remove and lines to insert
  const expectedOldLines: string[] = [];
  const replacementLines: string[] = [];

  for (const line of hunkLines) {
    if (line.startsWith('-')) {
      expectedOldLines.push(line.slice(1));
    } else if (line.startsWith('+')) {
      replacementLines.push(line.slice(1));
    } else if (line.startsWith(' ')) {
      expectedOldLines.push(line.slice(1));
      replacementLines.push(line.slice(1));
    }
  }

  // 1-based indexing for oldStart
  const startIndex = Math.max(0, hunk.oldStart - 1);
  const count = hunk.oldLines > 0 ? hunk.oldLines : expectedOldLines.length;

  // Verify that the lines being replaced match
  const sliceToReplace = originalLines.slice(startIndex, startIndex + count);
  const matchesExact = expectedOldLines.length === 0 || 
    expectedOldLines.every((expected, idx) => sliceToReplace[idx] === expected);

  if (!matchesExact && sliceToReplace.length > 0) {
    const foundIndex = locateHunk(originalLines, expectedOldLines, startIndex);
    if (foundIndex !== -1) {
      originalLines.splice(foundIndex, count, ...replacementLines);
      return originalLines.join('\n');
    }

    throw new StaleHunkError(hunk.id, `Target content in ${hunk.file} at line ${hunk.oldStart} does not match hunk context`);
  }

  originalLines.splice(startIndex, count, ...replacementLines);
  return originalLines.join('\n');
}

export function applyHunkToFile(filePath: string, hunk: Hunk): void {
  const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
  const updated = applyHunkToContent(content, hunk);
  fs.writeFileSync(filePath, updated, 'utf-8');
}
