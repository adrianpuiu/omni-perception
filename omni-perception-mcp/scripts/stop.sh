#!/usr/bin/env bash
# Stop the vLLM container
set -euo pipefail

NAME="${NAME:-vllm-nemotron-omni}"

if docker ps -q -f name="$NAME" | grep -q .; then
  docker stop "$NAME"
  echo "Stopped $NAME"
else
  echo "Container $NAME is not running"
fi
