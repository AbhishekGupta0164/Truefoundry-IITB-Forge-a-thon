#!/usr/bin/env bash
set -euo pipefail

# scripts/setup-flask.sh
# Sets up the sibling Flask repository for testing target verification

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT_DIR="$(dirname "$SCRIPT_DIR")"
FLASK_DIR="$PARENT_DIR/../flask"

echo "=== Setting up Flask testing repository ==="
if [ ! -d "$FLASK_DIR" ]; then
    echo "Cloning Flask to $FLASK_DIR..."
    git clone https://github.com/pallets/flask.git "$FLASK_DIR"
fi

cd "$FLASK_DIR"
echo "Checking out commit 22d92470..."
git checkout 22d92470

if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv
fi

echo "Activating virtualenv and installing dependencies..."
source .venv/bin/activate
pip install --upgrade pip
pip install -e . pytest

echo "Running baseline pytest..."
pytest tests/test_basic.py || echo "Baseline test run completed"

echo "=== Flask setup complete ==="
