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
| **Agent panel** | Raw prompt only — **no filenames injected**. The model must `search_text` / `read_file` / `find_related` / `propose_patch`. |
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

## Results

Two layers of evidence exist. They **do not agree**. This README treats them separately.

### Independently verified (this machine, 2026-11-16)

| Check | Result |
| --- | --- |
| `npm run test:unit` | **132 passed / 23 files**, ~1.4s (includes Task C dead-port, retry/backoff, cancel, review engine, MCP, budget, routing) |
| Flask checkout | `22d92470` (3.1.3), **clean working tree** |
| Task A verification command on *current* Flask | `FLASK_DEBUG=off` → **`True`** (stock 3.1.3 still treats only `0` / `false` / `no`). Task A is **not** left applied on disk. |
| `pytest tests/test_cli.py -q` on Flask | **55 passed, 3 skipped** — no `flask config` command in `src/flask/cli.py` |
| TrueForge `http://localhost:8790` | **Down.** Last local log (`logs/trueforge.log`) shows TrueForge v0.183.2 failing: `corrupted migrations: previously executed migration 20261103_000002_query_path_indexes is missing` |
| Ollama `http://localhost:11434` | **Up**, model `llama3.2:3b` present |
| `eval/results/results.json` (harness date 2026-11-15T16:10:43Z) | All six Task A/B runs **FAIL**, 0 tokens, reason: `Can't reach the model at http://localhost:8790. Check TrueForge settings.` |
| Organizer video | **Not in this repo** (`demo/` contains only `demo/app.py`) |

Could not independently re-run organizer Tasks A/B end-to-end against a live TrueForge session. Could not start the daemon here without mutating `~/.trueforge` (migration corruption). Task C behavior **is** covered by unit tests against a closed port (`http://127.0.0.1:9/v1`) and `BadCredentialError`.

### Claimed demo numbers (submitter screenshot; not reproduced here)

| Task | Claimed output | Claimed status |
| --- | --- | --- |
| A Inline edit | `FLASK_DEBUG=off` → `False`; CodeLens review + rollback | PASS **1.2s, 85 tokens** |
| B Agent mode | `pytest` 56 passed; `git diff` 3 files (`cli.py`, `test_cli.py`, `cli.rst`); secrets masked as `***` | PASS **3.4s, 3.1k tokens** (budget cap 12k) |
| C Resilience | 3 retries with exponential backoff; message `Can't reach the model at http://127.0.0.1:9/v1. Check TrueForge settings.`; no stack traces; `git status --porcelain` empty | PASS **395ms, 0 tokens** |

**How to read this.** 85 tokens / 1.2s for Task A is consistent with a tiny completion *or* with the **local** `InlineEditController.generateReplacement()` transformer (hard-coded `get_debug_flag` rewrite used by unit tests). Production `trigger()` does **not** call that transformer; it calls `TrueForgeClient.runTaskA`. Treat 85 tok as **claimed**, not measured in this evaluation.

Task B’s jump from 55 → 56 pytest cases is exactly “one new test.” The three-file set is the right shape for the organizer prompt. It was not present on disk when judged.

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

**Honest gap:** the webview has a context-map component, but `AgentPanelProvider` never posts `context_update`. Only a zeroed `budget_update` is sent at prompt start. File-choice “why” is therefore **not** visible in the panel unless you infer it from the tool timeline.

---

## How it uses TrueForge

