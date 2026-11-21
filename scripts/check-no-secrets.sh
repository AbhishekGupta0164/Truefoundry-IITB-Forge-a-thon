#!/usr/bin/env bash
set -euo pipefail

# scripts/check-no-secrets.sh
# Validates workspace against committed keys, secrets, and credentials

echo "=== Running secret checks ==="

# 1. Check for common secret file patterns
FORBIDDEN_FILES=$(find . -maxdepth 3 -type f \( -name ".env*" ! -name ".env.example" -o -name "*.key" -o -name "*.pem" -o -name ".forge-secrets*" \) 2>/dev/null || true)
if [ -n "$FORBIDDEN_FILES" ]; then
    echo "ERROR: Forbidden secret files found:"
    echo "$FORBIDDEN_FILES"
    exit 1
fi

# 2. Run Gitleaks if available
if command -v gitleaks &> /dev/null; then
    echo "Running gitleaks detect..."
    gitleaks detect --source . --redact --no-git
    echo "Gitleaks scan passed."
else
    echo "Gitleaks not installed; skipping binary check."
fi

echo "=== All secret checks passed cleanly ==="
