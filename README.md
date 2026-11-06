# TrueFoundry Forge-a-thon: Autonomous Coding Agent Extension

An autonomous coding agent VS Code extension built for the TrueFoundry IITB Forge-a-thon. The agent inspects codebases, gathers structured context, queries models through TrueForge proxying, and applies verified diff hunks while respecting strict budget and safety invariants.

---

## 1. Project Overview

This extension acts as an interactive bridge between developer workspaces and autonomous coding agents:
- **Safety First**: Prohibits arbitrary shell executions and unsupervised disk mutations.
- **Controlled Patching**: File changes are structured into discreet Hunks that require explicit verification and review.
- **Model Decoupling**: Offloads model hosting and key management to a dedicated TrueForge backend.
- **Standardized Communication**: Utilizes the Model Context Protocol (MCP) to supply codebase context.

---

## 2. Architecture & Directory Structure

```
Truefoundry/
├── Truefoundry-IITB-Forge-a-thon/          # Extension Root (open in VS Code)
│   ├── .cursor/rules/forge.mdc             # Cursor agent rules
│   ├── .github/workflows/ci.yml            # CI: build, typecheck, lint, test
│   ├── .vscode/                            # Launch & task configs
│   ├── AGENTS.md                           # AI agent invariants & guardrails
│   ├── agent-definition.json               # Agent capabilities & budget
│   ├── model.example.json                  # Sample model backend configuration
│   ├── src/
│   │   ├── extension.ts                    # Extension entrypoint
│   │   └── shared/                         # Shared team contracts
│   │       ├── constants.ts                # Ports & budget limits
│   │       ├── errors.ts                   # Standard error hierarchy
│   │       ├── events.ts                   # Streaming & lifecycle events
│   │       └── types.ts                    # Core TypeScript contracts
│   └── test/
│       └── unit/                           # Vitest unit test suite
│           └── basic.test.ts
└── flask/                                  # Testing Target (Pallets Flask at 22d92470)
```

---

## 3. Prerequisites

- **Node.js**: v20+ LTS (Tested on Node v26)
- **npm**: v10+
- **Python**: 3.9+ (for running target test suites)
- **Gitleaks**: v8.x (for secret scanning)
- **VS Code**: v1.90.0+

---

## 4. Installation & Setup

1. **Clone & install dependencies**:
   ```bash
   cd Truefoundry-IITB-Forge-a-thon
   npm install
   ```
2. **Build TypeScript source**:
   ```bash
   npm run build
   ```

---

## 5. Flask Testing Target Setup

The extension is validated against a local clone of [Pallets Flask](https://github.com/pallets/flask), pinned to commit `22d92470`:
```bash
cd ../flask
git checkout 22d92470
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
```

---

## 6. TrueForge & MCP Configuration

- **TrueForge Endpoint**: Default `http://127.0.0.1:8000/v1` (configured in `model.example.json`).
- **MCP Server**: Binds to `127.0.0.1:8765` (configured in `src/shared/constants.ts`).
- **Agent Specification**: Review limits and capabilities in `agent-definition.json`.

---

## 7. Development Commands

| Command | Description |
|---|---|
| `npm run build` | Compiles TypeScript source to `out/` |
| `npm run watch` | Watches and recompiles changes incrementally |
| `npm run typecheck` | Validates TypeScript types without emitting files |
| `npm run lint` | Runs ESLint over TypeScript source files |
| `npm run test:unit` | Executes unit test suite using Vitest |

---

## 8. Security & Safety Practices

All contributors and AI agents must strictly follow the invariants in `AGENTS.md`:
- **No Direct Model Calls**: Route exclusively through TrueForge.
- **Local MCP Only**: Bind strictly to `127.0.0.1`.
- **Restricted Writes**: File changes must pass through `apply_patch_hunk`.
- **Command Allowlist**: Only execute commands explicitly defined in `SECURITY_ALLOWLIST`.
- **Zero Secrets**: Run `gitleaks detect --source . --redact` before committing.

---

## 9. Team Contribution Workflow

1. Base all work on the shared contracts in `src/shared/`.
2. Do not modify shared interfaces without prior consensus and review.
3. Create feature branches off `main`:
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feat/your-feature
   ```
4. Ensure all checks pass prior to opening a Pull Request:
   ```bash
   npm run build && npm run typecheck && npm run lint && npm run test:unit
   gitleaks detect --source . --redact
   ```
5. Submit PR targeting `main` and request reviews from teammates.
