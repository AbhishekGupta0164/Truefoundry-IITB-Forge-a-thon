/**
 * search_text MCP tool
 * Grep-like text search across workspace files.
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { ContextBudgetTracker } from '../../context/budget';
import { WorkspaceManager } from '../workspace';
import { sanitizeToolOutput } from '../sanitize';

export const SearchTextInput = z.object({
  pattern: z.string().describe('Text or regex pattern to search for'),
  fileGlob: z.string().optional().describe('File glob pattern, e.g. "**/*.py" (default: all text files)'),
  maxResults: z.number().int().min(1).max(50).optional().default(20).describe('Maximum number of matching lines to return')
});

export type SearchTextInput = z.infer<typeof SearchTextInput>;

const TEXT_EXTENSIONS = new Set([
  '.ts', '.js', '.py', '.json', '.md', '.txt', '.yaml', '.yml',
  '.toml', '.cfg', '.ini', '.sh', '.bash', '.html', '.css'
]);

function walk(dir: string, maxFiles = 500): string[] {
  const results: string[] = [];
  const stack = [dir];
  while (stack.length && results.length < maxFiles) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (TEXT_EXTENSIONS.has(path.extname(entry.name))) {
        results.push(full);
      }
    }
  }
  return results;
}

export function makeSearchTextTool(workspace: WorkspaceManager, budget: ContextBudgetTracker) {
  return {
    name: 'search_text',
    description: 'Search for a text pattern across workspace files. Returns matching lines with file:line context.',
    inputSchema: SearchTextInput,
    async execute(input: SearchTextInput): Promise<string> {
      const root = workspace.getRoot();
      const files = walk(root);
      let regex: RegExp;
      try {
        regex = new RegExp(input.pattern, 'i');
      } catch {
        return sanitizeToolOutput(`Error: Invalid regex pattern: ${input.pattern}`);
      }

      const matches: string[] = [];
      let hitCount = 0;

      for (const file of files) {
        if (matches.length >= (input.maxResults ?? 20)) break;
        let content: string;
        try {
          content = fs.readFileSync(file, 'utf-8');
        } catch {
          continue;
        }
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            const relPath = path.relative(root, file);
            matches.push(`${relPath}:${i + 1}: ${lines[i].trim()}`);
            hitCount++;
            if (matches.length >= (input.maxResults ?? 20)) break;
          }
        }
      }

      budget.recordSearch(hitCount);

      if (matches.length === 0) {
        return sanitizeToolOutput(`No matches found for pattern: ${input.pattern}`);
      }
      return sanitizeToolOutput(matches.join('\n'));
    }
  };
}
