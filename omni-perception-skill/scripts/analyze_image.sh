#!/usr/bin/env bash
# Analyze an image using Nemotron Omni.
# Usage: analyze_image.sh <path> <prompt> [thinking] [max_tokens]
set -euo pipefail

BASE_URL="${NEMOTRON_OMNI_BASE_URL:-http://localhost:8000/v1}"
MODEL="${NEMOTRON_OMNI_MODEL:-nemotron_3_nano_omni}"

PATH_ARG="${1:?Usage: analyze_image.sh <path> <prompt> [thinking] [max_tokens]}"
PROMPT="${2:?Prompt is required}"
THINKING="${3:-true}"
MAX_TOKENS="${4:-20480}"

# Validate file
if [ ! -f "$PATH_ARG" ]; then
  echo "{\"error\":\"File not found: $PATH_ARG\"}" >&2
  exit 1
fi

EXT="${PATH_ARG##*.}"
case "$EXT" in
  jpg|jpeg|png|webp) ;;
  *) echo "{\"error\":\"Unsupported image extension: $EXT. Allowed: jpg, jpeg, png, webp\"}" >&2; exit 1 ;;
esac

# Build file:// URI
FILE_URI="file://$(python3 -c "import urllib.parse; print(urllib.parse.quote('$PATH_ARG'))")"

# Set reasoning params
if [ "$THINKING" = "true" ]; then
  TEMP=0.6
  TOP_P=0.95
  CHAT_TEMPLATE='{"enable_thinking":true}'
else
  TEMP=0.2
  TOP_P=1.0
  CHAT_TEMPLATE='{"enable_thinking":false}'
fi

# Call vLLM
curl -sf --max-time 600 "$BASE_URL/chat/completions" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c "
import json
print(json.dumps({
    'model': '$MODEL',
    'messages': [{
        'role': 'user',
        'content': [
            {'type': 'image_url', 'image_url': {'url': '$FILE_URI'}},
            {'type': 'text', 'text': '''$PROMPT'''}
        ]
    }],
    'max_tokens': $MAX_TOKENS,
    'temperature': $TEMP,
    'top_p': $TOP_P,
    'extra_body': {
        'chat_template_kwargs': $CHAT_TEMPLATE
    }
}))
")" | python3 -c "
import sys, json
resp = json.load(sys.stdin)
content = resp.get('choices', [{}])[0].get('message', {}).get('content', '')
raw = content
reasoning = ''
final = raw

idx = raw.find('</think')
if idx != -1:
    close_end = raw.find('>', idx)
    if close_end != -1:
        think_part = raw[:idx]
        open_idx = think_part.find('<think')
        if open_idx != -1:
            open_end = think_part.find('>', open_idx)
            if open_end != -1:
                reasoning = think_part[open_end+1:].strip()
        final = raw[close_end+1:].strip()

usage = resp.get('usage', {})
print(json.dumps({
    'content': final,
    'reasoning_content': reasoning,
    'prompt_tokens': usage.get('prompt_tokens', 0),
    'completion_tokens': usage.get('completion_tokens', 0)
}, indent=2))
"
