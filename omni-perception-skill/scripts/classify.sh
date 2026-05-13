#!/usr/bin/env bash
# Classify/categorize media content.
# Usage: classify.sh <path> [categories] [output_format]
# Example: classify.sh photo.jpg "landscape,portrait,food,product,other"
# Example: classify.sh document.pdf "contract,invoice,letter,report,receipt"
# Example: classify.sh audio.wav "speech,music,podcast,noise" json
set -euo pipefail

BASE_URL="${NEMOTRON_OMNI_BASE_URL:-http://localhost:8000/v1}"
MODEL="${NEMOTRON_OMNI_MODEL:-nemotron_3_nano_omni}"

PATH_ARG="${1:?Usage: classify.sh <path> [categories] [output_format]}"
CATEGORIES="${2:-}"
OUTPUT_FORMAT="${3:-json}"

if [ ! -f "$PATH_ARG" ]; then
  echo "{\"error\":\"File not found: $PATH_ARG\"}" >&2
  exit 1
fi

EXT="${PATH_ARG##*.}"
FILE_URI="file://$(python3 -c "import urllib.parse; print(urllib.parse.quote('$PATH_ARG'))")"

# Build media part based on type
case "$EXT" in
  jpg|jpeg|png|webp)
    MEDIA_TYPE="image"
    MEDIA_PART="{\"type\": \"image_url\", \"image_url\": {\"url\": \"$FILE_URI\"}}"
    ;;
  mp4)
    MEDIA_TYPE="video"
    MEDIA_PART="{\"type\": \"video_url\", \"video_url\": {\"url\": \"$FILE_URI\"}}"
    EXTRA_BODY='{"mm_processor_kwargs": {"use_audio_in_video": true}, "chat_template_kwargs": {"enable_thinking": false}}'
    ;;
  wav|mp3)
    MEDIA_TYPE="audio"
    MEDIA_PART="{\"type\": \"input_audio\", \"input_audio\": {\"data\": \"$FILE_URI\", \"format\": \"url\"}}"
    ;;
  pdf)
    MEDIA_TYPE="document"
    # Render first page
    if ! command -v pdftoppm &>/dev/null; then
      echo "{\"error\":\"pdftoppm not found. Install: brew install poppler\"}" >&2
      exit 1
    fi
    TMPDIR=$(mktemp -d /tmp/omni-classify-XXXXXX)
    trap "rm -rf $TMPDIR" EXIT
    pdftoppm -r 150 -png -f 1 -l 1 "$PATH_ARG" "$TMPDIR/page"
    PNG=$(ls "$TMPDIR"/page-*.png 2>/dev/null | head -1)
    if [ -z "$PNG" ]; then
      echo "{\"error\":\"Failed to render PDF\"}" >&2
      exit 1
    fi
    FILE_URI="file://$(python3 -c "import urllib.parse; print(urllib.parse.quote('$PNG'))")"
    MEDIA_PART="{\"type\": \"image_url\", \"image_url\": {\"url\": \"$FILE_URI\"}}"
    ;;
  *)
    echo "{\"error\":\"Unsupported file type: $EXT\"}" >&2
    exit 1
    ;;
esac

# Build classification prompt
if [ -n "$CATEGORIES" ]; then
  CAT_LIST=$(echo "$CATEGORIES" | tr ',' '\n' | sed 's/^ *//;s/ *$//' | grep -v '^$')
  CAT_ENUMERATED=$(echo "$CAT_LIST" | cat -n | sed 's/^[[:space:]]*\([0-9]*\)[[:space:]]*/\1. /')
  PROMPT="Classify this $MEDIA_TYPE into exactly ONE of these categories:
$CAT_ENUMERATED

Also provide:
- A confidence score from 0.0 to 1.0
- A one-line reason for the classification

$(
  case "$OUTPUT_FORMAT" in
    json) echo 'Output ONLY valid JSON: {"category": "...", "confidence": 0.0, "reason": "..."}' ;;
    text) echo 'Output: CATEGORY (confidence: 0.0) - reason' ;;
    *) echo 'Output the category name, confidence, and reason.' ;;
  esac
)"
else
  PROMPT="Analyze this $MEDIA_TYPE and classify it.

Provide:
1. Primary category (what type of content is this?)
2. Sub-categories (more specific tags)
3. Content flags (e.g., contains_text, contains_people, contains_charts, is_screenshot, has_code)
4. A one-sentence summary

$(
  case "$OUTPUT_FORMAT" in
    json) echo 'Output ONLY valid JSON: {"category": "...", "sub_categories": [...], "flags": [...], "summary": "..."}' ;;
    text) echo 'Output a clean classification with labels.' ;;
    *) echo 'Provide structured classification.' ;;
  esac
)"
fi

EXTRA_BODY="${EXTRA_BODY:-'{\"chat_template_kwargs\": {\"enable_thinking\": false}}'}"

curl -sf --max-time 300 "$BASE_URL/chat/completions" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c "
import json
print(json.dumps({
    'model': '$MODEL',
    'messages': [
        {'role': 'system', 'content': 'You are a content classification engine. Be precise and concise.'},
        {'role': 'user', 'content': [
            $MEDIA_PART,
            {'type': 'text', 'text': '''$PROMPT'''}
        ]}
    ],
    'max_tokens': 1024,
    'temperature': 0.1,
    'extra_body': $EXTRA_BODY
}))
")" | python3 -c "
import sys, json
resp = json.load(sys.stdin)
content = resp.get('choices', [{}])[0].get('message', {}).get('content', '')
usage = resp.get('usage', {})

output = {'raw': content, 'media_type': '$MEDIA_TYPE', 'format': '$OUTPUT_FORMAT'}

# Try to parse as JSON
if '$OUTPUT_FORMAT' == 'json':
    try:
        cleaned = content.strip()
        if cleaned.startswith('\`\`\`'):
            cleaned = '\n'.join(cleaned.split('\n')[1:])
            if cleaned.endswith('\`\`\`'):
                cleaned = cleaned[:-3]
            cleaned = cleaned.strip()
        output['data'] = json.loads(cleaned)
    except:
        output['data'] = None
        output['parse_warning'] = 'Model did not return valid JSON'

output['prompt_tokens'] = usage.get('prompt_tokens', 0)
output['completion_tokens'] = usage.get('completion_tokens', 0)
print(json.dumps(output, indent=2))
"
