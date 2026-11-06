# Review & Safety Guarantees

## Hunk Review Lifecycle
1. **Staging**: Model submits diffs via `propose_patch` or `propose_edit`. Hunks are held in memory in `src/review/store.ts`.
2. **Visual Inspection**: Diff editor opens showing old vs new. CodeLens displays `Accept` and `Reject` above each hunk.
3. **Approval Validation**:
   - Check document version number against disk.
   - Reject with `StaleHunkError` if target has changed since proposal.
4. **Application**: `apply_patch_hunk` writes using `vscode.workspace.applyEdit`.
5. **Undo Storage**: An inverse diff is generated and stored for instantaneous rollbacks.

## Workspace Security Invariants
- **Path Confinement**: Reject any path resolving outside `${workspaceFolder}`.
- **Sensitive File Blacklist**: Deny `.env*`, `.git/*`, `*.key`, `*.pem`, `.forge-secrets*`.
- **Command Allowlist**: Terminal tool executes strictly argv arrays matching `ALLOWED_COMMANDS`. Shell interpolation is blocked.
