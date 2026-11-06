# Known Limitations & Roadmap

## Current Stage Limitations
1. **Language Scope**: Symbol indexing and syntax check helpers (`scripts/symbols.py`, `scripts/check_py.py`) currently target Python (specifically calibrated for Flask). TypeScript / JavaScript AST helpers will be added in Stage 2.
2. **Terminal Interactivity**: Interactive terminal programs (such as `vim`, `less`, or interactive debuggers) are intentionally unsupported to prevent hung background processes.
3. **Binary Files**: File reading and diff patching operate strictly on UTF-8 text files; binary assets are ignored.

## Next Month Roadmap
- Multi-file atomic transaction rollbacks for cross-repository operations.
- Semantic code graph indexing via tree-sitter.
- Direct team collaboration mode sharing agent state between team members.
