/**
 * Multi-Tier Edit Matcher & Diagnostics Engine — Member 2 (Task T9)
 *
 * Implements 3-tier matching for propose_edit:
 * Tier 1: Exact unique match
 * Tier 2: Whitespace-normalized match (tabs, spaces, CRLF, trailing spaces) with auto-reindent
 * Tier 3: Anchor match (first & last line anchored within window, tolerates drifted middle)
 *
 * Diagnostics on failure:
 * - Closest candidate with line number, 5-line excerpt, and difference hint
 * - Ambiguous match detection with line numbers
 */

export interface MatchResult {
  matched: boolean;
  tier?: 1 | 2 | 3;
  startIndex: number;
  endIndex: number;
  matchedText: string;
  replacementText: string;
  error?: {
    code: 'MATCH_FAILED' | 'AMBIGUOUS_MATCH' | 'INVALID_ARGS';
    message: string;
    hint?: string;
    closestLine?: number;
    excerpt?: string;
  };
}

export function matchAndReplace(content: string, oldStr: string, newStr: string): MatchResult {
  if (!oldStr) {
    return {
      matched: false,
      startIndex: -1,
      endIndex: -1,
      matchedText: '',
      replacementText: newStr,
      error: {
        code: 'INVALID_ARGS',
        message: 'old_str must be a non-empty string',
        hint: 'Provide the exact code block to be replaced'
      }
    };
  }

  // --- Tier 1: Exact unique match ---
  const occurrences = countOccurrences(content, oldStr);
  if (occurrences === 1) {
    const idx = content.indexOf(oldStr);
    return {
      matched: true,
      tier: 1,
      startIndex: idx,
      endIndex: idx + oldStr.length,
      matchedText: oldStr,
      replacementText: newStr
    };
  } else if (occurrences > 1) {
    const lineNumbers = findOccurrenceLines(content, oldStr);
    return {
      matched: false,
      startIndex: -1,
      endIndex: -1,
      matchedText: '',
      replacementText: newStr,
      error: {
        code: 'AMBIGUOUS_MATCH',
        message: `old_str is ambiguous: matched at lines ${lineNumbers.join(' and ')}, add context`,
        hint: 'Include surrounding lines of code to create a unique anchor'
      }
    };
  }

  // --- Tier 2: Whitespace-normalized match ---
  const tier2Result = tryWhitespaceNormalizedMatch(content, oldStr, newStr);
  if (tier2Result.matched) {
    return tier2Result;
  }

  // --- Tier 3: Anchor match ---
  const tier3Result = tryAnchorMatch(content, oldStr, newStr);
  if (tier3Result.matched) {
    return tier3Result;
  }

  // --- Match Failed: Generate Diagnostic Excerpt & Closest Line Hint ---
  const diagnostic = findClosestMatchDiagnostic(content, oldStr);
  return {
    matched: false,
    startIndex: -1,
    endIndex: -1,
    matchedText: '',
    replacementText: newStr,
    error: {
      code: 'MATCH_FAILED',
      message: `matched 0 times; ${diagnostic.hint}`,
      hint: diagnostic.hint,
      closestLine: diagnostic.closestLine,
      excerpt: diagnostic.excerpt
    }
  };
}

function countOccurrences(source: string, sub: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = source.indexOf(sub, pos)) !== -1) {
    count++;
    pos += sub.length;
  }
  return count;
}

function findOccurrenceLines(content: string, sub: string): number[] {
  const lines: number[] = [];
  let pos = 0;
  while ((pos = content.indexOf(sub, pos)) !== -1) {
    const lineNum = content.slice(0, pos).split('\n').length;
    lines.push(lineNum);
    pos += sub.length;
  }
  return lines;
}

/**
 * Tier 2: Normalizes tabs/spaces, CRLF/LF, and trailing spaces.
 * Re-indents new_str to match original indentation.
 */
