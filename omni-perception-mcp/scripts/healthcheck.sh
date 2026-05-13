#!/usr/bin/env bash
# Health check for vLLM server
set -euo pipefail

PORT="${PORT:-8000}"

if curl -sf "http://localhost:$PORT/v1/models" >/dev/null; then
  echo "vLLM healthy on :$PORT"
  curl -s "http://localhost:$PORT/v1/models" | python3 -m json.tool
  exit 0
else
  echo "vLLM not responding on :$PORT" >&2
  exit 1
fi
