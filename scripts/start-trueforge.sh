#!/usr/bin/env bash
set -euo pipefail

# scripts/start-trueforge.sh
# Starts TrueForge server and reminds developer of connector settings

PORT=8790
MCP_PORT=8765

echo "=== Starting TrueForge Daemon on port $PORT ==="
echo "Note: The VS Code extension connects to TrueForge at http://localhost:$PORT"
echo "The extension MCP server listens at http://127.0.0.1:$MCP_PORT"
echo ""

# Launch TrueForge
npx @truefoundry/trueforge@latest --port "$PORT" || {
    echo "TrueForge launch exited. Ensure Node.js >= 20 is available."
}
