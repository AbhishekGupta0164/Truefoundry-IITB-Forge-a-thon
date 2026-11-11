/**
 * search_symbols MCP tool
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { WorkspaceManager } from '../workspace';
import { sanitizeToolOutput } from '../sanitize';

export const SearchSymbolsInput = z.object({
  query: z.string().describe('Symbol name or pattern to search for'),
  kind: z.enum(['function', 'class', 'variable', 'any']).optional().default('any')
});

export type SearchSymbolsInput = z.infer<typeof SearchSymbolsInput>;

export function makeSearchSymbolsTool(workspace: WorkspaceManager) {
  return {
    name: 'search_symbols',
    description: 'Search for function, class, or variable declarations across workspace files.',
    inputSchema: SearchSymbolsInput,
    async execute(input: SearchSymbolsInput): Promise<string> {
      const root = workspace.getRoot();
      const results: string[] = [];
      const regex = new RegExp(`(?:def|class|function|const|let|var)\\s+([a-zA-Z0-9_]*${input.query}[a-zA-Z0-9_]*)`, 'i');

      function scan(dir: string, depth = 0) {
        if (depth > 5 || results.length >= 20) return;
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '.venv') continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scan(full, depth + 1);
          } else if (/\.(py|ts|js)$/.test(entry.name)) {
            try {
              const content = fs.readFileSync(full, 'utf-8');
              const lines = content.split('\n');
              for (let i = 0; i < lines.length; i++) {
                const match = lines[i].match(regex);
                if (match) {
                  const rel = path.relative(root, full);
                  results.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
                  if (results.length >= 20) break;
                }
              }
            } catch {}
          }
        }
      }

      scan(root);
      if (results.length === 0) {
        return sanitizeToolOutput(`No symbols matching '${input.query}' found.`);
      }
      return sanitizeToolOutput(results.join('\n'));
    }
  };
}
