import { InMemorySymbolIndex, SymbolDefinition } from '../../context/symbol-index';

export interface SearchSymbolsInput {
  query: string;
  reason?: string;
}

export function executeSearchSymbols(
  input: SearchSymbolsInput,
  symbolIndex: InMemorySymbolIndex
): { success: boolean; symbols?: SymbolDefinition[]; error?: string } {
  try {
    const symbols = symbolIndex.searchSymbols(input.query);
    return { success: true, symbols };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
