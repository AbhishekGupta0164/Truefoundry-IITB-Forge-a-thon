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

  // 2. Documentation: a page named after the module, then top-level docs that mention it
  const docExts = ['.md', '.rst', '.txt'];
  for (const dir of ['docs', 'doc']) {
    for (const docExt of docExts) {
      const candidate = `${dir}/${stem}${docExt}`;
      if (fs.existsSync(path.join(root, candidate))) {
        suggestions.push({
          path: candidate,
          type: 'doc',
          reason: `Documentation page named after ${baseName}`
        });
      }
    }
  }

  // Dotted module name, e.g. src/flask/cli.py -> flask.cli, used to spot references in docs
  const moduleName = normalized
    .replace(/^src\//, '')
    .replace(/\.(py|ts|js)$/, '')
    .split('/')
    .join('.');
  // The README next to the file, then the repository README, then top-level docs pages
  const localDir = path.posix.dirname(normalized);
  const referenceDocs: string[] = localDir && localDir !== '.'
    ? [`${localDir}/README.md`, `${localDir}/README.rst`, 'README.md', 'README.rst']
    : ['README.md', 'README.rst'];
  for (const dir of ['docs', 'doc']) {
    const full = path.join(root, dir);
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
      for (const entry of fs.readdirSync(full).slice(0, 200)) {
        if (docExts.includes(path.extname(entry))) referenceDocs.push(`${dir}/${entry}`);
      }
    }
  }
  for (const candidate of referenceDocs) {
    if (suggestions.length >= 8) break;
    if (suggestions.some((s) => s.path === candidate)) continue;
    const full = path.join(root, candidate);
    if (!fs.existsSync(full)) continue;
    try {
      const docContent = fs.readFileSync(full, 'utf-8');
      const mentionsModule = moduleName.includes('.') && docContent.includes(moduleName);
      if (mentionsModule || docContent.includes(baseName)) {
        suggestions.push({
          path: candidate,
          type: 'doc',
          reason: `Documentation in ${candidate} references ${mentionsModule ? moduleName : baseName}`
        });
      }
    } catch {
      // unreadable doc: skip it
    }
  }

  // Each path once, in discovery order
  const seen = new Set<string>();
  const unique = suggestions.filter((s) => (seen.has(s.path) ? false : (seen.add(s.path), true)));
  suggestions.length = 0;
  suggestions.push(...unique);

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
