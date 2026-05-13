#!/usr/bin/env bash
# Serve Nemotron 3 Nano Omni NVFP4 via vLLM.
# Designed for NVIDIA DGX Spark (Linux ARM64 + GPU).
# On macOS: use --download-only to fetch weights, then transfer to Spark.
set -euo pipefail

WEIGHTS="${WEIGHTS:-$HOME/models/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-NVFP4}"
PORT="${PORT:-8000}"
NAME="${NAME:-vllm-nemotron-omni}"

# ─── Platform detection ──────────────────────────────────────────────────
OS="$(uname -s)"
ARCH="$(uname -m)"
DOWNLOAD_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --download-only) DOWNLOAD_ONLY=true ;;
    --help|-h)
      echo "Usage: $0 [--download-only]"
      echo ""
      echo "  --download-only  Only download model weights, don't start vLLM."
      echo "                   Use this on macOS to fetch weights for transfer to Spark."
      echo ""
      echo "Environment variables:"
      echo "  WEIGHTS  Local path for model weights (default: ~/models/Nemotron-...-NVFP4)"
      echo "  PORT     vLLM server port (default: 8000)"
      echo "  NAME     Docker container name (default: vllm-nemotron-omni)"
      exit 0
      ;;
  esac
done

# ─── Download weights ────────────────────────────────────────────────────
if [ ! -d "$WEIGHTS" ]; then
  echo "Downloading weights to $WEIGHTS..."
  pip install -q -U "huggingface_hub[hf_xet]"
  
  # Use new `hf` CLI (huggingface-cli is deprecated)
  if command -v hf &>/dev/null; then
    hf download nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-NVFP4 \
      --local-dir "$WEIGHTS" --max-workers 8
  else
    # Fallback to python API
    python3 -c "
from huggingface_hub import snapshot_download
snapshot_download(
    'nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-NVFP4',
    local_dir='$WEIGHTS',
    max_workers=8,
)
"
  fi
  echo "Weights downloaded to $WEIGHTS"
else
  echo "Weights already present at $WEIGHTS"
fi

if [ "$DOWNLOAD_ONLY" = true ]; then
  echo "Download complete. Transfer $WEIGHTS to your DGX Spark and run this script there."
  exit 0
fi

# ─── Start vLLM ───────────────────────────────────────────────────────────
if [ "$OS" = "Darwin" ]; then
  echo ""
  echo "⚠️  macOS detected (no NVIDIA GPU). vLLM with GPU requires Linux + NVIDIA hardware."
  echo ""
  echo "Options:"
  echo "  1. Run on your DGX Spark (recommended):"
  echo "     rsync -avz $WEIGHTS spark-host:$WEIGHTS"
  echo "     ssh spark-host 'cd /path/to/omni-perception-mcp && ./scripts/serve.sh'"
  echo ""
  echo "  2. Connect to a remote vLLM already running on Spark:"
  echo "     export NEMOTRON_OMNI_BASE_URL=http://spark-host:8000/v1"
  echo "     pnpm start"
  echo ""
  echo "  3. Download-only mode for weight transfer:"
  echo "     ./scripts/serve.sh --download-only"
  exit 1
fi

# Check for NVIDIA GPU
if ! command -v nvidia-smi &>/dev/null; then
  echo "ERROR: nvidia-smi not found. NVIDIA GPU required." >&2
  exit 1
fi

# Check for Docker
if ! command -v docker &>/dev/null; then
  echo "ERROR: docker not found. Install Docker first." >&2
  exit 1
fi

docker pull vllm/vllm-openai:v0.20.0

docker run --rm -d \
  --gpus all \
  --ipc=host -p "$PORT":8000 \
  --shm-size=16g \
  --name "$NAME" \
  -v "${WEIGHTS}:/model:ro" \
  --entrypoint /bin/bash \
  vllm/vllm-openai:v0.20.0 -c \
  "pip install vllm[audio] && vllm serve /model \
    --served-model-name=nemotron_3_nano_omni \
    --max-num-seqs 8 \
    --max-model-len 131072 \
    --port 8000 \
    --trust-remote-code \
    --gpu-memory-utilization 0.8 \
    --limit-mm-per-prompt '{\"video\": 1, \"image\": 1, \"audio\": 1}' \
    --media-io-kwargs '{\"video\": {\"fps\": 2, \"num_frames\": 256}}' \
    --allowed-local-media-path=/ \
    --enable-prefix-caching \
    --max-num-batched-tokens 32768 \
    --reasoning-parser nemotron_v3 \
    --enable-auto-tool-choice \
    --tool-call-parser qwen3_coder"

echo "vLLM starting... checking health"
for i in {1..60}; do
  if curl -sf http://localhost:"$PORT"/v1/models >/dev/null; then
    echo "✅ vLLM ready on :$PORT"
    exit 0
  fi
  sleep 5
done
echo "vLLM did not become healthy within 5 min" >&2
exit 1
