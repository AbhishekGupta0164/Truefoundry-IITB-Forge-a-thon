import * as fs from 'fs';
import { WorkspaceManager } from '../mcp/workspace';
import { ContextEntry } from '../shared/types';
import { RETRIEVED_CONTEXT_BUDGET } from '../shared/constants';
import { executeSearchSymbols } from '../mcp/tools/search_symbols';
import { ContextLedger, defaultContextLedger } from './ledger';

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

  // Editor-style shorthand: @src/flask/cli.py (a path with a file extension)
  const pathRegex = /(^|\s)@(?!file\b|symbol\b)([\w.\-/]+\.[A-Za-z0-9]+)(?=$|[\s,;])/g;
  while ((match = pathRegex.exec(prompt)) !== null) {
    const raw = match[2].replace(/[.]+$/, '');
    if (raw && !files.includes(raw)) {
      files.push(raw);
    }
  }

  const cleanPrompt = prompt
    .replace(fileRegex, '')
    .replace(symbolRegex, '')
    .replace(pathRegex, '$1')
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

export interface MentionContext {
  /** The prompt with the @mentions removed. */
  prompt: string;
  /** Text block with the mentioned code, sent to the agent ahead of the prompt; empty if none. */
  contextSummary: string;
  /** What was included, for the context map. */
  entries: ContextEntry[];
  /** Mentions that could not be resolved, with the reason. */
  unresolved: { mention: string; reason: string }[];
}

const APPROX_CHARS_PER_TOKEN = 4;

/**
 * Turn @file / @symbol mentions into explicit context for the agent, within the
 * retrieved-context budget (files, lines per read, tokens). Nothing is added when the
 * prompt has no mentions, so agent mode never receives filenames the user did not type.
 * Every included item is recorded in the context ledger with the reason "mentioned by the user".
 */
export async function buildMentionContext(
  rawPrompt: string,
  workspaceManager: WorkspaceManager,
  ledger: ContextLedger = defaultContextLedger
): Promise<MentionContext> {
  const parsed = parseMentions(rawPrompt);
  const result: MentionContext = { prompt: parsed.cleanPrompt || rawPrompt, contextSummary: '', entries: [], unresolved: [] };
  if (parsed.files.length === 0 && parsed.symbols.length === 0) {
    return { ...result, prompt: rawPrompt };
  }

  const blocks: string[] = [];
  let usedTokens = 0;
  const maxLines = RETRIEVED_CONTEXT_BUDGET.MAX_LINES_PER_READ;
  const fitsBudget = (text: string) => usedTokens + Math.ceil(text.length / APPROX_CHARS_PER_TOKEN) <= RETRIEVED_CONTEXT_BUDGET.MAX_TOKENS;

  const addBlock = (label: string, path: string, startLine: number, lines: string[], totalLines: number, kind: string) => {
    if (result.entries.length >= RETRIEVED_CONTEXT_BUDGET.MAX_FILES) {
      result.unresolved.push({ mention: label, reason: `context budget reached (${RETRIEVED_CONTEXT_BUDGET.MAX_FILES} items)` });
      ledger.recordSkipped(path, 'context budget reached', 'mention');
      return;
    }
    const endLine = startLine + lines.length - 1;
    const block = `### ${label}: ${path} (lines ${startLine}-${endLine} of ${totalLines})\n${lines.join('\n')}`;
    if (!fitsBudget(block)) {
      result.unresolved.push({ mention: label, reason: 'context budget reached (tokens)' });
      ledger.recordSkipped(path, 'context budget reached', 'mention');
      return;
    }
    const tokens = Math.ceil(block.length / APPROX_CHARS_PER_TOKEN);
    usedTokens += tokens;
    blocks.push(block);
    ledger.recordRead(path, startLine, endLine, `mentioned by the user (${kind})`, tokens, 'mention');
    result.entries.push({
      id: `mention-${kind}-${path}-${startLine}`,
      type: kind === '@symbol' ? 'symbol' : 'file',
      uri: path,
      content: '',
      tokenCount: tokens,
      metadata: { reason: `mentioned by the user (${kind})`, lineRange: `L${startLine}-${endLine}` }
    });
  };

  for (const relPath of parsed.files) {
    try {
      const absPath = workspaceManager.resolveSafePath(relPath);
      if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
        result.unresolved.push({ mention: `@${relPath}`, reason: 'file not found in the workspace' });
        continue;
      }
      const all = fs.readFileSync(absPath, 'utf-8').split(/\r?\n/);
      addBlock('@file', relPath, 1, all.slice(0, maxLines), all.length, '@file');
    } catch (err: any) {
      result.unresolved.push({ mention: `@${relPath}`, reason: err?.message ?? 'not allowed' });
    }
  }

  for (const name of parsed.symbols) {
    try {
      const { symbols } = await executeSearchSymbols({ query: name, reason: 'mentioned by the user (@symbol)' }, workspaceManager);
      const exact = symbols.filter((s) => s.name === name);
      const picks = (exact.length > 0 ? exact : symbols).slice(0, 3);
      if (picks.length === 0) {
        result.unresolved.push({ mention: `@symbol:${name}`, reason: 'no definition found' });
        continue;
      }
      for (const sym of picks) {
        const absPath = workspaceManager.resolveSafePath(sym.file);
        const all = fs.readFileSync(absPath, 'utf-8').split(/\r?\n/);
        const start = Math.max(1, sym.line);
        addBlock(`@symbol ${sym.name}`, sym.file, start, all.slice(start - 1, start - 1 + 60), all.length, '@symbol');
      }
    } catch (err: any) {
      result.unresolved.push({ mention: `@symbol:${name}`, reason: err?.message ?? 'lookup failed' });
    }
  }

  if (blocks.length > 0) {
    result.contextSummary = [
      'The user explicitly mentioned the following code. Use it, and still search for anything else the task needs.',
      ...blocks
    ].join('\n\n');
  }
  return result;
}
