#!/usr/bin/env bash
# Transcribe audio using Nemotron Omni with locked ASR settings.
# Usage: transcribe.sh <path> [word_timestamps]
set -euo pipefail

BASE_URL="${NEMOTRON_OMNI_BASE_URL:-http://localhost:8000/v1}"
MODEL="${NEMOTRON_OMNI_MODEL:-nemotron_3_nano_omni}"

PATH_ARG="${1:?Usage: transcribe.sh <path> [word_timestamps]}"
WORD_TIMESTAMPS="${2:-false}"

if [ ! -f "$PATH_ARG" ]; then
  echo "{\"error\":\"File not found: $PATH_ARG\"}" >&2
  exit 1
fi

FILE_URI="file://$(python3 -c "import urllib.parse; print(urllib.parse.quote('$PATH_ARG'))")"

PROMPT="Transcribe this audio."
if [ "$WORD_TIMESTAMPS" = "true" ]; then
  PROMPT="$PROMPT Include word-level timestamps."
fi

curl -sf --max-time 600 "$BASE_URL/chat/completions" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c "
import json
print(json.dumps({
    'model': '$MODEL',
    'messages': [{
        'role': 'user',
        'content': [
            {'type': 'input_audio', 'input_audio': {'data': '$FILE_URI', 'format': 'url'}},
            {'type': 'text', 'text': '''$PROMPT'''}
        ]
    }],
    'max_tokens': 20480,
    'temperature': 0.2,
    'extra_body': {
        'top_k': 1,
        'chat_template_kwargs': {'enable_thinking': False}
    }
}))
")" | python3 -c "
import sys, json
resp = json.load(sys.stdin)
content = resp.get('choices', [{}])[0].get('message', {}).get('content', '')
usage = resp.get('usage', {})
print(json.dumps({
    'content': content,
    'prompt_tokens': usage.get('prompt_tokens', 0),
    'completion_tokens': usage.get('completion_tokens', 0)
}, indent=2))
"
