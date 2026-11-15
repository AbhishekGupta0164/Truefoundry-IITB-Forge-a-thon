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

  // Hunk range in file: starts at hunk.oldStart, spans hunk.oldLines (or 1 if oldLines == 0)
  const hunkStart = hunk.oldStart;
  const hunkEnd = hunk.oldLines > 0 ? hunk.oldStart + hunk.oldLines - 1 : hunk.oldStart;

  // Overlap or containment check between [hunkStart, hunkEnd] and [selection.startLine, selection.endLine]
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
