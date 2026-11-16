# TrueForge Model Evaluation Results

*Evaluated on: 2026-11-15T16:10:43.416Z*

| Model | Task | Result | Latency | Token Usage | Notes |
|---|---|---|---|---|---|
| Claude 3.5 Sonnet (Strong Hosted Demo Model) | Task A (Inline Edit) | **FAIL** | 16758 ms | 0 tokens | Can't reach the model at http://localhost:8790. Check TrueForge settings. |
| Claude 3.5 Sonnet (Strong Hosted Demo Model) | Task B (Agent CLI Command) | **FAIL** | 10296 ms | 0 tokens | Can't reach the model at http://localhost:8790. Check TrueForge settings. |
| Gemini 1.5 Flash (Hosted Free-Tier Model) | Task A (Inline Edit) | **FAIL** | 7069 ms | 0 tokens | Can't reach the model at http://localhost:8790. Check TrueForge settings. |
| Gemini 1.5 Flash (Hosted Free-Tier Model) | Task B (Agent CLI Command) | **FAIL** | 7044 ms | 0 tokens | Can't reach the model at http://localhost:8790. Check TrueForge settings. |
| Llama 3.2 3B (Local Evaluation Model) | Task A (Inline Edit) | **FAIL** | 7049 ms | 0 tokens | Can't reach the model at http://localhost:8790. Check TrueForge settings. |
| Llama 3.2 3B (Local Evaluation Model) | Task B (Agent CLI Command) | **FAIL** | 7049 ms | 0 tokens | Can't reach the model at http://localhost:8790. Check TrueForge settings. |

## Evaluation Methodology
- **Task A**: Measures inline edit response latency, token consumption, and Python AST syntax validity.
- **Task B**: Measures multi-file discovery, MCP tool invocations, token consumption, and diff generation.
- **Invariants Tested**: Safe workspace boundaries, strict 12k token budget caps, and zero unapproved disk writes.
