import * as fs from 'fs';
import { WorkspaceManager } from '../mcp/workspace';
import { ContextEntry } from '../shared/types';

export interface ParsedMentions {
  files: string[];
  symbols: string[];
  cleanPrompt: string;
}

/**
 * Extracts @file and @symbol mentions from a prompt string.
 * Supports syntax:
 *   @file:path/to/file or @file path/to/file
 *   @symbol:FunctionName or @symbol FunctionName
 */
export function parseMentions(prompt: string): ParsedMentions {
  const files: string[] = [];
  const symbols: string[] = [];

  // Match @file:path or @file(path) or @file "path"
  const fileRegex = /@file(?::|\s+)([^\s,;]+)/g;
  let match: RegExpExecArray | null;
  while ((match = fileRegex.exec(prompt)) !== null) {
    const raw = match[1].replace(/["']/g, '');
    if (raw && !files.includes(raw)) {
      files.push(raw);
    }
  }

  // Match @symbol:name or @symbol name
  const symbolRegex = /@symbol(?::|\s+)([^\s,;]+)/g;
  while ((match = symbolRegex.exec(prompt)) !== null) {
    const raw = match[1].replace(/["']/g, '');
    if (raw && !symbols.includes(raw)) {
      symbols.push(raw);
    }
  }

  const cleanPrompt = prompt
    .replace(fileRegex, '')
    .replace(symbolRegex, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return { files, symbols, cleanPrompt };
}

/**
 * Resolves parsed mentions into verified ContextEntries from disk and workspace.
 */
export async function resolveFileMentions(
  fileMentions: string[],
  workspaceManager: WorkspaceManager
): Promise<ContextEntry[]> {
  const entries: ContextEntry[] = [];

  for (const relPath of fileMentions) {
    try {
      const absPath = workspaceManager.resolveSafePath(relPath);
      if (fs.existsSync(absPath)) {
        const content = fs.readFileSync(absPath, 'utf-8');
        entries.push({
          id: `mention-file-${relPath}`,
          type: 'file',
          uri: relPath,
          content: content.slice(0, 4000), // bounded preview
          tokenCount: Math.ceil(content.length / 4)
        });
      }
    } catch {
      // Ignore invalid or path traversal mentions
    }
  }

  return entries;
}
