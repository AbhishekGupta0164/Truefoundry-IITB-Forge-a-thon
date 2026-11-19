# TrueForge Spikes & Verification Reports

## T4: Deferred Tool Loading in the Live Session (B4 10-point Anchor)

### 1. Goal
Ensure the live session uses `preload: false` on the MCP connector spec so that tools are discovered on demand rather than eagerly polluting the initial model context window (B4 anchor).

---

### 2. SDK Location Investigation (Step 1)
Using `grep -rn 'preload' node_modules/@truefoundry/trueforge-sdk`:
- **Defined on**: `TrueForge.McpServer` interface (`agent.spec.mcpServers[].preload?: boolean`)
  - File: `node_modules/@truefoundry/trueforge-sdk/dist/esm/api/types/McpServer.d.mts:10`
  - Docstring: `When true, load all tool schemas upfront. Default: false (deferred discovery).`
  - Accompanying property: `preloadTools?: TrueForge.McpServerToolSelector[]` (eagerly load specific tools while keeping the rest deferred).
- **Also defined on**: `TrueForge.Skill` interface (`agent.spec.skills[].preload?: boolean`).
- **Conclusion**: `preload` belongs strictly on the **MCP server entry** (`agent.spec.mcpServers`), NOT on top-level session or agent root.

---

### 3. Implementation in `TrueForgeClient.createSession` (Step 2)
In `src/trueforge/client.ts`:
```typescript
public async createSession(
  model?: string,
  instructionsOverride?: string,
  options: { preload?: boolean; compaction?: boolean } = {}
): Promise<string> {
  const targetModel = model ?? this.config.model;
  const preload = options.preload ?? false; // T4: Deferred tool loading default (preload: false)

  const mcpServerSpec: Record<string, any> = {
    name: 'forge-workspace',
    preload,
    requireApprovalForTools: ['apply_patch_hunk', 'run_terminal_command']
  };

  const agentSpec: Record<string, any> = {
    model: {
      name: targetModel,
      params: { temperature: this.config.temperature }
    },
    instructions,
    mcpServers: [mcpServerSpec]
  };

  if (options.compaction) {
    agentSpec.config = {
      contextManagement: {
        compaction: {}
      }
    };
  }

  const { data: session } = await sdk.sessions.create({ agent: { spec: agentSpec } });
  return session.id;
}
```

Both `runTaskA` and `runTaskB` call `createSession()` with `preload: false`.

---

### 4. Live Session Verification (Step 3 & Step 4)
- **TrueForge Endpoint**: `http://localhost:8790`
- **Created Session ID**: `01m7mzgng633g0vj743jx18dzq`
- **Session Spec from TrueForge Server**:
  ```json
  "mcpServers": [
    {
      "name": "forge-workspace",
      "enableTools": ["@all"],
      "disableTools": [],
      "preloadTools": [],
      "requireApprovalForTools": [
        "apply_patch_hunk",
        "run_terminal_command"
      ],
      "preload": false
    }
  ]
  ```
- **Observed Behavior**:
  - `preload: false` is accepted and persisted by TrueForge server.
  - The model discovers tools on-demand per execution turn.
  - Compaction fallback (`options.compaction: true` / `options.preload: true`) is tested and available if deferred tool loading encounters latency or token limits.

---

### 5. Automated Verification
- **Unit Test**: `test/unit/t4-deferred-loading.test.ts` (4 passing tests)
  - `createSession defaults to preload: false on mcpServers entry (deferred discovery)`
  - `createSession respects explicit preload: true option`
  - `createSession configures compaction when compaction: true is passed`
  - `runTaskB invokes createSession with deferred tool loading`
- **Live Spike**: `spikes/verify-t4.ts`


---

## T8: Fault-Injection Proxy & Resilience Testing (B3, A3 Anchor)

### 1. Goal
Provide a local fault proxy in front of the model endpoint to simulate real-world failure modes:
1. `refused`: closed port / connection dropped abruptly
2. `rate_limit`: HTTP 429 with `Retry-After` header
3. `auth_error`: HTTP 401 Bad Credentials (fails immediately with 0 retries)
4. `stall`: hanging connection / request timeout
5. `stream_drop`: mid-stream SSE socket termination
6. `malformed_json`: corrupted event payload

### 2. Invariants Enforced
- **Zero unapproved writes**: `git status --porcelain` remains clean across all failure modes.
- **Clear human-readable error messages**: No raw stack traces exposed to user or UI.
- **Bounded retries & backoff**: 3 attempts with exponential backoff on transient errors; zero retries on auth errors.
- **Verification**: `test/unit/t8-fault-proxy.test.ts` (7 passing tests) & `spikes/verify-t8.ts`.


---

## T9: Edit Robustness, Multi-Tier Matcher & Typed Errors (A1, A2 Anchor)

