# Forge-a-thon scoring criteria readiness

This checklist distinguishes code and local test evidence from live TrueForge model evidence. The attached scoring sheet is the source for A1–B4. No success below claims that a live model session has been recorded.

## Implementation checklist

| Criterion | Implementation status | Actual execution test | Expected evidence | Recording ready |
| --- | --- | --- | --- | --- |
| A1 | Inline selection and instruction go through the TrueForge SDK; the selected text is included in the request; MCP proposes the edit; native VS Code diff and per-hunk CodeLens review are used. | `test/unit/inline-edit.test.ts`, `test/unit/trueforge-routing.test.ts`, `test/unit/review-adopts-mcp-patches.test.ts`; live model run still required. | Selected `get_debug_flag`, real streamed proposal, native diff with Accept/Reject, unchanged file before approval, accepted edit on disk, then `FLASK_DEBUG=off ...` prints `False`. | Live session pending. |
| A2 | The raw prompt is forwarded without target filenames. The session discovers with `search_text`, `search_symbols`, `find_related`, and `read_file`; edits are staged and approval-gated. | `test/unit/trueforge-routing.test.ts`, MCP server tests, plus `../flask/.venv/bin/python -m pytest tests/test_cli.py -q` against the existing modified checkout. Live agent discovery still required. | TrueForge tool timeline shows discovery of implementation, test, and docs; three separate diffs; pytest passes; `config` appears in `flask --help`; secret fields print as `***`. | Live session pending. |
| A3 | TrueForge turn cancellation aborts the local stream, calls `sessions.cancel`, drops unapplied hunks, and blocks late `propose_edit`/`propose_patch` calls after cancellation. A new run resets cancellation state. Removed the fixed, fabricated cancellation transcript. | `test/e2e/cancel.test.ts`, `test/unit/stage6-cancel-retry-errors.test.ts`, and `test/unit/propose-edit.test.ts`; live stream cancellation still required for the recording. | Text deltas/tool events stop after Cancel; pending and late proposals are discarded; clean recording workspace remains clean in `git status`. | Recording pending; implementation verified. |
| B1 | The context ledger is populated by actual MCP reads/searches and mention resolution. It reports reasons, read line ranges, skipped candidates, estimated retrieved tokens, and the configured 12,000-token budget. Task B starts with an empty ledger. | `test/unit/t3-context-ledger.test.ts`, `test/unit/mention-context.test.ts`, `test/unit/budget.test.ts`; live Task B map still required. | Context map changes only after real repository retrieval and shows paths/reasons/ranges plus token use against 12,000. | Live session pending. |
| B2 | Proposals stay in memory; each changed file opens in native diff review; individual hunks can be accepted or rejected; whole-task Undo replays inverse edits. | `test/unit/stage3-review-engine.test.ts`, `test/unit/edit-pipeline.test.ts`, `test/e2e/review-flow.test.ts`; live accept/reject/undo still required. | An unapproved diff leaves disk unchanged; accept selected hunks, undo the task, and show `git diff` returned to the clean recording baseline. | Live session pending. |
| B3 | Existing retry/backoff and primary-to-fallback code is connected to the live TrueForge stream. It creates a new fallback session and replays the same prompt before any tool call. | `test/unit/retry.test.ts`, `test/unit/model-fallback.test.ts`, `test/unit/task-c-dead-port.test.ts`; a real unreachable provider plus configured Gemini fallback remains unverified. | The primary endpoint fails; the extension reports the reason, switches to Gemini without user action, stays responsive, and the clean recording workspace has no changes before approval. | Live provider/configuration pending. |
| B4 | The extension uses the TrueForge SDK for sessions, turns, streaming, cancellation, and `user.tool_approval`; the loopback MCP server supplies real workspace tools. MCP tools load deferred (`preload: false`) by default and Task B allows discovery, proposal, and apply tools. | `test/unit/sdk-event-mapping.test.ts`, `test/unit/t4-deferred-loading.test.ts`, `test/mcp/server.test.ts`; a live daemon/model session remains required. | TrueForge shows an SDK session and turn, real MCP search/read/propose/apply calls, approval pause, and resume of that turn after CodeLens approval. Session creation logs `preload=false`. | Live session pending. |

## Changes made in this pass

- Removed prewritten Task A and Task B context entries, diffs, token totals, and direct filesystem writes from the chat panel.
- Removed the `Forge: Demo Task A` command, which had staged a fixed edit without a model request.
- Routed inline stream events through the same panel event renderer as chat, included selected source in the TrueForge request, and opened actual proposals in native diff review.
- Removed filename hints from Task B's session instructions, enabled the real discovery tools, enabled `apply_patch_hunk`, and made Task B use deferred MCP loading.
- Replaced the scripted cancellation claim with the real cancellation result.
- Changed dead-port/fault-proxy tests to compare workspace status before and after instead of assuming the user's pre-existing Flask checkout is clean.
- Added an `API_TOKEN` masking assertion to the existing Task B test in `../flask/tests/test_cli.py`.
- Added a separate launch target for `../flask-recording`, a clean local clone at Flask 3.1.3 commit `22d92470`; the original `../flask` checkout and its three existing edits are preserved.

