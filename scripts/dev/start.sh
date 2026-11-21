#!/usr/bin/env bash
set -euo pipefail

# Scripts / Dev Entrypoint
# Pinned 7B-14B coding model for deterministic evaluation and local agent development

export TRUEFORGE_MODEL="${TRUEFORGE_MODEL:-qwen2.5-coder:14b}"
export TRUEFORGE_FALLBACK_MODEL="${TRUEFORGE_FALLBACK_MODEL:-qwen2.5-coder:7b}"
export TRUEFORGE_BASE_URL="${TRUEFORGE_BASE_URL:-http://localhost:8790}"

echo "=========================================================="
echo " Starting TrueForge Developer Environment"
echo " Primary Model:   $TRUEFORGE_MODEL"
echo " Fallback Model:  $TRUEFORGE_FALLBACK_MODEL"
echo " TrueForge URL:   $TRUEFORGE_BASE_URL"
echo "=========================================================="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT_DIR="$(dirname "$SCRIPT_DIR")"

"$PARENT_DIR/start-trueforge.sh"
