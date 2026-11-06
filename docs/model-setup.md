# Model Setup & Switching in TrueForge

## Configuring Backend Models
TrueForge abstracts model provider configurations behind its local proxy daemon:

1. **Local Ollama / Llama.cpp**:
   - Endpoint: `http://localhost:11434/v1`
   - Model: e.g. `deepseek-coder:6.7b` or `qwen2.5-coder:7b`
2. **OpenAI / Claude / Gemini (via TrueForge)**:
   - Configure credentials within TrueForge server configuration (`~/.trueforge/config.json`).
   - The VS Code extension does **not** store or manage API keys.

## Switching Models
Update `agent-definition.json` or select model via the TrueForge web dashboard. The extension automatically tracks token consumption against budget limits regardless of backend provider.
