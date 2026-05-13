#!/usr/bin/env bash
# Check if the Nemotron Omni vLLM server is healthy.
set -euo pipefail

BASE_URL="${NEMOTRON_OMNI_BASE_URL:-http://localhost:8000/v1}"

start=$(python3 -c "import time; print(int(time.time()*1000))")

resp=$(curl -sf --max-time 2 "$BASE_URL/models" 2>/dev/null) || {
  echo "{\"healthy\":false,\"base_url\":\"$BASE_URL\",\"error\":\"Connection failed\"}"
  exit 0
}

end=$(python3 -c "import time; print(int(time.time()*1000))")
model=$(echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',[{}])[0].get('id','unknown'))" 2>/dev/null || echo "unknown")

echo "{\"healthy\":true,\"model\":\"$model\",\"base_url\":\"$BASE_URL\",\"response_time_ms\":$((end - start))}"
