#!/usr/bin/env sh
echo "Starting VoltGroup local HTTP server on http://localhost:8000 ..."
cd "$(dirname "$0")/.." || exit 1
python3 -m http.server 8000 || python -m http.server 8000
