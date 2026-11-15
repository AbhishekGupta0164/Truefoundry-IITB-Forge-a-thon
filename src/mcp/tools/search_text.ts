import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceManager } from '../workspace';
import { ContextBudgetTracker } from '../../context/budget';
import { isPathSafe } from '../../shared/validation';
import { sanitizeToolOutput } from '../sanitize';
import { RETRIEVED_CONTEXT_BUDGET } from '../../shared/constants';

export interface SearchTextParams {
  query: string;
  glob?: string;
  reason?: string;
}

export interface SearchHit {
  file: string;
  line: number;
  snippet: string;
}

export interface SearchTextResult {
  hits: SearchHit[];
  totalHits: number;
  truncated: boolean;
  rawText: string;
}

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.venv', 'dist', 'out', '.pytest_cache', '__pycache__']);
const TEXT_EXTENSIONS = new Set([
  '.ts', '.js', '.mjs', '.cjs', '.json', '.py', '.md', '.txt', '.yml', '.yaml',
  '.html', '.css', '.toml', '.rst', '.sh', '.xml', '.svg'
]);

function shouldScanFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

function walkWorkspaceFiles(
  dir: string,
  root: string,
  globFilter?: string
): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const entryName = entry.name;
    if (IGNORED_DIRS.has(entryName)) {
      continue;
    }

    const fullPath = path.join(dir, entryName);
    const relPath = path.relative(root, fullPath).replace(/\\/g, '/');

    if (!isPathSafe(relPath, root)) {
      continue;
    }

    if (entry.isDirectory()) {
      results.push(...walkWorkspaceFiles(fullPath, root, globFilter));
    } else if (entry.isFile()) {
      if (globFilter) {
        // Simple glob match: supports *.ext or prefix* or exact match
        const matchesGlob = matchSimpleGlob(entryName, relPath, globFilter);
        if (!matchesGlob) {
          continue;
        }
      }
      if (shouldScanFile(fullPath)) {
        results.push(relPath);
      }
    }
  }

  return results;
}

function matchSimpleGlob(fileName: string, relPath: string, glob: string): boolean {
  if (glob === '*' || glob === '**/*') {
    return true;
  }
  const cleanGlob = glob.replace(/\\/g, '/');
  if (cleanGlob.startsWith('*.')) {
    const ext = cleanGlob.slice(1);
    return fileName.endsWith(ext) || relPath.endsWith(ext);
  }
  const regexStr = '^' + cleanGlob.replace(/\./g, '\\.').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$';
  try {
    const regex = new RegExp(regexStr, 'i');
    return regex.test(relPath) || regex.test(fileName);
  } catch {
    return relPath.includes(cleanGlob);
  }
}

export async function executeSearchText(
  params: SearchTextParams,
  workspaceManager: WorkspaceManager,
  budgetTracker: ContextBudgetTracker
): Promise<SearchTextResult> {
  const { query, glob: globFilter } = params;

  if (!query || typeof query !== 'string') {
    throw new Error('Search query must be a non-empty string');
  }

  const root = workspaceManager.getRoot();
  const candidateFiles = walkWorkspaceFiles(root, root, globFilter);
  const maxHits = RETRIEVED_CONTEXT_BUDGET.MAX_SEARCH_HITS;
  const hits: SearchHit[] = [];

  const lowerQuery = query.toLowerCase();

  for (const relFile of candidateFiles) {
    if (hits.length >= maxHits) {
      break;
    }

    let absPath: string;
    try {
      absPath = workspaceManager.resolveSafePath(relFile);
    } catch {
      continue;
    }

    let fileContent: string;
    try {
      fileContent = fs.readFileSync(absPath, 'utf-8');
    } catch {
      continue;
    }

    const lines = fileContent.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (hits.length >= maxHits) {
        break;
      }
      const line = lines[i];
      if (line.toLowerCase().includes(lowerQuery)) {
        hits.push({
          file: relFile,
          line: i + 1,
          snippet: line.trim()
        });
      }
    }
  }

  budgetTracker.recordSearch(hits.length);

  const formattedHits = hits
    .map(h => `${h.file}:${h.line}: ${h.snippet}`)
    .join('\n');

  const summary = hits.length > 0
    ? `Found ${hits.length} matches for "${query}":\n${formattedHits}`
    : `No matches found for "${query}".`;

  return {
    hits,
    totalHits: hits.length,
    truncated: hits.length >= maxHits,
    rawText: sanitizeToolOutput(summary)
  };
}
