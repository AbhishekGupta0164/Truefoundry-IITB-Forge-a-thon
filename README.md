<h1 align="center">Forge Agent</h1>

<p align="center"><strong>A review-gated coding agent for VS Code, running its agent loop on TrueFoundry TrueForge.</strong><br/>
The model decides what to read and what to change. The editor decides what reaches the disk.</p>

<p align="center">
  <a href="#demo">Demo</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#how-context-is-selected">Context</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#the-three-fixed-tasks">Tasks</a> ·
  <a href="#judge-scorecard">Scorecard</a> ·
  <a href="#limitations">Limitations</a>
</p>

<p align="center">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-0ea5a4?style=flat-square" />
  <img alt="Node 22.14+" src="https://img.shields.io/badge/node-%E2%89%A522.14-339933?style=flat-square&logo=nodedotjs&logoColor=white" />
  <img alt="VS Code 1.90+" src="https://img.shields.io/badge/VS%20Code-%5E1.90-007acc?style=flat-square&logo=visualstudiocode&logoColor=white" />
  <img alt="TrueForge 0.184.3" src="https://img.shields.io/badge/TrueForge-0.184.3-6366f1?style=flat-square" />
  <img alt="MCP streamable HTTP" src="https://img.shields.io/badge/MCP-streamable%20HTTP-6b7280?style=flat-square" />
  <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white" />
</p>

> [!IMPORTANT]
> Forge Agent holds no model-provider key and never calls a model provider. All reasoning, sessions, tool orchestration and approvals belong to **TrueForge**, which must be running locally. Provider keys are entered inside TrueForge only.

