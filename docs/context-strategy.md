# Context Retrieval & Budget Strategy

## Retrieval Priority Order
1. **Explicit Mentions**: `@file:path` and `@symbol:name` provided by the user receive first priority.
2. **Structural Repo-Map**: Cached AST overview of definitions (~1–2K tokens).
3. **Targeted Text Search**: `search_text` scoped to candidate files (capped at ≤30 hits).
4. **Focused File Reads**: `read_file` with explicit rationale (capped at ≤200 lines per call).
5. **Related Artifacts**: Automatic discovery of paired unit tests and documentation via `find_related`.

## Budget Caps
- **Max Total Tokens**: 100,000 tokens per task.
- **Max Search Hits**: 30 hits per turn.
- **Max File Lines**: 200 lines per read.
- **Max Turn Cost**: \$2.00 USD.
- **Budget Exceeded Action**: Truncates search results and forces the model to synthesize with current context.