function tryWhitespaceNormalizedMatch(
  content: string,
  oldStr: string,
  newStr: string
): MatchResult {
  const normalize = (s: string) =>
    s
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map(line => line.trimEnd())
      .join('\n');

  const normOld = normalize(oldStr);
  const contentLines = content.replace(/\r\n/g, '\n').split('\n');
  const oldLines = normOld.split('\n');

  if (oldLines.length === 0 || normOld.length === 0) {
    return { matched: false, startIndex: -1, endIndex: -1, matchedText: '', replacementText: newStr };
  }

  const matches: { startLine: number; endLine: number }[] = [];

  for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
    let match = true;
    for (let j = 0; j < oldLines.length; j++) {
      if (contentLines[i + j].trim() !== oldLines[j].trim()) {
        match = false;
        break;
      }
    }
    if (match) {
      matches.push({ startLine: i, endLine: i + oldLines.length });
    }
  }

  if (matches.length === 1) {
    const { startLine, endLine } = matches[0];
    const originalSlice = contentLines.slice(startLine, endLine).join('\n');

    // Calculate detected indent from matched block
    const firstMatchedLine = contentLines[startLine];
    const indentMatch = firstMatchedLine.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1] : '';

    // Re-indent newStr lines to match detected indentation
    const reindentedNewStr = newStr
      .split('\n')
      .map((line) => {
        if (!line.trim()) return line;
        if (!line.startsWith(indent)) return indent + line.trimStart();
        return line;
      })
      .join('\n');

    const startIndex = contentLines.slice(0, startLine).join('\n').length + (startLine > 0 ? 1 : 0);
    const endIndex = startIndex + originalSlice.length;

    return {
      matched: true,
      tier: 2,
      startIndex,
      endIndex,
      matchedText: originalSlice,
      replacementText: reindentedNewStr
    };
  } else if (matches.length > 1) {
    return {
      matched: false,
      startIndex: -1,
      endIndex: -1,
      matchedText: '',
      replacementText: newStr,
      error: {
        code: 'AMBIGUOUS_MATCH',
        message: `ambiguous: matched at lines ${matches.map(m => m.startLine + 1).join(' and ')}, add context`
      }
    };
  }

  return { matched: false, startIndex: -1, endIndex: -1, matchedText: '', replacementText: newStr };
}

/**
 * Tier 3: Anchor Match.
 * Matches first and last lines of old_str within a small sliding window,
 * tolerating a drifted or slightly modified middle if similarity is >= 0.70.
 */
function tryAnchorMatch(
  content: string,
  oldStr: string,
  newStr: string
): MatchResult {
  const oldLines = oldStr.replace(/\r\n/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
  if (oldLines.length < 3) {
    return { matched: false, startIndex: -1, endIndex: -1, matchedText: '', replacementText: newStr };
  }

  const firstAnchor = oldLines[0];
  const lastAnchor = oldLines[oldLines.length - 1];

  const contentLines = content.replace(/\r\n/g, '\n').split('\n');
  const candidates: { startLine: number; endLine: number; similarity: number }[] = [];

  for (let i = 0; i < contentLines.length; i++) {
    if (contentLines[i].trim() === firstAnchor) {
      // Look ahead within a window of (oldLines.length + 5) lines for lastAnchor
      const maxLookahead = Math.min(contentLines.length - 1, i + oldLines.length + 5);
      for (let j = i + 2; j <= maxLookahead; j++) {
        if (contentLines[j].trim() === lastAnchor) {
          const windowSlice = contentLines.slice(i, j + 1).map(l => l.trim());
          const sim = computeLineSimilarity(oldLines, windowSlice);
          if (sim >= 0.70) {
            candidates.push({ startLine: i, endLine: j + 1, similarity: sim });
          }
        }
      }
    }
  }

  if (candidates.length === 1) {
    const { startLine, endLine } = candidates[0];
    const originalSlice = contentLines.slice(startLine, endLine).join('\n');
    const startIndex = contentLines.slice(0, startLine).join('\n').length + (startLine > 0 ? 1 : 0);
    const endIndex = startIndex + originalSlice.length;

    return {
      matched: true,
      tier: 3,
      startIndex,
      endIndex,
      matchedText: originalSlice,
      replacementText: newStr
    };
  } else if (candidates.length > 1) {
    return {
      matched: false,
      startIndex: -1,
      endIndex: -1,
      matchedText: '',
      replacementText: newStr,
      error: {
        code: 'AMBIGUOUS_MATCH',
        message: `ambiguous: matched anchor candidates at lines ${candidates.map(c => c.startLine + 1).join(' and ')}`
      }
    };
  }

  return { matched: false, startIndex: -1, endIndex: -1, matchedText: '', replacementText: newStr };
}

function computeLineSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  let common = 0;
  for (const item of b) {
    if (setA.has(item)) common++;
  }
  return (2 * common) / (a.length + b.length);
}

/**
 * Generates closest match diagnostics on failure:
 * Line number, 5-line excerpt, and difference explanation.
 */
