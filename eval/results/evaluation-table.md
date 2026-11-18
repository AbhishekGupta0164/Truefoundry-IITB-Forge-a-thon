# TrueForge Multi-Model Evaluation Matrix

*Evaluated on: 2026-11-18T12:00:54.880Z*

| Model | Tier | Runs | Pass Rate | Median Latency | Median Tokens | Median Tool Calls | Flake Rate | Most Common Failure |
|---|---|---|---|---|---|---|---|---|
| **Claude 3.5 Sonnet (Strong Hosted Demo Model)** | strong_hosted | 6 | **0%** | 9 ms | 0 | 1 | 0% | UnprocessableEntityError
Status code: 422
Body: {
  "error": {
    "message": "Model name must be a fully qualified \"provider/model\": qwen2.5-coder:7b"
  }
} |
| **Gemini 1.5 Flash (Hosted Free-Tier Model)** | free_tier | 6 | **0%** | 7 ms | 0 | 1 | 0% | UnprocessableEntityError
Status code: 422
Body: {
  "error": {
    "message": "Model name must be a fully qualified \"provider/model\": qwen2.5-coder:7b"
  }
} |
| **Llama 3.2 3B (Local Evaluation Model)** | local_3b | 6 | **0%** | 11 ms | 0 | 1 | 0% | UnprocessableEntityError
Status code: 422
Body: {
  "error": {
    "message": "Model name must be a fully qualified \"provider/model\": qwen2.5-coder:7b"
  }
} |

## Machine-Scored Rubric Criteria
- **Task A (Inline Edit)**:
  - Syntax check: Python AST parses with zero syntax errors.
  - Boolean logic: returns `False` for `'off'`, `'n'`, `'N'`, `'Off'` case-insensitively.
  - Docstring: explicitly documents all false values (`'0'`, `'false'`, `'no'`, `'off'`, `'n'`).
  - Scope: only `get_debug_flag` area modified; zero outer pollution.
- **Task B (Agent Panel CLI)**:
  - Multi-file change: at least 3 files modified (`cli.py`, `tests/test_cli.py`, `docs/...`).
  - Test verification: `pytest tests/test_cli.py` executes and passes.
  - CLI discovery: `flask --help` displays `config` command.
  - Secret protection: values for keys with `SECRET`, `PASSWORD`, `TOKEN`, `KEY` masked as `'***'`.
  - Workspace safety: `git status --porcelain` clean before user approval.
