import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceManager } from '../mcp/workspace';
import { executeSearchSymbols, SymbolLocation } from '../mcp/tools/search_symbols';

export interface SymbolDefinition {
  name: string;
  type: 'function' | 'class' | 'variable';
  line: number;
  signature?: string;
  docstring?: string;
  methods?: SymbolDefinition[];
}

export interface FileSymbolEntry {
  filepath: string;
  mtimeMs: number;
  symbols: SymbolDefinition[];
}

/**
 * In-memory symbol index.
 * Built at activation and refreshed incrementally by file mtime,
 * so no Python process is spawned per call.
 */
export class InMemorySymbolIndex {
  private cache = new Map<string, FileSymbolEntry>();
  private allSymbolNames = new Set<string>();

  constructor(private readonly workspaceRoot?: string) {}

  public getRoot(): string {
    return this.workspaceRoot || process.cwd();
  }

  public indexFile(filePath: string, content?: string): SymbolDefinition[] {
    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(this.getRoot(), filePath);

    let mtimeMs = 0;
    try {
      if (fs.existsSync(fullPath)) {
        mtimeMs = fs.statSync(fullPath).mtimeMs;
      }
    } catch {
      mtimeMs = Date.now();
    }

    const cached = this.cache.get(fullPath);
    if (cached && cached.mtimeMs === mtimeMs && !content) {
      return cached.symbols;
    }

    const source = content !== undefined ? content : (fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '');
    const symbols = this.parsePythonSymbols(source);

    if (cached) {
      this.rebuildAllNamesSet();
    }

    this.cache.set(fullPath, {
      filepath: fullPath,
      mtimeMs,
      symbols
    });

    for (const sym of symbols) {
      this.allSymbolNames.add(sym.name);
      if (sym.methods) {
        for (const m of sym.methods) {
          this.allSymbolNames.add(m.name);
        }
      }
    }

    return symbols;
  }

  public hasSymbol(symbolName: string): boolean {
    return this.allSymbolNames.has(symbolName);
  }

  public searchSymbols(query: string): SymbolDefinition[] {
    const results: SymbolDefinition[] = [];
    const lowerQuery = query.toLowerCase();

    for (const entry of this.cache.values()) {
      for (const sym of entry.symbols) {
        if (sym.name.toLowerCase().includes(lowerQuery)) {
          results.push(sym);
        }
        if (sym.methods) {
          for (const m of sym.methods) {
            if (m.name.toLowerCase().includes(lowerQuery)) {
              results.push(m);
            }
          }
        }
      }
    }

    return results;
  }

  public getIndexedFileCount(): number {
    return this.cache.size;
  }

  public getAllSymbolNames(): Set<string> {
    return new Set(this.allSymbolNames);
  }

  private parsePythonSymbols(code: string): SymbolDefinition[] {
    const lines = code.split('\n');
    const symbols: SymbolDefinition[] = [];
    let currentClass: SymbolDefinition | null = null;

    const funcRegex = /^([ \t]*)(?:async\s+)?def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)/;
    const classRegex = /^([ \t]*)class\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*\(([^)]*)\))?/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const classMatch = line.match(classRegex);
      if (classMatch) {
        const indent = classMatch[1].length;
        if (indent === 0) {
          currentClass = {
            name: classMatch[2],
            type: 'class',
            line: i + 1,
            docstring: this.extractDocstring(lines, i + 1),
            methods: []
          };
          symbols.push(currentClass);
          continue;
        }
      }

      const funcMatch = line.match(funcRegex);
      if (funcMatch) {
        const indent = funcMatch[1].length;
        const name = funcMatch[2];
        const args = funcMatch[3];
        const docstring = this.extractDocstring(lines, i + 1);

        const funcDef: SymbolDefinition = {
          name,
          type: 'function',
          line: i + 1,
          signature: `def ${name}(${args})`,
          docstring
        };

        if (indent > 0 && currentClass) {
          currentClass.methods?.push(funcDef);
        } else {
          currentClass = null;
          symbols.push(funcDef);
        }
        continue;
      }

      const lineIndent = line.search(/\S/);
      if (lineIndent === 0 && !line.startsWith(' ') && !line.startsWith('\t')) {
        currentClass = null;
      }
    }

    return symbols;
  }

  private extractDocstring(lines: string[], startLineIndex: number): string {
    if (startLineIndex >= lines.length) {
      return '';
    }
    const nextLine = lines[startLineIndex].trim();
    if (nextLine.startsWith('"""') || nextLine.startsWith("'''")) {
      const quote = nextLine.slice(0, 3);
      const rest = nextLine.slice(3);
      if (rest.endsWith(quote) && rest.length >= 3) {
        return rest.slice(0, -3).trim();
      }
      return rest.trim();
    }
    return '';
  }

  private rebuildAllNamesSet(): void {
    this.allSymbolNames.clear();
    for (const entry of this.cache.values()) {
      for (const sym of entry.symbols) {
        this.allSymbolNames.add(sym.name);
        if (sym.methods) {
          for (const m of sym.methods) {
            this.allSymbolNames.add(m.name);
          }
        }
      }
    }
  }

  public clear(): void {
    this.cache.clear();
    this.allSymbolNames.clear();
  }
}

export class SymbolIndex {
  private cache = new Map<string, SymbolLocation[]>();

  constructor(private workspaceManager: WorkspaceManager = new WorkspaceManager()) {}

  /**
   * Look up symbols matching a query.
   */
  public async findSymbol(query: string): Promise<SymbolLocation[]> {
    const cached = this.cache.get(query.toLowerCase());
    if (cached) {
      return cached;
    }

    const result = await executeSearchSymbols({ query }, this.workspaceManager);
    this.cache.set(query.toLowerCase(), result.symbols);
    return result.symbols;
  }

  public clear(): void {
    this.cache.clear();
  }
}

export const defaultSymbolIndex = new SymbolIndex();

