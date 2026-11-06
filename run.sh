#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

echo "============================================================"
echo "        Starting AutoClipDaemon Clipping Engine"
echo "============================================================"

if [ -f "venv/bin/python" ]; then
    PYTHON_EXE="venv/bin/python"
    echo "[OK] Using virtual environment: ./venv"
else
    PYTHON_EXE="python3"
    echo "[WARN] Virtual environment not found, using system python3."
fi

echo "[OK] Running pre-flight system diagnostics..."
"$PYTHON_EXE" scripts/healthcheck.py || true

echo "[OK] Launching AutoClipDaemon..."
echo "Web UI: http://localhost:8080"
exec "$PYTHON_EXE" main.py

