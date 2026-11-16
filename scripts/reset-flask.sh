#!/usr/bin/env bash
set -euo pipefail

# scripts/reset-flask.sh
# Safely resets the dedicated Flask test repository clone between Task B runs.
# Enforces strict safety checks to prevent running against the TrueForge repository.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

# Search candidates for the Flask clone
POSSIBLE_PATHS=(
    "${FLASK_DIR:-}"
    "$REPO_ROOT/../Flask"
    "$REPO_ROOT/../flask"
    "/tmp/flask"
)

TARGET_FLASK=""
for candidate in "${POSSIBLE_PATHS[@]}"; do
    if [ -n "$candidate" ] && [ -d "$candidate/.git" ]; then
        TARGET_FLASK="$(cd "$candidate" && pwd)"
        break
    fi
done

if [ -z "$TARGET_FLASK" ]; then
    echo "ERROR: Flask clone directory not found."
    echo "Set FLASK_DIR environment variable or ensure ../Flask exists."
    exit 1
fi

# SAFETY CHECK 1: Must NOT be the TrueForge extension repository
if [ "$TARGET_FLASK" = "$REPO_ROOT" ]; then
    echo "FATAL ERROR: Target directory is the TrueForge repository itself! Refusing to reset."
    exit 1
fi

# SAFETY CHECK 2: Confirm target repository is pallets/flask
cd "$TARGET_FLASK"
REMOTE_URL="$(git remote get-url origin 2>/dev/null || echo "")"
if [[ "$REMOTE_URL" != *"flask"* ]] && [ ! -f "src/flask/app.py" ]; then
    echo "FATAL ERROR: $TARGET_FLASK does not appear to be the Flask repository. Refusing to run git clean."
    exit 1
fi

echo "=== Resetting Flask test repository ==="
echo "Target path: $TARGET_FLASK"

# Check out pristine commit
echo "Reverting modified tracked files..."
git checkout -- .

echo "Removing untracked files and directories..."
git clean -fd

echo "Verifying clean working tree..."
STATUS="$(git status --porcelain)"
if [ -z "$STATUS" ]; then
    echo "✓ Flask working tree is completely clean at commit $(git rev-parse --short HEAD)"
else
    echo "WARNING: Git status not completely clean:"
    echo "$STATUS"
fi

echo "=== Flask reset complete ==="
