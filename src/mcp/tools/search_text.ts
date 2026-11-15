import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceManager } from '../workspace';
import { ContextBudgetTracker } from '../../context/budget';
import { isPathSafe } from '../../shared/validation';

export interface SearchTextInput {
  query: string;
  reason: string;
  max_results?: number;
}

export function executeSearchText(
  input: SearchTextInput,
  workspace: WorkspaceManager,
  budgetTracker?: ContextBudgetTracker
): { success: boolean; results?: Array<{ file: string; line: number; text: string }>; error?: string } {
  if (!input.reason || typeof input.reason !== 'string' || input.reason.trim().length === 0) {
    return { success: false, error: 'A short reason must be provided when searching text' };
  }
  if (!input.query) {
    return { success: false, error: 'Query cannot be empty' };
  }

  const root = workspace.getRoot();
  const maxResults = input.max_results ? Math.min(30, input.max_results) : 30;
  const results: Array<{ file: string; line: number; text: string }> = [];

  function walk(dir: string) {
    if (results.length >= maxResults) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= maxResults) break;
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(root, fullPath).replace(/\\/g, '/');

      if (!isPathSafe(relPath, root)) continue;
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.venv') continue;

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(input.query)) {
              results.push({
                file: relPath,
                line: i + 1,
                text: lines[i].trim()
              });
              if (results.length >= maxResults) break;
            }
          }
        } catch {}
      }
    }
  }

  try {
    walk(root);
    if (budgetTracker) {
      budgetTracker.recordSearch(results.length);
    }
    return { success: true, results };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
