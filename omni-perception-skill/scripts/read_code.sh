#!/usr/bin/env bash
# Read code from a screenshot and output clean, copy-pasteable text.
# Usage: read_code.sh <path> [language_hint]
# Example: read_code.sh screenshot.png python
# Example: read_code.sh stacktrace.jpg
# Example: read_code.sh config.png yaml
set -euo pipefail

BASE_URL="${NEMOTRON_OMNI_BASE_URL:-http://localhost:8000/v1}"
MODEL="${NEMOTRON_OMNI_MODEL:-nemotron_3_nano_omni}"

PATH_ARG="${1:?Usage: read_code.sh <path> [language_hint]}"
LANG_HINT="${2:-}"

if [ ! -f "$PATH_ARG" ]; then
  echo "{\"error\":\"File not found: $PATH_ARG\"}" >&2
  exit 1
fi

EXT="${PATH_ARG##*.}"
case "$EXT" in
  jpg|jpeg|png|webp) ;;
  *) echo "{\"error\":\"Unsupported image extension: $EXT. Allowed: jpg, jpeg, png, webp\"}" >&2; exit 1 ;;
esac

FILE_URI="file://$(python3 -c "import urllib.parse; print(urllib.parse.quote('$PATH_ARG'))")"

# Build language-aware prompt
if [ -n "$LANG_HINT" ]; then
  LANG_INSTRUCTION="The code appears to be $LANG_HINT. Format your output accordingly."
else
  LANG_INSTRUCTION="Detect the programming language and format accordingly."
fi

PROMPT="You are a code extraction engine. This screenshot contains code, a stack trace, a configuration file, terminal output, or similar technical text.

Your job:
1. Read ALL text in the image exactly as written
2. Output the text as clean, copy-pasteable code
3. Preserve indentation, line breaks, and formatting precisely
4. Do NOT add commentary, explanations, or markdown formatting
5. If text is partially cut off, include what's readable and note [truncated] where text is missing
6. $LANG_INSTRUCTION

Output ONLY the raw code/text from the image. Nothing else."

curl -sf --max-time 600 "$BASE_URL/chat/completions" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c "
import json
print(json.dumps({
    'model': '$MODEL',
    'messages': [
        {'role': 'system', 'content': '''$PROMPT'''},
        {'role': 'user', 'content': [
            {'type': 'image_url', 'image_url': {'url': '$FILE_URI'}},
            {'type': 'text', 'text': 'Extract all code/text from this screenshot.'}
        ]}
    ],
    'max_tokens': 16384,
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

# Try to detect language from content hints
lang = '$LANG_HINT' or 'unknown'

print(json.dumps({
    'code': content,
    'language_hint': lang,
    'line_count': len(content.split('\n')),
    'prompt_tokens': usage.get('prompt_tokens', 0),
    'completion_tokens': usage.get('completion_tokens', 0)
}, indent=2))
"
