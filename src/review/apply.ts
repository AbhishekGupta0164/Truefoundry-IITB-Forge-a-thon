/**
 * Core hunk application logic.
 * Safely applies unified diff hunks to source files.
 */

import * as fs from 'fs';
import { Hunk } from '../shared/types';
import { StaleHunkError } from '../shared/errors';

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
    // If not exact match, search nearby lines (+/- 5 lines)
    let foundIndex = -1;
    for (let offset = -5; offset <= 5; offset++) {
      const candidateIndex = startIndex + offset;
      if (candidateIndex < 0 || candidateIndex + count > originalLines.length) continue;
      const candidateSlice = originalLines.slice(candidateIndex, candidateIndex + count);
      if (expectedOldLines.every((exp, idx) => candidateSlice[idx] === exp)) {
        foundIndex = candidateIndex;
        break;
      }
    }

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