| Piece | Binding |
| --- | --- |
| SDK | `@truefoundry/trueforge-sdk` `^0.184.1` |
| Daemon | `npx @truefoundry/trueforge@0.184.3 --port 8790` (`scripts/start-trueforge.sh`) |
| Default URL | `forge.trueforgeUrl` → `http://localhost:8790` (`src/trueforge/config.ts`) |
| Default model setting | `qwen2.5-coder:7b` (VS Code `forge.model`); eval harness lists Claude 3.5 Sonnet, Gemini 1.5 Flash, Llama 3.2 3B — **all via the same localhost proxy** |
| Temperature | `0` |
| MCP attach | Session `mcpServers: [{ name: 'forge-workspace', requireApprovalForTools: ['apply_patch_hunk', 'run_terminal_command'] }]` |
| Streaming | SDK turn stream mapped to `token` / `tool_call` / `tool_result` / `approval` / `error` / `done` |
| Retry | 3 retries, 1s → ×2 backoff, cap 10s. Unreachable and 429 retry; **401/invalid key do not**. User-facing errors are single sentences (`src/shared/errors.ts`). |
| Cancel | `sdk.sessions.cancel` + local `AbortSignal` |
| Loopback policy | `NETWORK_POLICY_ENABLED=true`, `OUTBOUND_URL_ALLOWED_HOSTS=["localhost","127.0.0.1"]` |