## Verified locally

- Extension build, TypeScript check, and lint passed after the source changes.
- Full extension unit suite: **39 files passed, 256 passed, 2 skipped**. End-to-end Vitest suite: **3 files passed, 12 passed**. `test:e2e` now points to the repository's actual `test/e2e` Vitest suites.
- Flask 3.1.3 `tests/test_cli.py`: **56 passed, 3 skipped** in the existing modified checkout.
- The existing Flask `config` command prints `SECRET_KEY` and `SECRET_KEY_FALLBACKS` as `"***"`; `flask --help` lists `config`.
- A real Streamable HTTP MCP client connected to the real Forge MCP server with the clean Flask clone as its workspace. `search_symbols`, `find_related`, `read_file`, and `propose_edit` succeeded; one hunk was staged in memory and the source file remained unchanged. This was a tool-protocol smoke test without a model; it does not verify live TrueForge routing or approval pause/resume.
- The current `../flask/src/flask/helpers.py` is still stock, so its verification command prints `True`. Run A1 through the extension and approve its proposed change to get the required `False`.
- No TrueForge daemon is listening on port 8790 in this environment, so live Gemini execution and live editor recording cannot be verified here.

## Local setup for recording

From the extension repository:

```bash
npm run build
npm run start:all
```

Configure provider credentials and model names in TrueForge itself. Keep `forge.trueforgeUrl` pointed at `http://localhost:8790`. In VS Code, open this extension repository, select **Run Extension (Clean Flask Recording)** in Run and Debug, and press F5. This launches the Extension Development Host with the clean `../flask-recording` checkout. Use a shell in that checkout for verification commands. The existing `../flask` checkout retains your prior Task B edits.

In the recording host terminal, activate the already-installed Flask test environment and point imports at the clean checkout (the existing virtual environment is editable-installed against `../flask`):

```bash
source ../flask/.venv/bin/activate
export PYTHONPATH="$PWD/src"
```

For Task C, configure the primary TrueForge model's provider endpoint in TrueForge to an unreachable local endpoint such as `http://127.0.0.1:9/v1`, and set `forge.fallbackModel` to the Gemini model identifier as listed in TrueForge. Do not change `forge.trueforgeUrl`; the daemon must stay reachable at port 8790. Restore the primary provider endpoint after recording.

## Supplemental recording order

Capture only the portions missing from your existing video; keep each clip short and join them in this order:

1. **A1 review evidence, only if the earlier clip omitted it.** In the clean recording host open `src/flask/helpers.py`, select the whole `get_debug_flag` function, invoke `Cmd+Alt+K`, and use the organizer's instruction: “Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.” Show the real native diff and per-hunk controls. Show the source unchanged, accept the hunk, then run the exact command `FLASK_DEBUG=off python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"`; expected output is `False`. If you capture this supplemental edit, reset only `flask-recording/src/flask/helpers.py` with `git restore src/flask/helpers.py` afterward so later clean-status clips start from the clean baseline. This disposable checkout is separate from the original Flask working tree.
2. **A2 discovery and B1 context map.** In Agent Chat paste the organizer's exact Task B instruction without adding filenames: “Add a new built-in CLI command flask config that prints the loaded application's configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as \"***\". It must appear in flask --help, be covered by a test, and be documented alongside the other built-in commands.” Show search and read tool calls, the context map with reasons/ranges and its live token meter, then the implementation, test, and docs proposals. Do not accept until each diff is visible.
3. **B4 approval pause and resume.** Keep the TrueForge session/tool timeline visible while the agent calls `apply_patch_hunk`. Show the approval pause, click Accept for one displayed hunk, and show the same turn resume with the corresponding `user.tool_approval` event and subsequent actual tool result. Keep the session creation/output visible long enough to show deferred loading (`preload=false`).
4. **B2 hunk safety and Undo.** Show an unapproved hunk with the source unchanged, reject one hunk and accept the required hunks individually. Run `pytest tests/test_cli.py -q`, show all tests passing, then run `Forge: Undo Whole Task`. Show `git status --short` and `git diff` clean in `flask-recording` after Undo.
5. **A3 cancellation.** Start a fresh real agent run with a request that takes multiple streamed steps, show deltas and MCP events, and click Cancel while it is still running. Show the stopped stream and run `git status --short` in `flask-recording`; it should remain empty. Avoid accepting any hunk during this clip.
6. **B3 automatic fallback.** With the unreachable primary and Gemini fallback configured, invoke the original Task A instruction through Inline Edit. Show the primary connection error/retries, the automatic Gemini switch and response, and the still-responsive editor. Leave the proposed change unapproved, then show `git status --short` empty. Restore the primary model endpoint after the clip.

For Task B terminal checks, run:

```bash
flask --app examples/tutorial/flaskr/__init__.py --help
flask --app examples/tutorial/flaskr/__init__.py config
pytest tests/test_cli.py -q
```

`--help` must list `config`; the actual tutorial app output must show `SECRET_KEY: "***"`. The test also asserts `API_TOKEN` is masked. Do not claim a live fallback or model-generated patch from unit tests; the corresponding clips require the configured daemon and providers.
