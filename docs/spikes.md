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