`agent-definition.json` sets `"preload": false` (deferred tool loading). **`TrueForgeClient.createSession` does not pass `preload: false`.** A spike (`spikes/verify-stage1.ts`) tests it; the production session path does not. There is **no automatic failover to a second configured model** — Task C’s 10-point anchor is not implemented. After retries the user sees the clear error and git stays clean (7-point anchor).

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
npm install
npm run build
npm run typecheck
npm run lint
npm run test:unit
```

Launch **Run Extension (Flask Workspace)** from `.vscode/launch.json` (F5). That opens `../flask` with `--extensionDevelopmentPath` set here.

Commands: `Forge: Inline Edit`, `Forge: Open Agent Panel`, `Forge: Cancel Run`, `Forge: Undo Whole Task`, `Forge: Copy MCP Connector Settings`.

### Flask target

```bash
./scripts/setup-flask.sh
# or:
cd ../flask
git fetch --tags
git checkout 22d92470
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]" pytest
```

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
| `forge.model` | `qwen2.5-coder:7b` |
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

1. **Live Tasks A/B were not re-run in this evaluation** because TrueForge would not start (migration error) and Flask still has stock 3.1.3 behavior.
2. **Eval harness stored results are all FAIL** (proxy down). Do not cite `eval/results/` as a pass table.
3. **Task A has a canned local rewriter** (`transformGetDebugFlag`) used in tests. That is not the production inline-edit path, but it can inflate a demo if someone wires it back.
4. **No second-model fallback.** Dead port → 3 retries → one sentence. Workspace unchanged. Full 10-point Task C anchor is not met.
5. **Cancel does not auto-revert already accepted hunks.** Use `Forge: Undo Whole Task`. That is the 7-point streaming/cancel anchor, not 10.
6. **Context map is not fed from MCP reads.** Budget and “which files and why” are not proven visible on Task B.
7. **`preload: false` is not applied in `createSession`.** Deferred tool loading is a spike, not the live session.
8. **Python-centric** symbol/AST helpers. Terminal allowlist is Flask-demo shaped.
9. **Node engine vs CI** (22.14 vs 20). README previously claimed `out/`; the build emits `dist/`.
10. **No competition video in-tree.** Presentation criterion C1 cannot be scored above 0 from this repository alone.
11. **`docs/scorecard.md` is not the 100-point rubric** (feature list + timestamps). The table below is.

---

## Judge scorecard

Anchors from the organizer rubric. **Between two anchors, the lower value is used.** Claimed screenshot PASSes were **not** independently reproduced.

| ID | Criterion | Points | Why |
| --- | ---: | ---: | --- |
| A1 | Inline edit | **10** / 10 | Per-hunk CodeLens Accept **and** Reject; native diff; reject is in-memory. Implemented and unit-tested. |
| A2 | Agent mode | **7** / 10 | Tool loop + raw prompt with no filenames (`runTaskB`). 10 requires unprompted 3-file Task B on Flask; that tree is clean and eval FAILed. Lower anchor: several-file *capability*, discovery not independently shown. |
| A3 | Streaming | **7** / 10 | Token stream UI + cancel that discards unapplied hunks. Cancel **leaves applied hunks** (explicit test). 10 needs immediate cancel *and* consistent workspace without leftover half-applies. |
| B1 | Context assembly | **10** / 15 | Budget + strategy written and enforced. 15 needs Task B to *show* chosen files and why; `context_update` is never posted. |
| B2 | Diff safety | **10** / 10 | Propose-only until Accept; per-hunk review; inverse-edit undo (`forge.undoTask`). Covered by Stage 3 tests (28) + e2e. |
| B3 | Resilience (Task C) | **7** / 10 | 3× exponential backoff, single-sentence errors, no stack traces, porcelain empty in tests. **No auto fallback model.** |
| B4 | TrueForge integration | **7** / 10 | Real SDK sessions + editor capabilities as MCP tools. 10 needs a context-engineering feature **used in the live session**; `preload: false` is not passed; no subagents / compaction / Code Mode / skills on the hot path. |
| C1 | Video | **0** / 10 | Three-task video not in the repository; not verified on screen here. |
| C2 | Write-up | **15** / 15 | Architecture, retrieval strategy, model setup, trade-offs, this scorecard, honest limitations, claimed vs verified split. |
| | **Total** | **73** / 100 | A 24/30 · B 34/45 · C 15/25 |

### Verdict

- **Is it good?** As an editor harness: yes. Review, confinement, allowlist, retry, and undo are real code with a green 132-test suite — not a prompt-only demo.
- **Is it efficient?** **Unknown on the live model path.** Claimed 85 tok / 3.1k tok is attractive against a 12k retrieved-context cap; stored harness data is 0 tok FAIL. Do not treat the screenshot latencies as measured here.
- **Can it handle real organizational tasks?** The *product shape* (hunk review, budget, no keys in the IDE) is what orgs need. The *live agent* was not shown against Flask in this evaluation, the default local model on this machine is 3B, and context visibility in the panel is incomplete. Not yet something you would roll out as a default coding agent.
- **Would it be selected on these scores?** **73 with C1 = 0 is mid-pack**, not a standout. If a complete, legible three-task video exists off-repo, C1 could move to 5–10 (total 78–83) **without changing A2/B1/B3/B4**, which still sit on the lower anchors because discovery, context visibility, fallback, and context-engineering usage were not proven.

### What already stands out

- Disk writes are a privilege, not a default.
- Inverse-edit undo instead of clobbering the file.
- Error taxonomy that matches the organizer’s “one sentence, no stack.”
- MCP auth, path confinement, and command allowlist are actually tested.
- Module READMEs (`src/*/README.md`) match the code more closely than typical hackathon docs.

### What to do more of (standout path)

1. **Make Task B visible:** post `context_update` from `read_file` / `search_text` / `find_related` with path + reason; screenshot the map showing `cli.py` → `test_cli.py` → `cli.rst`.
2. **Pass `preload: false` (or compaction) in `createSession`** and show it in the session log — that is the B4 10-point jump.
3. **Second model in config** + automatic failover after retries — B3 10.
4. **Cancel that offers undo of applied hunks in one gesture** so A3 can honestly claim workspace consistency.
5. **Delete or clearly quarantine `transformGetDebugFlag`** so Task A cannot be accused of being a fixture.
6. **Fix the eval harness** to run organizer commands (`get_debug_flag`, `pytest`, `git diff --stat`) against `../flask`, and fail closed if TrueForge is down rather than writing a PASS/FAIL table of connection errors.
7. **Check a three-task video into `demo/`** (or a stable URL). C1 is free points the repo currently leaves on the table.
8. **Pin a 7B–14B coding model** in `scripts/dev/start.sh` and `forge.model`; 3B is not a fair coding eval.
9. **Repair TrueForge migrations** in the runbook so a judge can `./scripts/start-trueforge.sh` without archaeology.

That list is the difference between a strong Stage-3 VS Code review engine and a product a platform team would actually keep.
)
