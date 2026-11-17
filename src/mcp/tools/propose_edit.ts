import * as crypto from 'crypto';
import * as fs from 'fs';
import * as diff from 'diff';
import { WorkspaceManager } from '../workspace';
import { PatchStore, defaultPatchStore, StagedHunk, StagedPatch } from '../../review/store';
import { sanitizeToolOutput } from '../sanitize';
import { defaultSessionStateManager } from '../../trueforge/session-state';
import { matchAndReplace, repairProposeEditArgs, buildHunkDependencyGraph } from '../../review/matcher';
import { validatePythonSource } from '../../review/validate';

export interface ProposeEditParams {
  path?: string;
  filePath?: string;
  old_str?: string;
  oldStr?: string;
  new_str?: string;
  newStr?: string;
  summary?: string;
  reason?: string;
  diff?: string;
  full_file?: boolean;
  session_id?: string;
  sessionId?: string;
  edits?: Array<{ old_str?: string; new_str?: string; oldStr?: string; newStr?: string }>;
}

export interface ProposeEditResult {
  ok: boolean;
  patch_id: string;
  hunk_ids: string[];
  hunks_count: number;
  target_file: string;
  summary: string;
  diff: string;
  rawText: string;
  tier?: number;
  dependencies?: Record<string, string[]>;
  error?: {
    code: string;
    message: string;
    hint?: string;
  };
}

export async function executeProposeEdit(
  params: ProposeEditParams,
  workspaceManager: WorkspaceManager,
  patchStore: PatchStore = defaultPatchStore
): Promise<ProposeEditResult> {
  // 1. Tool-Call Repair: normalize malformed arguments, aliases, leading slashes
  const repaired = repairProposeEditArgs(params);
  const relativePath = repaired.path;

  if (!relativePath || typeof relativePath !== 'string') {
    throw new Error('path must be a non-empty string');
  }

  // 2. Resolve safe path
  const absPath = workspaceManager.resolveSafePath(relativePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`File does not exist: ${relativePath}`);
  }

  const currentContent = fs.readFileSync(absPath, 'utf-8');
  let updatedContent = currentContent;
  let matchedTier: 1 | 2 | 3 | undefined;

  // 3. Alternative Input: Unified diff or full-file replacement
  const isUnifiedDiff = Boolean(
    repaired.diff ||
    repaired.old_str.includes('diff --git') ||
    repaired.old_str.includes('@@ ')
  );

  if (isUnifiedDiff) {
    const rawDiff = repaired.diff || repaired.old_str;
    const parsedDiffs = diff.parsePatch(rawDiff);
    if (!parsedDiffs || parsedDiffs.length === 0) {
      throw new Error('Failed to parse unified diff');
    }
    const applied = diff.applyPatch(currentContent, parsedDiffs[0]);
    if (applied === false) {
      throw new Error('Unified diff failed to apply cleanly to current file content');
    }
    updatedContent = applied;
  } else if (repaired.full_file) {
    // Full-file replacement mode
    updatedContent = repaired.new_str;
  } else {
    // 4. Three-Tier Matcher
    const match = matchAndReplace(currentContent, repaired.old_str, repaired.new_str);
    if (!match.matched) {
      const err = match.error || { code: 'MATCH_FAILED', message: 'old_str not found' };
      throw new Error(`old_str not found: ${err.message}`);
    }
    matchedTier = match.tier;
    updatedContent =
      currentContent.slice(0, match.startIndex) +
      match.replacementText +
      currentContent.slice(match.endIndex);
  }

  // 5. In-Memory Validation Pipeline (Syntax check on python files)
  if (relativePath.endsWith('.py')) {
    const syntax = validatePythonSource(updatedContent);
    if (!syntax.valid) {
      const firstError = syntax.errors[0] || 'Python syntax error in proposed replacement';
      throw new Error(`[SYNTAX_ERROR] ${firstError}`);
    }
  }

  // 6. Calculate diff and parse hunks server-side
  const patchString = diff.createPatch(relativePath, currentContent, updatedContent);
  const parsed = diff.parsePatch(patchString);

  const stagedHunks: StagedHunk[] = [];
  if (parsed && parsed.length > 0) {
    for (const fileDiff of parsed) {
      for (const h of fileDiff.hunks) {
        const hunkId = `hunk-${crypto.randomUUID()}`;
        stagedHunks.push({
          id: hunkId,
          file: relativePath,
          oldStart: h.oldStart,
          oldLines: h.oldLines,
          newStart: h.newStart,
          newLines: h.newLines,
          content: h.lines.join('\n')
        });
      }
    }
  }

  // 7. Hunk Dependency Graph
  const depMap = buildHunkDependencyGraph(stagedHunks);
  for (const hunk of stagedHunks) {
    const deps = depMap.get(hunk.id);
    if (deps && deps.length > 0) {
      hunk.dependsOn = deps;
    }
  }

  const patchId = `patch-${crypto.randomUUID()}`;
  const stagedPatch: StagedPatch = {
    id: patchId,
    targetFile: relativePath,
    hunks: stagedHunks,
    summary: repaired.summary || `Edit in ${relativePath}`,
    createdAt: Date.now(),
    initialContent: currentContent
  };

  // 8. Stage in memory ONLY - never write to disk!
  patchStore.stagePatch(stagedPatch);

  const sessionId =
    params.session_id ||
    params.sessionId ||
    defaultSessionStateManager.getSession()?.sessionId ||
    'active';
  console.log(`[forge] patch staged by propose_edit session=${sessionId}`);

  const hunkIds = stagedHunks.map(h => h.id);
  const resultText = `Staged edit patch ${patchId} for ${relativePath} (${stagedHunks.length} hunks, tier ${matchedTier || 'diff'}). Disk remains unchanged.`;

  const depRecord: Record<string, string[]> = {};
  for (const [k, v] of depMap.entries()) {
    depRecord[k] = v;
  }

  return {
    ok: true,
    patch_id: patchId,
    hunk_ids: hunkIds,
    hunks_count: stagedHunks.length,
    target_file: relativePath,
    summary: stagedPatch.summary,
    diff: patchString,
    rawText: sanitizeToolOutput(resultText),
    tier: matchedTier,
    dependencies: Object.keys(depRecord).length > 0 ? depRecord : undefined
  };
}
