# Model Setup & Switching in TrueForge

## Configuring Backend Models
TrueForge abstracts model provider configurations behind its local proxy daemon:

1. **Local Ollama / Llama.cpp**:
   - Endpoint: `http://localhost:11434/v1`
   - Model: e.g. `deepseek-coder:6.7b` or `qwen2.5-coder:7b`
2. **OpenAI / Gemini / other hosted providers (via TrueForge)**:
   - Configure credentials within TrueForge server configuration (`~/.trueforge/config.json`).
   - The VS Code extension does **not** store or manage API keys.

## Switching Models
Update `agent-definition.json` or select model via the TrueForge web dashboard. The extension automatically tracks token consumption against budget limits regardless of backend provider.

## Primary and fallback model (Task C)

Set two different TrueForge models in VS Code settings:

| Setting | Value |
| --- | --- |
| `forge.model` | primary, e.g. a hosted coding model, written as `provider/model` exactly as TrueForge lists it |
| `forge.fallbackModel` | a second model on a different provider, e.g. `ollama/llama-3-2-3b` |

Both names must be `provider/model`; a bare name such as `qwen2.5-coder:7b` is rejected up front with a clear message instead of a 422 from TrueForge.

When a run on the primary model fails before the agent makes any tool call (unreachable endpoint, invalid key, provider error), the extension starts a new TrueForge session on the fallback model and replays the same request with no user action. A warning names both models and the reason, and the agent panel prints the switch in its stream. Nothing has been staged or written at that point, so `git status` stays clean.

The fallback does not run after the agent has already made tool calls, after a cancel, or after the loop guard stops a run; those are reported as they are. Leave `forge.fallbackModel` empty to disable it.