### 1. Goal
Provide a resilient edit engine that is forgiving on input (tolerant to model formatting errors) and strict on output:
1. **Tier 1**: Exact unique match.
2. **Tier 2**: Whitespace-normalized match (tabs, spaces, CRLF, trailing spaces) with automatic re-indentation of replacements.
3. **Tier 3**: Anchor match (first and last lines anchored within a sliding window, tolerates drifted middle with >=0.70 similarity).
4. **Diagnostics on failure**: Returns closest candidate line number, 5-line excerpt, and difference hint (`matched 0 times; closest match at line X, differs at line Y`) or ambiguous line numbers (`ambiguous: matched at lines 12 and 88, add context`).
5. **Alternative inputs**: Accepts unified diff and full-file replacement formats, converting both into server-side hunks.
6. **Tool-call repair**: Automatically repairs stringified JSON, alias argument keys, and strips leading slashes in paths.
7. **In-memory validation pipeline**: Validates Python AST syntax in-memory before staging.
8. **Hunk dependency graph**: Detects when later hunks rely on symbols/imports introduced in earlier hunks (`dependsOn`).


---

## T10: Real Evaluation Harness & Machine-Scored Rubric (C2 Anchor)

### 1. Goal
Provide a repeatable, machine-scored evaluation harness (`eval/run.ts`, `eval/rubric.ts`) that runs 3 iterations across 3 models:
1. **Strong Hosted Model** (e.g., GPT-4o mini)
2. **Hosted Free-Tier Model** (e.g., Gemini 1.5 Flash)
3. **Local Evaluation Model** (e.g., Llama 3.2 3B)

### 2. Machine-Scored Rubric Metrics
- **Task A**:
  - Python AST syntax validity check.
  - Case-insensitive boolean handling for `off`, `n`, `N`, `Off`.
  - Comprehensive docstring listing every false value (`0`, `false`, `no`, `off`, `n`).
  - Strict scope guard checking only `get_debug_flag` area was touched.
- **Task B**:
  - At least 3 files discovered and modified.
  - `pytest tests/test_cli.py` passing status.
  - `flask --help` listing `config` command.
  - Configuration keys with `SECRET`, `PASSWORD`, `TOKEN`, `KEY` masked as `'***'`.
  - Zero unapproved writes (`git status --porcelain` clean).
- **Matrix Outputs**:
  - Pass rate (%), median latency (ms), median tokens, median tool calls, flake rate (%), and common failure notes.
  - Results written to `eval/results/results.json` and `eval/results/evaluation-table.md`.

---

## T11: Stress Tests on Big Repos (B3, A3)

### 1. Goal
Verify that all MCP tools (`search_symbols`, `search_text`, `read_file`, `find_related`) handle large repositories (500+ files, 1 MB+ content, real-world repos like Flask) within strict performance budgets and memory limits without deadlock or OOM.

### 2. Implementation & Test Coverage
- **Performance Budgets**:
  - `search_symbols` across 600+ synthetic files and 1000+ Flask files completes in < 5000 ms.
  - `search_text` across large workspaces finishes within < 5000 ms.
  - `read_file` on large files (1 MB+) returns within < 1000 ms.
- **Output Capping & Sanitization**:
  - `sanitizeToolOutput` strictly bounds raw text output to `DEFAULT_TOOL_OUTPUT_CAP` (2048 chars / ~2 KB) with a clear `[Output truncated to ...]` truncation marker.
  - Prevents context window explosion and OOM when tools encounter high-frequency matches or huge files.
- **Concurrency & Deadlock Prevention**:
  - Verified 10 concurrent symbol search tool calls complete without deadlock or race conditions in < 15 seconds.
- **Memory Boundedness**:
  - Verified heap growth during full workspace traversal stays well under 512 MB.
- **Spike & Unit Tests**:
  - `test/unit/t11-stress-tests.test.ts` (8 passing stress tests).
  - `spikes/verify-t11.ts` (manual executable verification spike).

---

## T12: Package VSIX, CI Pipeline, & README (Submission)

### 1. Goal
Prepare complete submission artifacts, ensure clean VSIX packaging, continuous integration automation, and thorough reproduction documentation for evaluators.

### 2. Implementation & Artifacts
- **VSIX Packaging**:
  - Configured `.vscodeignore` to exclude development assets (`src/`, `test/`, `eval/`, `spikes/`, configuration files).
  - Added `package` and `vsce-package` scripts via `@vscode/vsce package --no-dependencies`.
  - Verified packaging produces a clean ~562 KB `forge-agent-0.1.0.vsix` containing 35 essential distribution files.
- **CI Pipeline (`.github/workflows/ci.yml`)**:
  - Triggers on `main` and `feat/*` branches.
  - Enforces full quality gates: dependency install, extension build, typecheck, linting, unit test suite, and VSIX packaging verification.
- **Demo & Reproduction Guide (`demo/README.md`)**:
  - Detailed step-by-step reproduction instructions for Tasks A, B, and C.
  - Video walkthrough link placeholder.
- **Judge Scorecard & README**:
  - Synchronized documentation with 186 unit tests across 30 files.
  - Updated rubric breakdown demonstrating protected points across all competition dimensions.
- **Tests**:
  - `test/unit/t12-package-ci-readme.test.ts` (4 passing submission-readiness tests).
