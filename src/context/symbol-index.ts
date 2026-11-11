import { WorkspaceManager } from '../mcp/workspace';
import { executeSearchSymbols, SymbolLocation } from '../mcp/tools/search_symbols';

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
