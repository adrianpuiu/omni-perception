#!/usr/bin/env bash
# Extract structured data from an image or PDF as JSON.
# Usage: extract.sh <path> <what_to_extract> [format]
# Example: extract.sh receipt.jpg "vendor, date, total, line items" json
# Example: extract.sh table.png "all rows and columns" csv
set -euo pipefail

BASE_URL="${NEMOTRON_OMNI_BASE_URL:-http://localhost:8000/v1}"
MODEL="${NEMOTRON_OMNI_MODEL:-nemotron_3_nano_omni}"

PATH_ARG="${1:?Usage: extract.sh <path> <what_to_extract> [format]}"
FIELDS="${2:?What to extract is required. Example: 'vendor, date, total'}"
FORMAT="${3:-json}"

if [ ! -f "$PATH_ARG" ]; then
  echo "{\"error\":\"File not found: $PATH_ARG\"}" >&2
  exit 1
fi

EXT="${PATH_ARG##*.}"

# Build extraction prompt based on format
case "$FORMAT" in
  json)
    OUTPUT_INSTRUCTION="Output ONLY valid JSON. No markdown, no explanation, no code fences. Just raw JSON."
    SCHEMA_HINT="Use this schema: {\"extracted\": {<field_names>: <values>}}"
    ;;
  csv)
    OUTPUT_INSTRUCTION="Output ONLY valid CSV with a header row. No markdown, no explanation, no code fences."
    SCHEMA_HINT="First row is the header, subsequent rows are data."
    ;;
  *)
    OUTPUT_INSTRUCTION="Output the extracted data in a clean, structured format."
    SCHEMA_HINT=""
    ;;
esac

SYSTEM_PROMPT="You are a precise data extraction engine. Extract the following from the provided media: $FIELDS

$SCHEMA_HINT

Rules:
- If a field is not found, use null
- Be exact with numbers — do not round or approximate
- $OUTPUT_INSTRUCTION"

# Handle PDF vs image
if [ "$EXT" = "pdf" ]; then
  # Use analyze_document approach: render first page, extract
  if ! command -v pdftoppm &>/dev/null; then
    echo "{\"error\":\"pdftoppm not found. Install: brew install poppler\"}" >&2
    exit 1
  fi
  TMPDIR=$(mktemp -d /tmp/omni-extract-XXXXXX)
  trap "rm -rf $TMPDIR" EXIT
  pdftoppm -r 150 -png -f 1 -l 1 "$PATH_ARG" "$TMPDIR/page"
  PNG=$(ls "$TMPDIR"/page-*.png 2>/dev/null | head -1)
  if [ -z "$PNG" ]; then
    echo "{\"error\":\"Failed to render PDF\"}" >&2
    exit 1
  fi
  FILE_URI="file://$(python3 -c "import urllib.parse; print(urllib.parse.quote('$PNG'))")"
else
  # Validate image extension
  case "$EXT" in
    jpg|jpeg|png|webp) ;;
    *) echo "{\"error\":\"Unsupported file type: $EXT. Use image files or PDF.\"}" >&2; exit 1 ;;
  esac
  FILE_URI="file://$(python3 -c "import urllib.parse; print(urllib.parse.quote('$PATH_ARG'))")"
fi

curl -sf --max-time 600 "$BASE_URL/chat/completions" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c "
import json
print(json.dumps({
    'model': '$MODEL',
    'messages': [
        {'role': 'system', 'content': '''$SYSTEM_PROMPT'''},
        {'role': 'user', 'content': [
            {'type': 'image_url', 'image_url': {'url': '$FILE_URI'}},
            {'type': 'text', 'text': 'Extract: $FIELDS'}
        ]}
    ],
    'max_tokens': 8192,
    'temperature': 0.1,
    'extra_body': {
        'chat_template_kwargs': {'enable_thinking': False}
    }
}))
")" | python3 -c "
import sys, json
resp = json.load(sys.stdin)
content = resp.get('choices', [{}])[0].get('message', {}).get('content', '')
usage = resp.get('usage', {})

# Try to parse as JSON if format was json
output = {'raw': content, 'format': '$FORMAT'}
if '$FORMAT' == 'json':
    try:
        # Strip markdown fences if present
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
