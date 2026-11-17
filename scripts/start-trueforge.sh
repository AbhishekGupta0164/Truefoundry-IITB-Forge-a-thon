#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-8790}"
MCP_PORT="${MCP_PORT:-8765}"
RESET_DB="${1:-}"

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

# Migration / State Repair:
# If user or judge passes --reset or --repair, or if database is corrupted from previous run
TRUEFORGE_DATA_DIR="${HOME}/.trueforge"
if [ "$RESET_DB" = "--reset" ] || [ "$RESET_DB" = "--repair" ]; then
  echo "[Repair] Resetting TrueForge local database migrations in $TRUEFORGE_DATA_DIR..."
  rm -rf "$TRUEFORGE_DATA_DIR/db.sqlite"* 2>/dev/null || true
  rm -rf "$TRUEFORGE_DATA_DIR/migrations.lock"* 2>/dev/null || true
  echo "[Repair] Migration state cleanly cleared."
fi

# Keep outbound URL security enabled
export NETWORK_POLICY_ENABLED=true

# Explicitly permit local Ollama and local model hosts
export OUTBOUND_URL_ALLOWED_HOSTS='["localhost","127.0.0.1"]'

echo "Allowed local model hosts: localhost, 127.0.0.1"
echo "TrueForge endpoint: http://localhost:$PORT"
echo "MCP server: http://127.0.0.1:$MCP_PORT"
echo "Run with '--repair' if encountering migration locks from older versions."
echo "Starting TrueForge..."

npx --yes @truefoundry/trueforge@0.184.3 --port "$PORT"
