#!/usr/bin/env bash
# Analyze audio content using Nemotron Omni.
# Usage: analyze_audio.sh <path> <prompt> [thinking] [max_tokens]
set -euo pipefail

BASE_URL="${NEMOTRON_OMNI_BASE_URL:-http://localhost:8000/v1}"
MODEL="${NEMOTRON_OMNI_MODEL:-nemotron_3_nano_omni}"

PATH_ARG="${1:?Usage: analyze_audio.sh <path> <prompt> [thinking] [max_tokens]}"
PROMPT="${2:?Prompt is required}"
THINKING="${3:-false}"
MAX_TOKENS="${4:-20480}"

# Validate file
if [ ! -f "$PATH_ARG" ]; then
  echo "{\"error\":\"File not found: $PATH_ARG\"}" >&2
  exit 1
fi

EXT="${PATH_ARG##*.}"
case "$EXT" in
  wav|mp3) ;;
  *) echo "{\"error\":\"Unsupported audio extension: $EXT. Allowed: wav, mp3\"}" >&2; exit 1 ;;
esac

FILE_URI="file://$(python3 -c "import urllib.parse; print(urllib.parse.quote('$PATH_ARG'))")"

if [ "$THINKING" = "true" ]; then
  TEMP=0.6
  CHAT_TEMPLATE='{"enable_thinking":true}'
else
  TEMP=0.2
  CHAT_TEMPLATE='{"enable_thinking":false}'
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
    'max_tokens': $MAX_TOKENS,
    'temperature': $TEMP,
    'extra_body': {
        'chat_template_kwargs': $CHAT_TEMPLATE
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