function findClosestMatchDiagnostic(
  content: string,
  oldStr: string
): { closestLine: number; excerpt: string; hint: string } {
  const contentLines = content.replace(/\r\n/g, '\n').split('\n');
  const targetLines = oldStr.replace(/\r\n/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
  const firstTarget = targetLines[0] || '';

  let bestLine = 1;
  let bestScore = -1;
  let diffLine = 1;

  for (let i = 0; i < contentLines.length; i++) {
    const line = contentLines[i].trim();
    if (!line) continue;

    let score = 0;
    if (line === firstTarget) {
      score = 1.0;
    } else if (firstTarget && (line.includes(firstTarget) || firstTarget.includes(line))) {
      score = 0.8;
    }

    if (score > bestScore) {
      bestScore = score;
      bestLine = i + 1;
    }
  }

  // Find where it differs
  if (bestScore > 0 && targetLines.length > 1) {
    const offset = bestLine - 1;
    for (let k = 0; k < targetLines.length; k++) {
      if (offset + k >= contentLines.length || contentLines[offset + k].trim() !== targetLines[k]) {
        diffLine = offset + k + 1;
        break;
      }
    }
  } else {
    diffLine = bestLine;
  }

  const startExcerpt = Math.max(0, bestLine - 3);
  const endExcerpt = Math.min(contentLines.length, bestLine + 2);
  const excerpt = contentLines.slice(startExcerpt, endExcerpt).join('\n');

  const hint = `closest match at line ${bestLine}, differs at line ${diffLine}`;
  return {
    closestLine: bestLine,
    excerpt,
    hint
  };
}

/**
 * Tool-call repair helper:
 * Normalizes malformed arguments sent by models:
 * - Stringified JSON
 * - Alias keys: file, filePath, oldStr, newStr
 * - Leading slashes in paths (/src/flask/... -> src/flask/...)
 */
export function repairProposeEditArgs(args: any): {
  path: string;
  old_str: string;
  new_str: string;
  summary?: string;
  diff?: string;
  full_file?: boolean;
} {
  let parsed = args;
  if (typeof args === 'string') {
    try {
      parsed = JSON.parse(args);
    } catch {
      parsed = { old_str: args };
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    parsed = {};
  }

  // Handle nested edits array if model passed { edits: [{ old_str, new_str }] }
  let oldStr = parsed.old_str ?? parsed.oldStr ?? parsed.old_string ?? parsed.original ?? '';
  let newStr = parsed.new_str ?? parsed.newStr ?? parsed.new_string ?? parsed.replacement ?? '';

  if (Array.isArray(parsed.edits) && parsed.edits.length > 0) {
    const firstEdit = parsed.edits[0];
    oldStr = firstEdit.old_str ?? firstEdit.oldStr ?? oldStr;
    newStr = firstEdit.new_str ?? firstEdit.newStr ?? newStr;
  }

  let filePath = parsed.path ?? parsed.filePath ?? parsed.file ?? parsed.targetPath ?? '';
  // Normalize leading slash: "/src/flask/cli.py" -> "src/flask/cli.py"
  if (typeof filePath === 'string') {
    filePath = filePath.replace(/^[/\\]+/, '');
  }

  return {
    path: filePath,
    old_str: typeof oldStr === 'string' ? oldStr : String(oldStr),
    new_str: typeof newStr === 'string' ? newStr : String(newStr),
    summary: parsed.summary,
    diff: parsed.diff,
    full_file: Boolean(parsed.full_file)
  };
}

/**
 * Hunk Dependency Graph:
 * Links hunks if a later hunk relies on an import or symbol added in an earlier hunk.
 */
export function buildHunkDependencyGraph(hunks: Array<{ id: string; content: string }>): Map<string, string[]> {
  const dependencyMap = new Map<string, string[]>(); // hunkId -> dependentHunkIds[]
  const addedSymbols = new Map<string, string>(); // symbolName -> sourceHunkId

  // Pass 1: detect newly added imports/symbols per hunk
  for (const hunk of hunks) {
    const lines = hunk.content.split('\n');
    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        const text = line.slice(1).trim();
        // Match import or def/class
        const importMatch = text.match(/(?:from\s+[\w\.]+\s+import\s+([\w,\s]+)|import\s+([\w\.]+))/);
        if (importMatch) {
          const symbols = (importMatch[1] || importMatch[2]).split(',').map(s => s.trim());
          for (const s of symbols) {
            addedSymbols.set(s, hunk.id);
          }
        }
        const defMatch = text.match(/(?:def|class)\s+([a-zA-Z_]\w*)/);
        if (defMatch) {
          addedSymbols.set(defMatch[1], hunk.id);
        }
      }
    }
  }

  // Pass 2: check if later hunks use those added symbols
  for (const hunk of hunks) {
    const lines = hunk.content.split('\n');
    const deps: string[] = [];
    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        const text = line.slice(1).trim();
        for (const [sym, sourceHunkId] of addedSymbols.entries()) {
          if (sourceHunkId !== hunk.id && text.includes(sym)) {
            if (!deps.includes(sourceHunkId)) {
              deps.push(sourceHunkId);
            }
          }
        }
      }
    }
    if (deps.length > 0) {
      dependencyMap.set(hunk.id, deps);
    }
  }

  return dependencyMap;
}
