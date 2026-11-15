import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceManager } from '../workspace';
import { isPathSafe } from '../../shared/validation';
import { sanitizeToolOutput } from '../sanitize';

export interface SearchSymbolsParams {
  query: string;
}

export interface SymbolLocation {
  name: string;
  type: 'function' | 'class' | 'method' | 'interface';
  file: string;
  line: number;
  signature?: string;
  docstring?: string;
}

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.venv', 'dist', 'out', '.pytest_cache', '__pycache__']);

function findFilesWithExt(dir: string, root: string, exts: string[]): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(root, fullPath).replace(/\\/g, '/');
    if (!isPathSafe(relPath, root)) {
      continue;
    }
    if (entry.isDirectory()) {
      results.push(...findFilesWithExt(fullPath, root, exts));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (exts.includes(ext)) {
        results.push(relPath);
      }
    }
  }
  return results;
}

function runPythonSymbolsScript(scriptPath: string, targetFile: string): Promise<any> {
  const tryExecutable = (cmd: string): Promise<any> => {
    return new Promise((resolve) => {
      child_process.execFile(
        cmd,
        [scriptPath, targetFile],
        { timeout: 10000, shell: false },
        (error, stdout) => {
          if (error) {
            resolve(null);
            return;
          }
          try {
            resolve(JSON.parse(stdout));
          } catch {
            resolve(null);
          }
        }
      );
    });
  };

  // Try python3 first, then python as fallback
  return tryExecutable('python3').then((res) => {
    if (res !== null) return res;
    return tryExecutable('python');
  });
}

function searchTypeScriptSymbols(absPath: string, relPath: string, lowerQuery: string): SymbolLocation[] {
  const matches: SymbolLocation[] = [];
  let content: string;
  try {
    content = fs.readFileSync(absPath, 'utf-8');
  } catch {
    return matches;
  }

  const lines = content.split(/\r?\n/);
  // Match functions, classes, interfaces, methods
  const regex = /^\s*(export\s+)?(default\s+)?(async\s+)?(function|class|interface|type)\s+([a-zA-Z0-9_$]+)/;
  const methodRegex = /^\s*(public|private|protected)?\s*(async\s+)?([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*[:{]/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(regex);
    if (match) {
      const kind = match[4] as 'function' | 'class' | 'interface';
      const name = match[5];
      if (name.toLowerCase().includes(lowerQuery)) {
        matches.push({
          name,
          type: kind,
          file: relPath,
          line: i + 1,
          signature: line.trim().replace(/{$/, '').trim()
        });
      }
      continue;
    }

    const mMatch = line.match(methodRegex);
    if (mMatch) {
      const methodName = mMatch[3];
      if (methodName !== 'if' && methodName !== 'for' && methodName !== 'while' && methodName !== 'switch') {
        if (methodName.toLowerCase().includes(lowerQuery)) {
          matches.push({
            name: methodName,
            type: 'method',
            file: relPath,
            line: i + 1,
            signature: line.trim().replace(/{$/, '').trim()
          });
        }
      }
    }
  }

  return matches;
}

export async function executeSearchSymbols(
  params: SearchSymbolsParams,
  workspaceManager: WorkspaceManager
): Promise<{ symbols: SymbolLocation[]; rawText: string }> {
  const { query } = params;
  if (!query || typeof query !== 'string') {
    throw new Error('Symbol query must be a non-empty string');
  }

  const root = workspaceManager.getRoot();
  const lowerQuery = query.toLowerCase();
  const matchedSymbols: SymbolLocation[] = [];

  const scriptPath = path.resolve(root, 'scripts/symbols.py');
  const hasPythonScript = fs.existsSync(scriptPath);

  // Scan Python files
  const pythonFiles = findFilesWithExt(root, root, ['.py']);
  for (const relFile of pythonFiles) {
    let absPath: string;
    try {
      absPath = workspaceManager.resolveSafePath(relFile);
    } catch {
      continue;
    }

    if (hasPythonScript) {
      const pyResult = await runPythonSymbolsScript(scriptPath, absPath);
      if (pyResult && Array.isArray(pyResult.symbols)) {
        for (const item of pyResult.symbols) {
          if (item.type === 'class') {
            if (item.name.toLowerCase().includes(lowerQuery)) {
              matchedSymbols.push({
                name: item.name,
                type: 'class',
                file: relFile,
                line: item.line,
                signature: `class ${item.name}`,
                docstring: item.docstring || ''
              });
            }
            if (Array.isArray(item.methods)) {
              for (const m of item.methods) {
                if (m.name.toLowerCase().includes(lowerQuery)) {
                  matchedSymbols.push({
                    name: `${item.name}.${m.name}`,
                    type: 'method',
                    file: relFile,
                    line: m.line,
                    signature: m.signature,
                    docstring: m.docstring || ''
                  });
                }
              }
            }
          } else if (item.type === 'function') {
            if (item.name.toLowerCase().includes(lowerQuery)) {
              matchedSymbols.push({
                name: item.name,
                type: 'function',
                file: relFile,
                line: item.line,
                signature: item.signature,
                docstring: item.docstring || ''
              });
            }
          }
        }
        continue;
      }
    }

    // Fallback simple regex parsing for python if python command unavailable
    let content: string;
    try {
      content = fs.readFileSync(absPath, 'utf-8');
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fnMatch = line.match(/^\s*(async\s+)?def\s+([a-zA-Z0-9_$]+)\s*\(([^)]*)\)/);
      if (fnMatch && fnMatch[2].toLowerCase().includes(lowerQuery)) {
        matchedSymbols.push({
          name: fnMatch[2],
          type: 'function',
          file: relFile,
          line: i + 1,
          signature: `def ${fnMatch[2]}(${fnMatch[3]})`
        });
      }
      const clsMatch = line.match(/^\s*class\s+([a-zA-Z0-9_$]+)/);
      if (clsMatch && clsMatch[1].toLowerCase().includes(lowerQuery)) {
        matchedSymbols.push({
          name: clsMatch[1],
          type: 'class',
          file: relFile,
          line: i + 1,
          signature: `class ${clsMatch[1]}`
        });
      }
    }
  }

  // Scan TypeScript and JavaScript files
  const tsFiles = findFilesWithExt(root, root, ['.ts', '.js']);
  for (const relFile of tsFiles) {
    let absPath: string;
    try {
      absPath = workspaceManager.resolveSafePath(relFile);
    } catch {
      continue;
    }
    const tsMatches = searchTypeScriptSymbols(absPath, relFile, lowerQuery);
    matchedSymbols.push(...tsMatches);
  }

  const formatted = matchedSymbols.map(s => {
    let str = `${s.file}:${s.line} [${s.type}] ${s.name}`;
    if (s.signature) {
      str += ` | ${s.signature}`;
    }
    if (s.docstring) {
      str += ` -- "${s.docstring}"`;
    }
    return str;
  }).join('\n');

  const summary = matchedSymbols.length > 0
    ? `Found ${matchedSymbols.length} symbols matching "${query}":\n${formatted}`
    : `No symbols found matching "${query}".`;

  return {
    symbols: matchedSymbols,
    rawText: sanitizeToolOutput(summary)
  };
}
