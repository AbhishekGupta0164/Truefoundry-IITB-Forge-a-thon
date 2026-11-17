# Forge Agent Demo & Reproduction Guide

This guide walks through reproducing and evaluating the three fixed tasks from the TrueFoundry Forge-a-thon.

## Demo Video

- **Video Link**: [Forge Agent Walkthrough](https://youtu.be/placeholder-forge-agent-demo) *(Demo video demonstrating Task A, Task B, and Task C)*

---

## 1. Quick Start

Start all required runtime services (MCP server, TrueForge daemon check, and self-test) with a single command:

```bash
npm run start:all
```

To run the extension in VS Code:
1. Open this repository in VS Code.
2. Press `F5` (or select **Run Extension (Flask Workspace)** from Run & Debug).
3. VS Code launches the Extension Development Host attached to the Flask sibling directory (`../flask`).

---

## 2. Task Reproductions

### Task A — Inline Edit (`FLASK_DEBUG=off` -> `False`)
1. In the Extension Development Host, open `src/flask/cli.py`.
2. Highlight the `get_debug_flag()` function.
3. Press `Cmd+Alt+K` (macOS) or `Ctrl+Alt+K` (Linux/Windows) to invoke **Forge: Inline Edit**.
4. Enter the prompt:
   ```text
   Update get_debug_flag so that 'off' and 'n' return False.
   ```
5. Observe the live token stream and generated hunk.
6. The proposed diff appears in the editor with CodeLens actions: **Accept** / **Reject**.
7. Disk remains untouched until **Accept** is clicked.
8. Verify with:
   ```bash
   FLASK_DEBUG=off python -c "from flask.cli import get_debug_flag; print(get_debug_flag())"
   # Expected output: False
   ```

### Task B — Agent Mode (`flask config` command)
1. Open the **Forge Agent** panel in the sidebar.
2. Enter the task prompt:
   ```text
   Add a 'flask config' command that prints all configuration keys and values, masking secrets with '***'.
   ```
3. Observe the agent tool execution timeline in the webview:
   - `search_text` / `search_symbols` across Flask files.
   - `read_file` within context budget limits.
   - `propose_patch` generating reviewable hunks across `cli.py`, `test_cli.py`, and `cli.rst`.
4. Review the staged multi-file diff in native VS Code diff editors.
5. Click **Accept All** to apply the patch.
6. Verify tests pass:
   ```bash
   pytest tests/test_cli.py
   ```

### Task C — Fault Resilience & Clean Working Tree
1. Point TrueForge to an unreachable port (`http://127.0.0.1:9/v1`) or trigger the fault proxy:
   ```bash
   # Fault proxy simulation with refused or rate-limit mode
   npx ts-node spikes/verify-t8.ts
   ```
2. Trigger **Forge: Inline Edit** or **Agent Mode**.
3. Observe:
   - Up to 3 exponential retries with jitter.
   - User-friendly single-sentence error in notification banner (no stack traces).
   - Zero unapproved disk writes:
     ```bash
     git status --porcelain
     # Working tree is 100% clean
     ```
