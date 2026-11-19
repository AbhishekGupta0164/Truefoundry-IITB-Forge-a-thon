# Forge Agent

A VS Code extension that turns a local TrueForge daemon plus a workspace MCP server into a **review-gated coding agent**. Patches are staged as hunks, shown in the editor, and written to disk only after Accept. This repository is the IIT Bombay Techfest / TrueFoundry Forge-a-thon submission.

Target workspace for the three organizer tasks: [pallets/flask](https://github.com/pallets/flask) tag **3.1.3** (`22d92470`), sibling checkout at `../flask`.

---

## Contents

- [The problem](#the-problem)
- [What Forge Agent does](#what-forge-agent-does)
- [Results](#results)
- [Architecture overview](#architecture-overview)
- [How it uses TrueForge](#how-it-uses-trueforge)
- [Repository layout](#repository-layout)
- [Running it](#running-it)
- [Open-source resources and data](#open-source-resources-and-data)
- [Limitations](#limitations)
- [Judge scorecard](#judge-scorecard)

---

## The problem

Coding agents fail in organizations for reasons that have little to do with model IQ:

1. **Unbounded writes.** A tool loop that `applys` a full file is hard to review and harder to undo.
2. **Unbounded context.** Concatenating the repo until the window fills is expensive and often wrong.
3. **Silent failure.** A dead proxy or bad key hangs the editor, dumps a stack, or half-writes a tree.
4. **Key sprawl.** Putting provider secrets in the extension is a non-starter.

Forge-a-thon’s three fixed tasks encode that problem on a real, ~17k-line Python tree (Flask 3.1.3): a one-function inline edit, a multi-file CLI feature the agent must *discover*, and a dead-port / invalid-key run that must leave git clean.

---

## What Forge Agent does

Forge Agent is the editor half of the loop. TrueForge is the model half.

| Surface | What happens |
| --- | --- |
| **Inline edit** (`Cmd+Alt+K` / `Ctrl+Alt+K`) | Selection + instruction go to a TrueForge session. The model is expected to call `propose_edit` over MCP. Hunks appear as CodeLens **Accept / Reject**. Disk is untouched until Accept. |
| **Agent chat** (Forge Agent icon in the activity bar; drag it to the right-hand Secondary Side Bar for a Cursor-style layout) | Type a task and press Run. The prompt goes to TrueForge as typed; **no filenames are added** unless you write `@src/path/file.py` or `@symbol:name`. The model finds the code with `search_text` / `search_symbols` / `find_related` / `read_file` and proposes edits with `propose_edit`. Tokens, tool calls, the context map and approvals stream into the view; Cancel stops the run; Undo whole task reverts it. |
| **Review** | Native `vscode.diff` (`forge-original:` / `forge-proposed:`), per-hunk CodeLens, stale-hunk denial, `Forge: Undo Whole Task` via inverse edits (not whole-file snapshots). |
| **Cancel** | `Forge: Cancel Run` calls TrueForge `sessions.cancel`, discards unapplied hunks, and reports if any approved hunk was already applied. |
| **MCP** | Loopback-only `127.0.0.1:8765/mcp`, bearer token in VS Code SecretStorage, workspace path confinement, allowlisted `run_terminal_command`. |

Safety invariants (also in `AGENTS.md`):

- The **only** disk writer is `apply_patch_hunk`.
- The extension **never** calls a model provider. Traffic is TrueForge SDK/HTTP only.
- MCP never binds `0.0.0.0`.
- Paths cannot escape the workspace; `.env`, `.git`, `*.key` / `*.pem` are denied.
- Terminal tool is argv + allowlist, `shell: false`.

---

## Verification status

### Verified on 2026-11-19 (Linux, Node 22, Python 3.13)

| Check | How | Result |
| --- | --- | --- |
| Extension build and tests | fresh clone of `main`: `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run build` | 0 type errors, 0 lint problems, **37 test files, 247 passed, 2 skipped**, `dist/extension.js` + `dist/webview.js` built |
| MCP tool chain on Flask 3.1.3 (`22d92470`) | the real MCP server on `127.0.0.1:8765` called by a real MCP client over Streamable HTTP with bearer auth. **No model:** a script issued the tool calls an agent would make | 33 / 33 checks. Task A: `FLASK_DEBUG=off` → `False` (and `OFF`, `n`, `N`, `no`, `0`, empty → `False`). Task B: 3 files changed, `pytest tests/test_cli.py -q` → 60 passed, `flask --help` lists `config`, `flask --app demo/app config` shows `SECRET_KEY` and `API_TOKEN` as `"***"`. Nothing written before apply; stale hunks denied; `../`, secret files, `.git`, `sh -c`, `>` and `git apply` rejected; no token → HTTP 401 |
| Flask baseline | `pip install -e . "pytest==8.4.2" python-dotenv asgiref` | `pytest tests/test_cli.py -q` → 58 passed; stock `get_debug_flag()` with `FLASK_DEBUG=off` → `True` |

### Not verified yet

- **Tasks A, B and C end to end through a live TrueForge daemon with a model.** The daemon could not run in the test environment. The SDK event mapping, approval resume and model fallback are tested against the `@truefoundry/trueforge-sdk` v0.184.1 types with a fake SDK only.
- **The agent chat inside a real VS Code window.** It was rendered in Chromium from `dist/webview.js`, driven by the real panel provider.

---

## Architecture overview

```
Developer (VS Code)
    │  Cmd+Alt+K / Agent panel / CodeLens
    ▼
src/ui          inline-edit, webview (token stream, tool timeline, budget, approvals)
    │
    ├──────────► src/trueforge     SDK sessions, SSE stream, retry, cancel, reconnect, loop guard
    │                 │
    │                 ▼
    │           TrueForge daemon :8790  ──► Ollama / hosted model
    │                 │
    │                 ▼ MCP (Bearer)
    └──────────► src/mcp :8765/mcp
                      │  search_text, search_symbols, read_file, find_related
                      │  propose_patch, propose_edit   (memory only)
                      │  apply_patch_hunk              (only disk writer)
                      │  run_terminal_command          (allowlist)
                      ▼
                 src/review   PatchStore, CodeLens, diff, undo, cancel, AST check
                 src/context  12k token / 8 file / 30 hit / 200 line budget
```

**Write path**

1. Model proposes a unified diff or `old_str`/`new_str` edit.
2. `PatchStore` holds hunks; `git status` stays clean.
3. Diff editor + CodeLens.
4. Accept → `apply_patch_hunk` via `WorkspaceEdit` + inverse-edit record.
5. Optional post-accept Python AST check (`scripts/check_py.py`).
6. Undo replays inverse edits in reverse; conflicts if the user edited the same span.

**Retrieved-context budget** (`src/shared/constants.ts`, enforced in `src/context/budget.ts`)

| Cap | Value |
| --- | ---: |
| Retrieved tokens | 12,000 |
| Files consulted | 8 |
| Search hits | 30 |
| Lines per `read_file` | 200 |
| Tool output wrap | ~2 KB (`DEFAULT_TOOL_OUTPUT_CAP`) |
| Run safety cap | 100k tokens / $2 / 30 iterations / 20 tool calls (loop guard: 3 identical consecutive calls) |

Retrieval order (documented in `docs/context-strategy.md`): `@file` / `@symbol` mentions → repo map → `search_text` → bounded `read_file` → `find_related` (test/doc pairing).

The context map in the agent chat is fed from the same ledger the MCP tools write to: every `read_file`, `search_text`, `search_symbols` and `find_related` call is listed with its path, line range and the reason the model gave, plus skipped candidates and budget usage. `@file` / `@symbol` mentions appear there as "mentioned by the user".

---

## How it uses TrueForge

| Piece | Binding |
| --- | --- |
| SDK | `@truefoundry/trueforge-sdk` `^0.184.1` |
| Daemon | `npx @truefoundry/trueforge@0.184.3 --port 8790` (`scripts/start-trueforge.sh`) |
| Default URL | `forge.trueforgeUrl` → `http://localhost:8790` (`src/trueforge/config.ts`) |
| Default model setting | `ollama/llama-3-2-3b` (VS Code `forge.model`, `provider/model`); fallback via `forge.fallbackModel`; the eval harness covers three tiers (strong hosted, free tier, local 3B), **all via the same localhost proxy** |
| Temperature | `0` |
| MCP attach | Session `mcpServers: [{ name: 'forge-workspace', requireApprovalForTools: ['apply_patch_hunk', 'run_terminal_command'] }]` |
| Streaming | SDK turn stream mapped to `token` / `tool_call` / `tool_result` / `approval` / `error` / `done` |
| Retry | 3 retries, 1s → ×2 backoff, cap 10s. Unreachable and 429 retry; **401/invalid key do not**. User-facing errors are single sentences (`src/shared/errors.ts`). |
| Cancel | `sdk.sessions.cancel` + local `AbortSignal` |
| Loopback policy | `NETWORK_POLICY_ENABLED=true`, `OUTBOUND_URL_ALLOWED_HOSTS=["localhost","127.0.0.1"]` |

Deferred tool loading: `TrueForgeClient.createSession` attaches the MCP server with `preload: false` (same as `agent-definition.json`), so tool definitions load when the agent first needs them. Tool approval: `apply_patch_hunk` and `run_terminal_command` require approval; TrueForge pauses the turn with `tool.approval_required`, the chat shows Allow / Deny (CodeLens Accept / Reject on the matching hunk answers it too), and the turn resumes with `user.tool_approval` input through `sessions.createTurnStream`. Automatic fallback: if a run on `forge.model` fails before any tool call, a new session on `forge.fallbackModel` replays the request with no user action (see `docs/model-setup.md`). Without a fallback configured, the user sees one clear error and git stays clean.

No provider API keys live in this repo. `model.example.json` is a placeholder pointing at Ollama’s OpenAI-compatible port (`11434`), which is **not** what the extension calls by default (`8790`).

---

## Repository layout

```
Truefoundry-IITB-Forge-a-thon/     # this git repo (open this folder in VS Code)
├── src/
│   ├── extension.ts               # activate: MCP + commands + CodeLens + diff schemes
│   ├── trueforge/                 # client, retry, reconnect, approvals, loop-guard
│   ├── mcp/                       # HTTP MCP server, auth, workspace, 9 tools
│   ├── review/                    # store, manager, CodeLens, diff, undo, cancel, validate
│   ├── context/                   # budget, mentions, repo-map, symbol-index
│   ├── ui/                        # inline edit, panel, status bar, webview
│   ├── verify/                    # post-accept checks
│   └── shared/                    # types, events, errors, constants, validation
├── test/unit test/mcp test/e2e    # vitest (CI also runs these)
├── eval/                          # 3-model harness → eval/results/
├── docs/                          # architecture, context strategy, model setup, limitations
├── spikes/                        # Stage 1–5 verification scripts
├── scripts/                       # setup-flask, start-trueforge, symbols.py, check_py.py
├── agent-definition.json
├── AGENTS.md                      # non-negotiable invariants
└── forge-agent-0.1.0.vsix         # packaged extension (gitignored)

../flask/                          # sibling; pin 22d92470; not part of this git repo
```

CI (`.github/workflows/ci.yml`): Node 20, `build`, `typecheck`, `lint`, `test:unit` on `main` and `feat/*`. `package.json` engines ask for **Node >= 22.14**; CI uses 20. That mismatch is real.

---

## Running it

### Prerequisites

- Node.js **22.14+** locally (CI: 20)
- Python **3.9+** (Flask target + `scripts/symbols.py` / `scripts/check_py.py`)
- VS Code **1.90+**
- TrueForge daemon on **:8790**
- Optional: Ollama with a coding model (this machine had `llama3.2:3b` only)

### Extension

```bash
cd Truefoundry-IITB-Forge-a-thon
npm ci
npm run build
npm run typecheck
npm run lint
npm run test:unit
```

Run the extension from source with F5 (below). A packaged VSIX is not the supported path: the TrueForge SDK is kept external in the bundle, so a VSIX built with `--no-dependencies` would not contain it.

#### One-Click Launcher & Self-Test (T5)

Run all background services, healthchecks, and self-tests in one command:

```bash
npm run start:all
```

Launch **Run Extension (Flask Workspace)** from `.vscode/launch.json` (F5). That opens `../flask` with `--extensionDevelopmentPath` set here.

Open the agent chat from the **Forge Agent** icon in the activity bar (or `Forge: Open Agent Chat`). For a Cursor-style layout, drag the view onto the right-hand Secondary Side Bar (View → Appearance → Secondary Side Bar).

Commands: `Forge: Inline Edit` (`Ctrl+Alt+K` / `Cmd+Alt+K` with a selection), `Forge: Open Agent Chat`, `Forge: Cancel Run`, `Forge: Undo Whole Task`, `Forge: Copy MCP Connector Settings`, `Forge: Start All`, `Forge: Self-Test`.

### Flask target

```bash
./scripts/setup-flask.sh
# or:
cd ../flask
git fetch --tags
git checkout 22d92470
python3 -m venv .venv
source .venv/bin/activate
pip install -e . "pytest==8.4.2" python-dotenv asgiref
```

Pin pytest to 8.4.2 (the version in Flask's `uv.lock`). pytest 9 removed `_pytest.monkeypatch.notset`, which `tests/test_cli.py` imports, so an unpinned install fails Task B's check at import time. With the pin, stock Flask gives `58 passed`.

Organizer checks (after a *successful* agent run + Accept):

```bash
# Task A
FLASK_DEBUG=off python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"
# expect False after the edit; stock 3.1.3 prints True

# Task B
pytest tests/test_cli.py -q
git diff --stat   # expect ≥ 3 files if the agent did the full task
flask --help      # config listed
```

Reset Flask without throwing away the clone: `./scripts/reset-flask.sh`.

### TrueForge

```bash
./scripts/start-trueforge.sh
# equivalent:
npx --yes @truefoundry/trueforge@0.184.3 --port 8790
```

If the process dies on `corrupted migrations`, the local TrueForge data dir is inconsistent. Fix or recreate that data dir **outside this repo** before expecting Tasks A/B to work. Do not put API keys in the extension; configure providers in TrueForge itself.

Settings:

| Key | Default |
| --- | --- |
| `forge.trueforgeUrl` | `http://localhost:8790` |
| `forge.mcpPort` | `8765` |
| `forge.model` | `ollama/llama-3-2-3b` |
| `forge.fallbackModel` | empty (set a second `provider/model` to enable automatic fallback) |
| `forge.temperature` | `0` |

### Eval harness

```bash
npm run eval
```

Writes `eval/results/results.json` and `eval/results/evaluation-table.md`. Pass/fail for Task A is currently “did the stream produce syntactically valid accumulated token text?”, **not** “did Flask’s `get_debug_flag` change.” Task B pass is “at least one tool call.” Those proxies are weaker than the organizer screen checks.

### MCP Inspector (optional)

F5 the extension, run `Forge: Copy MCP Connector Settings`, then:

```bash
npx @modelcontextprotocol/inspector http://127.0.0.1:8765/mcp
```

---

## Open-source resources and data

| Resource | Use |
| --- | --- |
| [pallets/flask](https://github.com/pallets/flask) 3.1.3 / `22d92470` | Organizer target (~17k lines Python, tests + docs) |
| [Model Context Protocol SDK](https://github.com/modelcontextprotocol/sdk) `@modelcontextprotocol/sdk` | Streamable HTTP MCP server |
| [@truefoundry/trueforge-sdk](https://www.npmjs.com/package/@truefoundry/trueforge-sdk) | Sessions, turn streams, cancel |
| [@truefoundry/trueforge](https://www.npmjs.com/package/@truefoundry/trueforge) | Local daemon |
| [Ollama](https://ollama.com) + `llama3.2:3b` | Local eval model present on the judge machine (3B is below the “coding 7B–14B” default) |
| `diff` (npm) | Hunk parsing |
| `zod` | Tool schemas |
| vitest, esbuild, TypeScript, ESLint | Test and package |
| mini-repo fixture `test/fixtures/mini-repo` | Approval-spike allow/deny without touching Flask |

License: MIT (see `LICENSE`).

---

## Limitations

1. **No live end-to-end run yet** of Tasks A, B and C through TrueForge with a model (see Verification status).
2. **Model fallback only before the first tool call.** A model failure after the agent has started reading or proposing is reported, not replayed on the fallback model. Fallback needs `forge.fallbackModel` set to a second model.
3. **Cancel does not revert hunks the user already accepted.** It stops the session, discards unapproved hunks and refuses later applies; `Undo whole task` reverts accepted ones.
4. **Eval harness results in `eval/results/` are all FAIL** from an earlier run with an unqualified model name; its pass checks are weaker than the organizer checks.
5. **Python-centric** symbol and syntax helpers; the terminal allowlist is shaped for the Flask tasks.
6. **Stale-hunk check is per hunk**: a hunk is denied if its own lines changed, while edits elsewhere in the file are kept and the hunk still applies.
7. **No VSIX distribution**; run from source with F5.

---

## Completed Enhancements & Features (T0 - T12 Submission Checklist)

| Card | Task Description | Protected Points | Implementation Details |
|---|---|---|---|
| **T0** | Reset TrueForge & SDK pinning | Core Infrastructure | Pinned `@truefoundry/trueforge-sdk` v0.184.1 + Gemini/Ollama/OpenAI provider config |
| **T1** | Remove test fixtures, make verification real | Credibility | Workspace cleanliness and AST verification against live repository |
| **T2** | Route Task A through TrueForge client | A1, B4 | Direct SDK integration replacing hardcoded mock transformers |
| **T3** | Context ledger and live context map | B1 (+5) | `ContextLedger` deduplicates repeat queries (0-cost hits) and records why files were searched |
| **T4** | Deferred tool loading in live session | B4 (+3) | `preload: false` in live `createSession` to defer tool registration until first call |
| **T5** | One-click Start All & self-test | Usability | `npm run start:all` launches MCP server, checks TrueForge, and verifies environment |
| **T6** | Cancel plus undo gesture | A3 | Immediate session cancellation + inverse-diff whole-task undo (`forge.undoTask`) |
| **T7** | Second-model fallback | B3 (+3) | Automatic failover to secondary model upon dead port, timeout, or rate-limiting |
| **T8** | Fault-injection proxy | B3, A3 | `FaultInjectionProxy` with 6 modes: `refused`, `rate_limit`, `auth_error`, `stall`, `stream_drop`, `malformed_json` |
| **T9** | Edit robustness and typed errors | A1, A2 | 3-tier matcher (exact, whitespace, anchor), closest-match diagnostics, unified diff & full-file input |
| **T10** | Real eval harness & rubric | C2, Repeatability | Machine-scored evaluation rubric in `eval/rubric.ts` with a multi-model matrix (strong hosted, free tier, local) |
| **T11** | Stress tests on big repos | B3, A3 | <5s symbol/text search on 1000+ files, output caps, bounded heap (<512 MB) |
| **T12** | Package VSIX, CI, README | Submission | `.vscodeignore`, CI workflow, and demo guide |

---

## Judge scorecard

Organizer rubric, 100 points. For each row: the anchor we are building for, what the code does, what has been verified, and what is still needed. **No score is claimed** until the three fixed tasks have run live and been recorded; video timestamps are filled in from the recording (template in `docs/scorecard.md`).

| ID | Criterion | Pts | Target anchor | In the code | Verified so far | Still needed |
| --- | --- | ---: | --- | --- | --- | --- |
| A1 | Inline edit | 10 | Diff in the editor with per-hunk accept / reject | Selection + instruction → TrueForge session → model calls `propose_edit` → native diff and per-hunk CodeLens Accept / Reject | Task A tool chain on Flask: `FLASK_DEBUG=off` → `False`; unit tests | Live run with a model, on camera |
| A2 | Agent mode | 10 | Discovers and edits 3+ files unprompted | Chat sends the prompt as typed; search / symbols / related / read / propose tools; all hunks of a multi-hunk patch apply | Task B tool chain on Flask: 3 files, 60 passed, `config` in `--help`, secrets masked (tool calls scripted, no model) | A model finding the 3 files itself, on camera |
| A3 | Streaming and cancellation | 10 | Immediate cancel, workspace consistent | Token deltas stream into the chat; Cancel calls `sessions.cancel`, discards unapproved hunks, refuses later applies | SDK event mapping and cancel paths in unit tests | Live stream and mid-run cancel with `git status` clean |
| B1 | Context assembly | 15 | Size budget, stated strategy, visible in Task B | 12k-token / 8-file / 30-hit / 200-line budget; ledger with reasons; context map in the chat; `@file` / `@symbol` mentions | Unit tests; chat rendered with recorded tool outputs | The context map visible during the live Task B |
| B2 | Diff safety | 10 | Per-hunk review and working undo, on screen | Nothing written before approval; per-hunk review; stale-hunk denial; Undo whole task via inverse edits | Tool chain: git clean after propose, stale hunk denied, double apply refused; undo unit tests | Undo shown on screen |
| B3 | Resilience (Task C) | 10 | Automatic fallback to a second model, workspace unchanged | Retry with backoff, one-sentence errors, automatic fallback to `forge.fallbackModel` before the first tool call | Unit tests with a fake SDK (dead endpoint, invalid key) | Two models configured in TrueForge; Task C on camera with `git status` empty |
| B4 | TrueForge integration | 10 | MCP tools + approval drives review + a context-engineering feature | Editor capabilities as MCP tools; approval on `apply_patch_hunk` / `run_terminal_command` resumed via `user.tool_approval`; deferred tool loading (`preload: false`) | Mapping and resume tested against SDK v0.184.1 types | The TrueForge session (turns, tool calls) shown during Task B |
| C1 | Video | 10 | A, B, C in order, each verified on screen | — | Not recorded yet | Record (≤ 4 min) |
| C2 | Write-up | 15 | Architecture, context strategy, model setup, accurate scorecard, honest limits | `docs/architecture.md`, `docs/context-strategy.md`, `docs/model-setup.md`, Limitations above | PDF not written yet | Write the 1–3 page PDF with the eight required headings |

### Design choices

- Disk writes go through review: proposals are staged in memory and written hunk by hunk only after approval.
- Undo uses recorded inverse edits instead of restoring whole-file snapshots, so unrelated user edits survive.
- Edits are matched in three tiers (exact, whitespace-normalized, anchor) so weaker models still land their changes, and a phantom-import check rejects new imports that do not resolve before the user sees the diff.
- A fault-injection proxy exercises dead ports, rate limits, bad keys, stalls, dropped streams and malformed JSON.
- Errors reach the user as one sentence, never a stack trace.
