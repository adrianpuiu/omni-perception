#!/usr/bin/env bash
# Compare two images and describe the differences.
# Usage: compare.sh <image1> <image2> <prompt>
# Example: compare.sh before.png after.png "What changed in the UI?"
# Example: compare.sh photo1.jpg photo2.jpg "List all visual differences"
set -euo pipefail

BASE_URL="${NEMOTRON_OMNI_BASE_URL:-http://localhost:8000/v1}"
MODEL="${NEMOTRON_OMNI_MODEL:-nemotron_3_nano_omni}"

IMAGE1="${1:?Usage: compare.sh <image1> <image2> <prompt>}"
IMAGE2="${2:?Second image path is required}"
PROMPT="${3:-What are the differences between these two images? List every change you can find.}"

# Validate both files
for img in "$IMAGE1" "$IMAGE2"; do
  if [ ! -f "$img" ]; then
    echo "{\"error\":\"File not found: $img\"}" >&2
    exit 1
  fi
  EXT="${img##*.}"
  case "$EXT" in
    jpg|jpeg|png|webp) ;;
    *) echo "{\"error\":\"Unsupported image extension: $EXT. Allowed: jpg, jpeg, png, webp\"}" >&2; exit 1 ;;
  esac
done

URI1="file://$(python3 -c "import urllib.parse; print(urllib.parse.quote('$IMAGE1'))")"
URI2="file://$(python3 -c "import urllib.parse; print(urllib.parse.quote('$IMAGE2'))")"

curl -sf --max-time 600 "$BASE_URL/chat/completions" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c "
import json
print(json.dumps({
    'model': '$MODEL',
    'messages': [{
        'role': 'user',
        'content': [
            {'type': 'text', 'text': 'I am showing you two images. The first image (Image A) and the second image (Image B).'},
            {'type': 'image_url', 'image_url': {'url': '$URI1'}},
            {'type': 'text', 'text': 'Above is Image A. Below is Image B.'},
            {'type': 'image_url', 'image_url': {'url': '$URI2'}},
            {'type': 'text', 'text': '''$PROMPT'''}
        ]
    }],
    'max_tokens': 20480,
    'temperature': 0.6,
    'extra_body': {
        'chat_template_kwargs': {'enable_thinking': True}
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
