import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceManager } from '../workspace';
import { sanitizeToolOutput } from '../sanitize';
import { defaultContextLedger } from '../../context/ledger';

export interface FindRelatedParams {
  path: string;
  reason?: string;
}

export interface RelatedItem {
  path: string;
  type: 'test' | 'doc' | 'implementation' | 'config';
  reason: string;
}

export interface FindRelatedResult {
  targetPath: string;
  related: RelatedItem[];
  rawText: string;
}

export async function executeFindRelated(
  params: FindRelatedParams,
  workspaceManager: WorkspaceManager
): Promise<FindRelatedResult> {
  const { path: targetPath } = params;
  const reason = params.reason || 'finding related files';
  if (!targetPath || typeof targetPath !== 'string') {
    throw new Error('Path must be a non-empty string');
  }

  // Dedup check: repeat call returns 'already executed earlier' and costs 0 budget
  const duplicate = defaultContextLedger.checkDuplicate('find_related', targetPath);
  if (duplicate) {
    return {
      targetPath,
      related: [],
      rawText: sanitizeToolOutput(`already found related files for "${targetPath}" earlier`)
    };
  }

  // Validate workspace safety
  workspaceManager.resolveSafePath(targetPath);

  const root = workspaceManager.getRoot();
  const normalized = targetPath.replace(/\\/g, '/');
  const baseName = path.basename(normalized);
  const ext = path.extname(baseName);
  const stem = path.basename(baseName, ext);

  const suggestions: RelatedItem[] = [];

  // 1. Check for test conventions
  const testCandidates = [
    `tests/test_${stem}.py`,
    `test/unit/${stem}.test.ts`,
    `test/${stem}.test.ts`,
    `tests/${stem}_test.py`,
    `test/e2e/${stem}.test.ts`,
    `tests/test_${stem.replace(/^test_/, '')}.py`
  ];

  for (const candidate of testCandidates) {
    const full = path.join(root, candidate);
    if (fs.existsSync(full)) {
      suggestions.push({
        path: candidate,
        type: 'test',
        reason: `Direct matching test file for ${baseName}`
      });
    }
  }

  // If the file itself is a test file, find its implementation
  if (normalized.includes('test') || baseName.startsWith('test_') || baseName.endsWith('.test.ts')) {
    const cleanStem = stem.replace(/^test_/, '').replace(/\.test$/, '');
    const implCandidates = [
      `src/${cleanStem}.ts`,
      `src/mcp/tools/${cleanStem}.ts`,
      `src/shared/${cleanStem}.ts`,
      `src/${cleanStem}.py`,
      `flask/${cleanStem}.py`
    ];
    for (const candidate of implCandidates) {
      const full = path.join(root, candidate);
      if (fs.existsSync(full)) {
        suggestions.push({
          path: candidate,
          type: 'implementation',
          reason: `Likely source implementation for test file ${baseName}`
        });
      }
    }
  }

  // 2. Check for documentation conventions
  const docCandidates = [
    `docs/${stem}.md`,
    `docs/architecture.md`,
    `docs/review-safety.md`,
    `docs/model-setup.md`,
    `docs/context-strategy.md`,
    `README.md`,
    `src/mcp/README.md`,
    `src/context/README.md`,
    `src/ui/README.md`,
    `src/review/README.md`
  ];

  for (const candidate of docCandidates) {
    const full = path.join(root, candidate);
    if (fs.existsSync(full)) {
      try {
        const docContent = fs.readFileSync(full, 'utf-8');
        if (docContent.includes(stem) || docContent.includes(baseName)) {
          suggestions.push({
            path: candidate,
            type: 'doc',
            reason: `Documentation in ${candidate} explicitly references ${baseName}`
          });
        }
      } catch {
        // ignore read errors
      }
    }
  }

  for (const s of suggestions) {
    defaultContextLedger.recordSearched(s.path, s.reason || reason, 'find_related');
  }

  // Format response
  const lines = suggestions.map(s => `- [${s.type.toUpperCase()}] ${s.path} (${s.reason})`);
  const summary = suggestions.length > 0
    ? `Related files for ${targetPath}:\n${lines.join('\n')}`
    : `No directly related test or documentation files identified for ${targetPath}.`;

  return {
    targetPath,
    related: suggestions,
    rawText: sanitizeToolOutput(summary)
  };
}
