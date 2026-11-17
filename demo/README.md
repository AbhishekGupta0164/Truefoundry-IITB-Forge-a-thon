# TrueForge VS Code Extension — Three-Task Video Walkthrough & Demo

This directory contains artifacts and video walkthrough links demonstrating the 3 core tasks of the TrueFoundry Forge-a-thon.

## 📹 Video Walkthrough
- **Stable Loom / YouTube Demo URL**: [TrueForge Autonomous Coding Agent Walkthrough](https://youtu.be/placeholder-trueforge-demo) *(Update with team's recorded demo link)*
- **Demo Length**: ~3 minutes
- **Evaluation Criteria Addressed**: C1 (Full end-to-end task demonstrations)

---

## 🎬 Demonstrated Tasks

### Task A: Inline Edit & Single-Hunk Review
- **File**: `src/flask/helpers.py` (`get_debug_flag`)
- **Action**: User opens inline edit with instruction:
  > *"Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false."*
- **Behavior**:
  - Genuine LLM generates modification without hardcoded test fixtures.
  - Proposes single hunk via MCP `apply_patch_hunk`.
  - VS Code inline diff view shows green additions / red deletions with CodeLens Accept/Reject buttons.
  - No writes occur before user approval.

### Task B: Agent Panel Multi-File Discovery & Retrieval
- **Action**: User inputs prompt into Agent Panel:
  > *"Add a new built-in CLI command flask config that prints the loaded application's configuration as JSON..."*
- **Behavior**:
  - Live context map displays the navigation flow: `cli.py → test_cli.py → cli.rst` with reasoning badges.
  - Context budget meter tracks retrieved tokens within the 12,000 safety cap.
  - MCP tools invoked: `search_text`, `read_file`, `find_related`.

### Task C: Workspace Consistency & Single-Gesture Cancellation
- **Action**: User clicks Cancel during active execution.
- **Behavior**:
  - Immediate turn cancellation via TrueForge client.
  - Extension presents single-gesture dialog:
    > *"Run cancelled. 1 applied hunk in workspace. Would you like to undo applied hunks to restore workspace consistency?"*
  - Clicking "Undo Applied Hunks" restores pristine git state with zero orphan edits.

---

## 🚀 Running the Demo Locally

1. Start TrueForge:
   ```bash
   ./scripts/dev/start.sh
   ```
2. Launch VS Code Extension Development Host (`F5`).
3. Open `../flask` workspace.
4. Open Agent Panel via Command Palette (`Forge: Open Agent Panel`).
