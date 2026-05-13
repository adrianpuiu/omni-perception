#!/usr/bin/env bash
# Verify a claim or previous analysis against source media.
# The "output guard" — re-examines media and checks every assertion.
# Usage: verify_output.sh <path> <claim> [strict] [media_type]
# Example: verify_output.sh scan.png "This is an invoice for $42.50 from Acme Corp"
# Example: verify_output.sh audio.wav "The speaker said deploy on Friday" false audio
set -euo pipefail

BASE_URL="${NEMOTRON_OMNI_BASE_URL:-http://localhost:8000/v1}"
MODEL="${NEMOTRON_OMNI_MODEL:-nemotron_3_nano_omni}"

PATH_ARG="${1:?Usage: verify_output.sh <path> <claim> [strict] [media_type]}"
CLAIM="${2:?Usage: verify_output.sh <path> <claim> [strict] [media_type]}"
STRICT="${3:-false}"
MEDIA_TYPE="${4:-auto}"

if [ ! -f "$PATH_ARG" ]; then
  echo "{\"error\":\"File not found: $PATH_ARG\"}" >&2
  exit 1
fi

# Auto-detect media type
if [ "$MEDIA_TYPE" = "auto" ]; then
  EXT="${PATH_ARG##*.}"
  case "$EXT" in
    jpg|jpeg|png|webp) MEDIA_TYPE="image" ;;
    mp4) MEDIA_TYPE="video" ;;
    wav|mp3) MEDIA_TYPE="audio" ;;
    pdf) MEDIA_TYPE="document" ;;
    *) echo "{\"error\":\"Unsupported file type: $EXT\"}" >&2; exit 1 ;;
  esac
fi

# For PDFs, render first page to image
ACTUAL_TYPE="$MEDIA_TYPE"
if [ "$MEDIA_TYPE" = "document" ]; then
  if ! command -v pdftoppm &>/dev/null; then
    echo "{\"error\":\"pdftoppm not found. Install: brew install poppler\"}" >&2
    exit 1
  fi
  TMPDIR=$(mktemp -d /tmp/omni-verify-XXXXXX)
  trap "rm -rf $TMPDIR" EXIT
  pdftoppm -r 150 -png -l 1 "$PATH_ARG" "$TMPDIR/page"
  IMG_PATH=$(ls "$TMPDIR"/page*.png | head -1)
  FILE_URI="file://$(python3 -c "import urllib.parse; print(urllib.parse.quote('$IMG_PATH'))")"
  ACTUAL_TYPE="image"
else
  FILE_URI="file://$(python3 -c "import urllib.parse; print(urllib.parse.quote('$PATH_ARG'))")"
fi

STRICT_INSTRUCTION=""
if [ "$STRICT" = "true" ]; then
  STRICT_INSTRUCTION="STRICT MODE: Flag ANY approximation, rounding, inference, or guess as CORRECTED."
fi

echo "Verifying claim against $ACTUAL_TYPE..." >&2

curl -sf --max-time 300 "$BASE_URL/chat/completions" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c "
import json

media_type = '$ACTUAL_TYPE'
file_uri = '$FILE_URI'
claim = '''$(echo "$CLAIM" | python3 -c "import sys; print(sys.stdin.read())")'''
strict = '''$STRICT_INSTRUCTION'''

content_parts = []
if media_type == 'image':
    content_parts.append({'type': 'image_url', 'image_url': {'url': file_uri}})
elif media_type == 'video':
    content_parts.append({'type': 'video_url', 'video_url': {'url': file_uri}})
elif media_type == 'audio':
    content_parts.append({'type': 'input_audio', 'input_audio': {'data': file_uri, 'format': 'url'}})

content_parts.append({
    'type': 'text',
    'text': f'''You are a verification engine. You will be shown media and a claim about it.
Your job is to independently examine the media and verify EVERY assertion in the claim.

For each assertion in the claim:
1. Check it against the media directly
2. Mark it as: VERIFIED, CORRECTED (with the right value), or HALLUCINATION

{strict}
Claim to verify:
---
{claim}
---

Output ONLY valid JSON:
{{
  \"verified_facts\": [\"fact that was confirmed correct\"],
  \"corrections\": [{{\"original\": \"what was claimed\", \"correct\": \"what it actually is\", \"severity\": \"minor|major\"}}],
  \"hallucinations\": [\"claims that have no basis in the media\"],
  \"missing_details\": [\"important things in the media that the claim missed\"],
  \"overall_accuracy\": 0.0,
  \"confidence\": 0.0,
  \"summary\": \"one sentence verdict\"
}}'''
})

extra_body = {'chat_template_kwargs': {'enable_thinking': True}}
if media_type == 'video':
    extra_body['mm_processor_kwargs'] = {'use_audio_in_video': True}

print(json.dumps({
    'model': '$MODEL',
    'messages': [{'role': 'user', 'content': content_parts}],
    'max_tokens': 4096,
    'extra_body': extra_body
}))
")" | python3 -c "
import sys, json

resp = json.load(sys.stdin)
content = resp.get('choices', [{}])[0].get('message', {}).get('content', '').strip()

# Strip think tags
final = content
idx = final.find('</think')
if idx != -1:
    close = final.find('>', idx)
    if close != -1:
        final = final[close+1:].strip()

# Try to parse verification JSON
try:
    cleaned = final
    if cleaned.startswith('\`\`\`'):
        cleaned = cleaned.split('\n', 1)[1] if '\n' in cleaned else cleaned[3:]
        if cleaned.endswith('\`\`\`'):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()
    verification = json.loads(cleaned)
    print(json.dumps({'verification': verification}, indent=2))
except:
    print(json.dumps({'raw': final, 'parse_warning': 'Model did not return valid JSON'}, indent=2))
"
