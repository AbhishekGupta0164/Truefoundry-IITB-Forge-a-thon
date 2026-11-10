#!/usr/bin/env bash
set -euo pipefail

PORT=8790
MCP_PORT=8765

echo "=== Starting TrueForge on port $PORT ==="

# Keep outbound URL security enabled.
export NETWORK_POLICY_ENABLED=true

# Explicitly permit local Ollama connections.
export OUTBOUND_URL_ALLOWED_HOSTS='["localhost","127.0.0.1"]'

echo "Allowed local model hosts: localhost, 127.0.0.1"
echo "TrueForge: http://localhost:$PORT"
echo "MCP: http://127.0.0.1:$MCP_PORT"

npx @truefoundry/trueforge@latest --port "$PORT"
