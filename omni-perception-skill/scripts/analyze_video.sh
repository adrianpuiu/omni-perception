#!/usr/bin/env bash
# Analyze video using Nemotron Omni.
# Usage: analyze_video.sh <path> <prompt> [with_audio] [thinking] [max_tokens]
set -euo pipefail

BASE_URL="${NEMOTRON_OMNI_BASE_URL:-http://localhost:8000/v1}"
MODEL="${NEMOTRON_OMNI_MODEL:-nemotron_3_nano_omni}"

PATH_ARG="${1:?Usage: analyze_video.sh <path> <prompt> [with_audio] [thinking] [max_tokens]}"
PROMPT="${2:?Prompt is required}"
WITH_AUDIO="${3:-true}"
THINKING="${4:-false}"
MAX_TOKENS="${5:-20480}"

if [ ! -f "$PATH_ARG" ]; then
  echo "{\"error\":\"File not found: $PATH_ARG\"}" >&2
  exit 1
fi

EXT="${PATH_ARG##*.}"
if [ "$EXT" != "mp4" ]; then
  echo "{\"error\":\"Unsupported video extension: $EXT. Only mp4 is supported.\"}" >&2
  exit 1
fi

FILE_URI="file://$(python3 -c "import urllib.parse; print(urllib.parse.quote('$PATH_ARG'))")"

# Build mm_processor_kwargs
MM_KWARGS="{}"
if [ "$WITH_AUDIO" = "true" ]; then
  MM_KWARGS='{"use_audio_in_video":true}'
fi

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
            {'type': 'video_url', 'video_url': {'url': '$FILE_URI'}},
            {'type': 'text', 'text': '''$PROMPT'''}
        ]
    }],
    'max_tokens': $MAX_TOKENS,
    'temperature': $TEMP,
    'extra_body': {
        'mm_processor_kwargs': $MM_KWARGS,
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
