# Evaluation notes

There is no current model benchmark result for this repository.

The previous runner was removed because it marked Task B's test, CLI help, secret masking, and clean-workspace checks as successful without executing them. It also scored streamed text instead of verifying the actual Task A workspace edit. Its checked-in result tables were from an invalid model configuration and are not evidence of task success or model efficiency.

`rubric.ts` contains pure scoring helpers exercised with unit-test fixtures. Those tests validate the helpers only; they are not model runs and must not be reported as model performance.

To produce a valid benchmark, a future runner must use an isolated Flask 3.1.3 checkout, call the real TrueForge daemon and configured models, capture actual tool events, require approval before writes, run the Flask tests and CLI checks, and store measured latency/token/tool counts with the exact model IDs and environment. No such run was possible in the current environment because the TrueForge daemon and MCP service are unavailable.
