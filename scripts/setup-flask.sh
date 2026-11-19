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
# Flask 3.1.3 pins pytest 8.4.2 in uv.lock; pytest 9 removed _pytest.monkeypatch.notset,
# which tests/test_cli.py imports, so an unpinned pytest breaks the Task B check.
pip install -e . "pytest==8.4.2" python-dotenv asgiref

echo "Running baseline checks..."
pytest tests/test_cli.py -q
FLASK_DEBUG=off python -c "from flask.helpers import get_debug_flag; print('Task A baseline (stock Flask prints True):', get_debug_flag())"

echo "=== Flask setup complete ==="