> [!WARNING]
> Approved terminal commands run as your local user and are **not** sandboxed. They are limited to an exact allowlist (see [Safety invariants](#safety-invariants)), but review every command and use a disposable clone for untrusted work.

This repository is the IIT Bombay Techfest / TrueFoundry **Forge-a-thon** Round 1 submission by team **Three Winners** (Team ID `TM-7164696B5DD`). Target workspace for the three organizer tasks: [pallets/flask](https://github.com/pallets/flask) tag **3.1.3** (`22d92470`), sibling checkout at `../flask`.

---

## Contents

- [Demo](#demo)
- [Why this exists](#why-this-exists)
- [What Forge Agent does](#what-forge-agent-does)
- [Architecture](#architecture)
- [How context is selected](#how-context-is-selected)
- [How it uses TrueForge](#how-it-uses-trueforge)
- [Quick start](#quick-start)
- [The three fixed tasks](#the-three-fixed-tasks)
- [Verified state](#verified-state)
- [Settings and commands](#settings-and-commands)
- [Repository layout](#repository-layout)
- [Open-source resources](#open-source-resources)
- [Limitations](#limitations)
- [Judge scorecard](#judge-scorecard)
- [Team, tools and licence](#team-tools-and-licence)

---

## Demo

A screen recording of all three Forge-a-thon tasks on `pallets/flask` 3.1.3, each followed by its on-screen check: **[watch the demo video](⟦VIDEO_URL⟧)** (⟦m:ss⟧).

| Time | What you see |
| --- | --- |
| ⟦0:00⟧ | **Task A, inline edit.** `Cmd+Alt+K` on `get_debug_flag`, per-hunk Accept / Reject, then `FLASK_DEBUG=off` prints `False`; one undo restores the file |
| ⟦0:00⟧ | **Task B, agent mode.** One request, no file named. Context map, TrueForge session (turns, tool calls, approval pause), 3 files reviewed hunk by hunk, `pytest tests/test_cli.py -q`, `flask --help`, masked JSON from `flask config` |
| ⟦0:00⟧ | **Task C, resilience.** Unreachable model: retries with backoff, clear one-sentence message, responsive editor, `git status` shows no files changed |

---

## Why this exists

Coding agents fail in organizations for reasons that have little to do with model IQ:

1. **Unbounded writes.** A tool loop that applies a whole file is hard to review and harder to undo.
2. **Unbounded context.** Concatenating the repo until the window fills is expensive and often wrong.
3. **Silent failure.** A dead proxy or bad key hangs the editor, dumps a stack trace, or half-writes a tree.
4. **Key sprawl.** Putting provider secrets inside an extension is a non-starter.

The Forge-a-thon's three fixed tasks encode exactly this on a real, ~17k-line Python tree (Flask 3.1.3): a one-function inline edit, a multi-file CLI feature the agent must *discover*, and a dead-endpoint run that must leave git clean.

Forge Agent is the **editor half** of a coding agent. TrueForge is the **model half**.

---

## What Forge Agent does

| Surface | What happens |
| --- | --- |
| **Inline edit** (`Cmd+Alt+K` / `Ctrl+Alt+K`) | Selection, file path, line range and instruction go to a TrueForge session. The model calls `propose_edit` over MCP. Hunks appear as CodeLens **Accept / Reject**. Disk is untouched until Accept. |
| **Agent chat** (Forge Agent icon in the activity bar; drag it to the Secondary Side Bar for a Cursor-style layout) | Type a task and press Run. The prompt goes to TrueForge as typed; **no filenames are added** unless you write `@path/file.py` or `@symbol:name`. The model finds code with `search_text`, `search_symbols`, `find_related` and `read_file`, then proposes edits. Tokens, tool calls, the context map and approvals stream into the view. |
| **Review** | Native `vscode.diff` (`forge-original:` / `forge-proposed:`), per-hunk CodeLens, stale-hunk denial, `Forge: Undo Whole Task` through recorded inverse edits (not whole-file snapshots). |
| **Cancel** | `Forge: Cancel Run` calls TrueForge `sessions.cancel`, aborts the local stream, discards unapproved hunks, refuses later applies, and reports if an already-approved hunk was applied. |
| **Resilience** | Retry with exponential backoff, single-sentence errors, optional automatic fallback to a second configured model, loop guard. |
| **MCP** | Loopback-only `127.0.0.1:8765/mcp`, bearer token in VS Code SecretStorage, workspace path confinement, allowlisted `run_terminal_command`. |

---

## Architecture

### System view

```mermaid
flowchart LR
  subgraph editor["VS Code extension host (src/)"]
    user["Selection + instruction<br/>or agent chat prompt"] --> ctrl["ForgeController<br/>src/extension.ts"]
    ctrl --> client["TrueForge client<br/>sessions, stream, retry,<br/>cancel, loop guard"]
    ledger["Context ledger<br/>budget + reasons"]
    review["Review panel<br/>per-hunk diff, CodeLens, undo"]
  end

  client -->|"SDK: createSession + createTurnStream<br/>preload: false"| tf["TrueForge 0.184.3<br/>agent loop, tool orchestration,<br/>approvals"]
  tf <-->|"model calls"| model["Configured model<br/>Gemini, Ollama or hosted<br/>(keys live in TrueForge)"]
  tf -->|"MCP over loopback<br/>bearer token"| mcp["Workspace MCP server<br/>127.0.0.1:8765/mcp"]

  mcp --> guard["Workspace guard<br/>path confinement, secret denial,<br/>Host / Origin checks"]
  guard --> read["Read tools<br/>search_text, search_symbols,<br/>find_related, read_file"]
  guard --> propose["propose_edit / propose_patch<br/>memory only"]
  guard --> term["run_terminal_command<br/>argv allowlist, approval-gated"]

  read -. "every call logged" .-> ledger
  propose --> store[("PatchStore<br/>staged hunks")]
  store --> review
  review -->|"Accept hunk"| apply["apply_patch_hunk<br/>the only disk writer"]
  apply --> disk[("Source on disk")]
  apply --> inverse[("Inverse-edit journal")]
  review -->|"Undo whole task"| inverse
  inverse --> disk

  tf -. "stream events:<br/>tokens, tool calls,<br/>approval_required" .-> client
  review -. "user.tool_approval<br/>allow / deny" .-> client

  classDef accent fill:#0e7490,stroke:#22d3ee,color:#e0f2fe
  classDef store fill:#1f2937,stroke:#4b5563,color:#e5e7eb
  class ctrl,client,mcp,apply accent
  class store,disk,inverse store
```

### Request lifecycle (agent mode)

```mermaid
sequenceDiagram
  autonumber
  actor Dev as Developer
  participant Ext as Extension
  participant TF as TrueForge
  participant MCP as MCP server
  participant WS as Workspace

  Dev->>Ext: Instruction (selection or chat, no filenames)
  Ext->>TF: Create session (MCP attached) and stream turn
  loop Until done, budget reached or loop guard
    TF->>MCP: search_text / search_symbols / find_related / read_file (with reason)
    MCP-->>TF: Bounded result (budget checked, ledger updated)
    MCP-->>Ext: Context map entry (path, range, reason)
  end
  TF->>MCP: propose_edit
  MCP-->>Ext: Hunks staged in memory, native diff opens
  TF-->>Ext: tool.approval_required for apply_patch_hunk
  Ext->>Dev: Accept / Reject on each hunk
  Dev->>Ext: Decisions
  Ext->>TF: user.tool_approval (allow or deny, with reason)
  TF->>MCP: apply_patch_hunk (allowed hunks only)
  MCP->>WS: WorkspaceEdit after version recheck, inverse edit recorded
  TF-->>Ext: Stream done
```

### Failure path (Task C)

```mermaid
flowchart TD
  call["Model call through TrueForge"] --> ok{"Reachable and<br/>credential valid?"}
  ok -->|"yes"| run["Run continues"]
  ok -->|"no: unreachable or 429"| retry["Retry with exponential backoff<br/>3 attempts, 1 s doubling, cap 10 s"]
  ok -->|"no: bad key (401 / 403)"| fail["Stop at once<br/>one-sentence error"]
  retry --> again{"Recovered?"}
  again -->|"yes"| run
  again -->|"no"| fb{"Fallback model set<br/>and no tool called yet?"}
  fb -->|"yes"| replay["New session on forge.fallbackModel<br/>replays the request, no user action"]
  fb -->|"no"| fail
  fail --> clean["Nothing was staged:<br/>git status shows no changes"]
  replay --> run
```

### Write path and review

1. The model proposes an `old_str` / `new_str` edit (or a unified diff).
2. The server computes the hunks, validates them (Python syntax, new-import resolution, scope), and stages them in `PatchStore`. `git status` stays clean.
3. The native diff opens with Accept and Reject on every hunk.
4. Accept: TrueForge's pause on `apply_patch_hunk` resumes with `user.tool_approval`. The hunk is rechecked against the current document version (a hunk whose own lines changed is denied as stale), written through `WorkspaceEdit`, and an inverse edit is recorded.
5. Optional post-accept Python AST check (`scripts/check_py.py`).
6. Undo replays the inverse edits in reverse and reports a conflict if you edited the same span afterwards.

<details>
<summary><strong>MCP tool surface</strong></summary>

| Tool | Purpose | Writes? |
| --- | --- | --- |
| `ping` | Health check | No |
| `search_text` | Bounded text search, at most 30 hits, each with path, line and snippet | No |
| `search_symbols` | Python `ast` symbol lookup with signatures and docstrings (also serves `@symbol`) | No |
| `read_file` | Workspace-relative ranged read, at most 200 lines, with a reason | No |
| `find_related` | Pairs an implementation with its tests and docs by name and references | No |
| `propose_patch` | Stage a multi-hunk unified diff in memory | No, memory only |
| `propose_edit` | Stage a search-and-replace edit; hunks computed server-side with 3-tier matching (exact, whitespace-normalised, anchored) | No, memory only |
| `apply_patch_hunk` | Apply one approved hunk through `WorkspaceEdit` | **Yes, the only writer** |
| `run_terminal_command` | argv array against an exact allowlist, timeout, truncated output | No source edits; approval-gated |

</details>

### Safety invariants

Also in `AGENTS.md`.

- The **only** disk writer is `apply_patch_hunk`, and only after a TrueForge allow for that call.
- The extension **never** calls a model provider. Traffic is TrueForge SDK / HTTP only.
- MCP binds `127.0.0.1` on a fixed port, never `0.0.0.0`, and requires a bearer token stored in VS Code SecretStorage.
- Paths cannot escape the workspace. `..`, symlink escapes, `.git`, `.env`, `*.key` and `*.pem` are denied.
- `run_terminal_command` takes an argv array on an exact allowlist, with `shell: false`. Shell strings, redirects and `git apply` are rejected.
- A loop guard stops a run after 20 tool calls, or 3 identical consecutive calls.

---

## How context is selected

Flask 3.1.3 is about 17,000 lines, larger than most context windows. The agent never receives the repository. It starts with only the request and retrieves what it needs, in this order (documented in `docs/context-strategy.md`):

1. **Mentions.** `@file` and `@symbol` are resolved by the extension and sent first, inside the same budget.
2. **Repo map.** A compact outline of modules, classes and functions, under 2,000 tokens.
3. **`search_text` / `search_symbols`.** Finds the entry point (for Task B, the existing `routes_command`).
4. **`find_related`.** Maps a module to its tests and docs: `src/flask/cli.py` gives `tests/test_cli.py` and `docs/cli.rst`. The agent still decides what to open.
5. **`read_file`.** Line ranges only, never whole files, each with a stated reason.

| Retrieved-context budget (`src/shared/constants.ts`, enforced in `src/context/budget.ts`) | Limit |
| --- | ---: |
| Retrieved tokens per run | 12,000 |
| Files consulted per task | 8 |
| Search hits per call | 30 |
| Lines per `read_file` | 200 |
| Tool output wrap | about 2 KB |
| Run safety cap | 100k tokens, 30 iterations, 20 tool calls; stop on 3 identical consecutive calls |

The limits live in the MCP server, not in the prompt. A repeated identical read or search costs nothing, which stops weak models from looping. When a limit is reached the tool returns an explicit "context budget reached" result instead of silently adding more code.

**Context map.** Every `read_file`, `search_text`, `search_symbols` and `find_related` call is written to a ledger. The agent chat shows it live: path, line range, the reason the model gave, candidates it skipped, and budget used. `@file` and `@symbol` mentions appear as "mentioned by the user".

---

## How it uses TrueForge

| TrueForge capability | How Forge Agent uses it | Code |
| --- | --- | --- |
| Sessions and streamed turns (TypeScript SDK) | Every agent and inline run: `sessions.create` with an inline agent spec, `sessions.createTurnStream`; events mapped to `token`, `tool_call`, `tool_result`, `approval`, `error`, `done` | `src/trueforge/` |
| Remote MCP server | The editor's capabilities as tools (table above), attached as `forge-workspace` | `src/mcp/` |
| Tool approval | `requireApprovalForTools: ['apply_patch_hunk', 'run_terminal_command']`. TrueForge pauses the turn with `tool.approval_required`; the hunk is already on screen; Accept or Allow resumes it with `user.tool_approval`; Reject or Deny sends the reason back | `src/trueforge/approvals.ts`, `src/review/` |
| Deferred tool loading | The MCP server is attached with `preload: false` (same as `agent-definition.json`), so tool definitions load when the agent first needs them | `src/trueforge/client.ts` |
| Cancel | `sdk.sessions.cancel` plus a local `AbortSignal` | `src/review/cancel.ts` |
| Network policy | `NETWORK_POLICY_ENABLED=true`, `OUTBOUND_URL_ALLOWED_HOSTS=["localhost","127.0.0.1"]` | `scripts/start-trueforge.sh` |
| Model catalog | The model is configured inside TrueForge; the extension only passes `provider/model` names | `forge.model`, `forge.fallbackModel` |

Sandbox and subagents are **off on purpose**: every write already goes through one approval-gated tool, and subagents inherit the same MCP tools (including the writer), so a "read-only" prompt would not be a guard.

No provider API keys live in this repository. `model.example.json` is a placeholder showing the OpenAI-compatible shape with an empty key.

---

## Quick start

### Prerequisites

- Node.js **22.14+**
- Python **3.9+** (Flask target, `scripts/symbols.py`, `scripts/check_py.py`)
- VS Code **1.90+**, Git
- A model reachable from TrueForge: a hosted provider key (for example Gemini) or a local model through Ollama

### 1. Build the extension

```bash
git clone https://github.com/AbhishekGupta0164/Truefoundry-IITB-Forge-a-thon.git
cd Truefoundry-IITB-Forge-a-thon
npm ci
npm run build
npm run typecheck && npm run lint && npm run test:unit
```

### 2. Get the Flask target (pinned)

```bash
./scripts/setup-flask.sh
# or by hand, as a sibling folder:
cd ..
git clone https://github.com/pallets/flask.git
cd flask && git checkout 22d92470
python3 -m venv .venv && source .venv/bin/activate
pip install -e . "pytest==8.4.2" python-dotenv asgiref
```

Pin pytest to **8.4.2** (the version in Flask's `uv.lock`). pytest 9 removed `_pytest.monkeypatch.notset`, which `tests/test_cli.py` imports, so an unpinned install fails Task B's check at import time. On Windows run `git config core.autocrlf false` before cloning so multi-line edits match. Confirm the baseline before any agent run:

```bash
git status --porcelain                  # empty
pytest tests/test_cli.py -q             # 58 passed on stock 3.1.3
FLASK_DEBUG=off python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"   # True on stock 3.1.3
```

### 3. Start TrueForge and add a model

```bash
./scripts/start-trueforge.sh
# equivalent:
npx --yes @truefoundry/trueforge@0.184.3 --port 8790
```

Open `http://localhost:8790`, go to Settings, Models, and add a provider and key (for example Gemini). Keys are entered here and nowhere else. Use one TrueForge version on every machine: a data folder created by a newer version and opened by an older one fails with `corrupted migrations`. If that happens, move the TrueForge data folder aside and start again.

Check the model answers tool calls before using the extension: in the TrueForge chat, enable the `forge-workspace` tools and ask it to call `ping`.

### 4. Launch the extension

One command starts the MCP server, checks TrueForge and runs the self-test:

```bash
npm run start:all
```

Then press **F5** and choose **Run Extension (Flask Workspace)**. That opens `../flask` with `--extensionDevelopmentPath` set to this repo. Open the agent chat from the **Forge Agent** icon in the activity bar.

Set the models in VS Code settings (`provider/model` names exactly as TrueForge lists them):

```json
{
  "forge.model": "google-gemini/gemini-3-5-flash",
  "forge.fallbackModel": "google-gemini/gemini-3-1-flash-lite"
}
```

Before each take, reset Flask: `./scripts/reset-flask.sh` (or `git checkout -- . && git clean -fd` in the Flask clone), and make sure only one extension host is running (a second one will clash on port 8765).

### MCP Inspector (optional)

With the extension running, run `Forge: Copy MCP Connector Settings`, then:

```bash
npx @modelcontextprotocol/inspector http://127.0.0.1:8765/mcp
```

---

## The three fixed tasks

Use the instruction text exactly as given by the organizers. Reset Flask before each task.

### Task A: inline edit

Open `src/flask/helpers.py`, select `get_debug_flag`, press `Cmd+Alt+K` (`Ctrl+Alt+K`) and enter:

> Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.

Review the hunks and accept. Then:

```bash
FLASK_DEBUG=off python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"
# expect False (stock 3.1.3 prints True); also FLASK_DEBUG=N and FLASK_DEBUG=Off
```

Undo once with `Forge: Undo Whole Task`; `git diff` is empty again.

### Task B: agent mode, no filenames

In the agent chat, with no files mentioned, enter:

> Add a new built-in CLI command flask config that prints the loaded application's configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as "***". It must appear in flask --help, be covered by a test, and be documented alongside the other built-in commands.

Review the hunks and accept, then:

```bash
git diff --stat                                   # at least 3 files: src/flask/cli.py, tests/test_cli.py, docs/cli.rst
pytest tests/test_cli.py -q                       # passes
flask --help | grep config                        # config is listed
flask --app examples.tutorial.flaskr:create_app config   # SECRET_KEY shows "***", ordinary keys shown
```

The TrueForge session for the run (turns, MCP tool calls, approval pause) is visible at `http://localhost:8790`.

### Task C: resilience

In TrueForge, point the primary model at an unreachable endpoint (for example a custom provider at `http://127.0.0.1:9/v1`) or use an invalid key, then repeat Task A. Expected: the editor stays responsive, the panel shows the retries and one clear sentence (no stack trace), the fallback model takes over if one is configured and nothing was staged yet, and:

```bash
git status --porcelain      # empty: no files changed before you accept anything
```

---

## Verified state

Two kinds of evidence exist. They are kept separate.

### Automated checks

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | ⟦0 errors⟧ |
| Lint | `npm run lint` | ⟦0 problems⟧ |
| Build | `npm run build` | `dist/extension.js` and `dist/webview.js` built |
| Tests | `npm run test:unit` | ⟦N passed, N skipped⟧ across ⟦N⟧ files (review engine, MCP, budget, retry and cancel, routing, dead-port, stale hunk, terminal allowlist) |
| Secret scan | `gitleaks detect` | ⟦no leaks found⟧ |
| MCP tool chain on Flask 3.1.3 | a real MCP client calls the real server over Streamable HTTP with bearer auth; no model, a script issues the calls an agent would make | ⟦33 / 33 checks⟧: Task A returns `False` for `off`, `OFF`, `n`, `N`, `no`, `0`; Task B changes 3 files; nothing is written before apply; stale hunks, `../`, secret files, `.git`, `sh -c`, `>` and `git apply` are rejected; no token gives HTTP 401 |

### Live runs through TrueForge with a model (recorded in the demo video)

Recorded ⟦date⟧ on ⟦macOS⟧, Node ⟦22.x⟧, Python ⟦3.x⟧, model `⟦provider/model⟧` through TrueForge `0.184.3`.

| Task | Verification | Result | Time | Tokens |
| --- | --- | --- | --- | --- |
| A | `FLASK_DEBUG=off python -c "..."` | ⟦False⟧ | ⟦s⟧ | ⟦n⟧ |
| B | `git diff --stat`, `pytest tests/test_cli.py -q`, `flask --help`, `flask config` | ⟦3 files; N passed; config listed; secrets masked⟧ | ⟦s⟧ | ⟦n of 12,000⟧ |
| C | `git status --porcelain` after retries | ⟦empty; clear message; fallback used or not⟧ | ⟦s⟧ | 0 |

Each run's tool-call timeline and context ledger can be exported with `Forge: Export Run Report` (⟦if implemented⟧).

---

## Settings and commands

| Setting | Default | Meaning |
| --- | --- | --- |
| `forge.trueforgeUrl` | `http://localhost:8790` | Local TrueForge server |
| `forge.mcpPort` | `8765` | Loopback MCP port (the connector is registered once, so it stays fixed) |
| `forge.model` | `ollama/llama-3-2-3b` | `provider/model` as listed in TrueForge |
| `forge.fallbackModel` | empty | Second `provider/model` for automatic fallback |
| `forge.temperature` | `0` | Sampling temperature |

Commands: `Forge: Inline Edit` (`Cmd+Alt+K` / `Ctrl+Alt+K` with a selection), `Forge: Open Agent Chat`, `Forge: Cancel Run`, `Forge: Undo Whole Task`, `Forge: Copy MCP Connector Settings`, `Forge: Start All`, `Forge: Self-Test`.

### Eval harness

```bash
npm run eval
```

Writes `eval/results/results.json` and `eval/results/evaluation-table.md`. It checks less than the organizers' on-screen checks (see [Limitations](#limitations)); the Tasks A to C commands above are the reference.

---

## Repository layout

```
Truefoundry-IITB-Forge-a-thon/     # this repo (open this folder in VS Code)
├── src/
│   ├── extension.ts               # activate: MCP + commands + CodeLens + diff schemes
│   ├── trueforge/                 # client, retry, reconnect, approvals, loop guard
│   ├── mcp/                       # HTTP MCP server, auth, workspace guard, 9 tools
│   ├── review/                    # store, manager, CodeLens, diff, undo, cancel, validate
│   ├── context/                   # budget, ledger, mentions, repo map, symbol index
│   ├── ui/                        # inline edit, agent chat panel, status bar, webview
│   ├── verify/                    # post-accept checks
│   └── shared/                    # types, events, errors, constants, validation
├── test/                          # unit, mcp, e2e (vitest; CI runs these)
├── eval/                          # multi-model harness and results
├── docs/                          # architecture, context strategy, review safety, model setup
├── spikes/                        # Stage 1 to 5 verification scripts
├── scripts/                       # setup-flask, start-trueforge, reset-flask, symbols.py, check_py.py
├── demo/app.py                    # tiny Flask app with secret and normal config keys
├── agent-definition.json          # the TrueForge agent definition used
├── model.example.json             # example model config, empty key
├── AGENTS.md                      # non-negotiable invariants
└── LICENSE                        # MIT

../flask/                          # sibling checkout pinned at 22d92470 (not part of this repo)
```

---

## Open-source resources

| Resource | Use |
| --- | --- |
| [pallets/flask](https://github.com/pallets/flask) 3.1.3 / `22d92470` | Organizer target (about 17k lines of Python, tests and docs) |
| [@truefoundry/trueforge](https://www.npmjs.com/package/@truefoundry/trueforge) 0.184.3 | Local agent harness daemon |
| [@truefoundry/trueforge-sdk](https://www.npmjs.com/package/@truefoundry/trueforge-sdk) 0.184.1 | Sessions, turn streams, cancel |
| [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) | Streamable HTTP MCP server |
| `diff`, `zod` | Hunk parsing and tool schemas |
| Python `ast` (standard library) | Symbol index and syntax / name checks |
| vitest, esbuild, TypeScript, ESLint, gitleaks | Test, build, lint, secret scan |
| [Ollama](https://ollama.com) | Optional local models |

---

## Limitations

1. **Fallback covers failures before the first tool call.** A model that dies halfway through Task B is reported, not replayed on the fallback, because a replay would repeat half-finished work. Fallback needs `forge.fallbackModel` set to a second model.
2. **Cancel does not revert hunks you already accepted.** It stops the session, discards unapproved hunks and refuses later applies; `Undo Whole Task` reverts accepted ones.
3. **Python-centric.** The symbol index, syntax check and phantom-import check are Python-only; other languages fall back to text search. The terminal allowlist is shaped around the Flask tasks.
4. **Hard budgets can stop the agent early** on a very large change. We prefer an explicit "budget exceeded" the model can react to over a silently filled window.
5. **Stale-hunk check is per hunk.** A hunk is denied if its own lines changed; edits elsewhere in the file are kept and the hunk still applies.
6. **Models.** Tasks were run on Gemini models; small local models (for example a 3B model) are safe with the extension (clean tree, clear error) but often cannot complete Task B.
7. **The eval harness checks less than the organizers' on-screen checks.** Treat the Task A to C commands as the reference.
8. **Runs from source.** Load it with F5; there is no packaged VSIX because the TrueForge SDK is kept external in the bundle.
9. **One workspace per registered MCP connector**, loopback only, on a fixed port.

**With another month:** score Tasks A to C automatically with the organizers' own checks on three model tiers; let the fallback resume mid-run from the applied state; replace the Python index with tree-sitter and add BM25 plus an import graph to retrieval; add a hunk dependency graph (warn when rejecting an import another hunk needs); persist the undo journal across window reloads; make Cancel offer one-click rollback of the cancelled task's accepted hunks; ship a VSIX; and send TrueForge the notes we gathered while building (the approval-resume flow and the loopback default for local MCP servers cost us the most time).

---

## Judge scorecard

Organizer rubric, 100 points. Every claim is limited to what the demo video and the commands above show.

| ID | Criterion | Pts | What it shows | Video | Evidence in the repo |
| --- | --- | ---: | --- | --- | --- |
| A1 | Inline edit | 10 | Selection and instruction open a native diff with per-hunk Accept and Reject; nothing is written before Accept; `FLASK_DEBUG=off` prints `False` | ⟦m:ss⟧ | `src/ui/`, `src/review/`, review tests |
| A2 | Agent mode | 10 | With no file named, the agent finds and edits `cli.py`, `test_cli.py` and `cli.rst` | ⟦m:ss⟧ | `git diff --stat`, `src/mcp/tools/` |
| A3 | Streaming and cancel | 10 | Tokens and tool calls stream into the chat; Cancel stops the turn, discards unapproved hunks, and `git status` shows nothing half-applied | ⟦m:ss⟧ | `src/trueforge/`, `src/review/cancel.ts`, cancel tests |
| B1 | Context assembly | 15 | Budgeted retrieval (12,000 tokens, 8 files, 30 hits, 200 lines); the context map shows each file, range and reason during Task B | ⟦m:ss⟧ | `src/context/`, `docs/context-strategy.md` |
| B2 | Diff safety | 10 | Per-hunk review before any write, then undo restores the files | ⟦m:ss⟧ | `src/review/`, stale-hunk and undo tests |
| B3 | Resilience | 10 | Dead endpoint: retries with backoff, one-sentence error, no stack trace, `git status` empty ⟦; fallback model took over, if shown⟧ | ⟦m:ss⟧ | `src/trueforge/retry.ts`, dead-port tests |
| B4 | TrueForge integration | 10 | SDK sessions, MCP tools, approval pause on `apply_patch_hunk` drives the review, deferred tool loading (`preload: false`), TrueForge session view | ⟦m:ss⟧ | `src/trueforge/`, `agent-definition.json` |
| C1 | Video | 10 | Tasks A, B and C in order, each verified on screen | n/a | [Demo video](⟦VIDEO_URL⟧) |
| C2 | Write-up | 15 | Architecture, context strategy, model setup, trade-offs, scorecard and honest limits | n/a | Write-up PDF, `docs/` |

### Design choices

- Disk writes go through review: proposals are staged in memory and written hunk by hunk only after approval.
- Undo uses recorded inverse edits instead of restoring whole-file snapshots, so unrelated edits you make afterwards survive.
- Edits are search-and-replace, not line numbers, matched in three tiers (exact, whitespace-normalised, anchored), so weaker models still land their changes; hunks are located by their own content, so a first hunk that adds an import does not break later ones.
- A phantom-import check flags only new imports that do not resolve, using the project's own virtualenv.
- Budgets live in the MCP server, not the prompt, so a looping or weak model cannot exhaust the context window.
- Errors reach the user as one sentence that includes TrueForge's reason, never a stack trace.

---

## Team, tools and licence

**Team Three Winners** (Team ID `TM-7164696B5DD`), Global Baderia Institute of Management, Jabalpur:

| Member | GitHub |
| --- | --- |
| Abhishek Gupta (lead) | [AbhishekGupta0164](https://github.com/AbhishekGupta0164) |
| Khushi Rana | [khushi-rana1](https://github.com/khushi-rana1) |
| Taru Tiwari | [TaruTiwari82](https://github.com/TaruTiwari82) |

**Starting point:** from scratch. The repository was initialised on 6 November 2026 (first commit `ef7d1df`). No upstream project was forked and no agent loop from Cline, Continue, Roo Code or opencode is used; the loop runs on TrueForge.

**AI coding assistants used to build it** (declared, no points): Google Antigravity with Gemini for most of the build, and Claude Code for debugging and fixes against real Flask. A team member reviewed each change before it was merged.

**Licence:** MIT, see [LICENSE](LICENSE).

---

<p align="center">
  <sub>Forge-a-thon, Techfest IIT Bombay · on TrueFoundry TrueForge</sub>
</p>
