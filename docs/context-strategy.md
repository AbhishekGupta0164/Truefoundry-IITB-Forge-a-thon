# Context Retrieval & Budget Strategy

## Visible Retrieved Context Budget (B1 Anchor)
Strictly enforced in `src/context/budget.ts`:
- **Max Retrieved Tokens**: 12,000 tokens per task run.
- **Max Files Consulted**: 8 unique files per task.
- **Max Search Hits**: 30 hits per turn.
- **Max Lines Per Read**: 200 lines per call.

## Overall Run Safety Cap
- **Max Total Model Tokens**: 100,000 tokens.
- **Max Cost**: \$2.00 USD.
- **Max Iterations**: 30 turns.

## Retrieval Priority Order
1. **Explicit Mentions**: `@file:path` and `@symbol:name` provided by the user receive first priority.
2. **Structural Repo-Map**: Cached AST overview of definitions (~1–2K tokens).
3. **Targeted Text Search**: `search_text` scoped to candidate files (capped at ≤30 hits).
4. **Focused File Reads**: `read_file` with explicit rationale (capped at ≤200 lines per call).
5. **Related Artifacts**: Automatic discovery of paired unit tests and documentation via `find_related`.
