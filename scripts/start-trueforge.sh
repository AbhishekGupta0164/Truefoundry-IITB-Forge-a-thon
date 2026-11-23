#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-8790}"
MCP_PORT="${MCP_PORT:-8765}"
if [ "${1:-}" = "--repair" ]; then
  echo "ERROR: This launcher will not modify, move, or reset TrueForge data."
  echo "Resolve migration issues using TrueForge's supported recovery steps."
  exit 2
fi

echo "=========================================================="
echo " TrueForge Server Runner & Migration Health Check"
echo " Port:       $PORT"
echo " MCP Port:   $MCP_PORT"
echo "=========================================================="

# Check if port is already active
if command -v lsof >/dev/null 2>&1; then
  if lsof -i :"$PORT" >/dev/null 2>&1; then
    echo "[Notice] TrueForge is already running on port $PORT."
    exit 0
  fi
fi

# Keep outbound URL security enabled
export NETWORK_POLICY_ENABLED=true

# Explicitly permit local Ollama and local model hosts
export OUTBOUND_URL_ALLOWED_HOSTS='["localhost","127.0.0.1"]'

echo "Allowed local model hosts: localhost, 127.0.0.1"
echo "TrueForge endpoint: http://localhost:$PORT"
echo "MCP server: http://127.0.0.1:$MCP_PORT"
echo "This launcher does not alter TrueForge's stored data."
echo "Starting TrueForge..."

npx --yes @truefoundry/trueforge@0.184.3 --port "$PORT"
