# Competition Evaluation Scorecard

| Criterion | Target Claim | Verification Method | Demo Video Timestamp |
|---|---|---|---|
| **Zero Model API Keys in Extension** | 100% compliant | Code audit & Gitleaks scan | `00:30` |
| **Workspace Confinement** | No path escapes allowed | `test/unit/security.test.ts` | `01:15` |
| **Hunk-by-Hunk Review** | Accept / Reject per hunk | CodeLens UI in diff editor | `02:20` |
| **Full Task Rollback** | Single-click task undo | `forge.undoTask` command | `03:45` |
| **Context Retrieval Capping** | ≤30 hits, ≤200 lines | `src/context/budget.ts` | `04:30` |
| **Autonomous Flask Refactoring** | Multi-file CLI option | Task B on Pallets Flask | `05:50` |
