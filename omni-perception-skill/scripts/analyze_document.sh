#!/usr/bin/env bash
# Analyze a PDF document using Nemotron Omni.
# Renders pages to images via pdftoppm, analyzes each, optionally aggregates.
# Usage: analyze_document.sh <path> <prompt> [pages] [aggregate]
set -euo pipefail

BASE_URL="${NEMOTRON_OMNI_BASE_URL:-http://localhost:8000/v1}"
MODEL="${NEMOTRON_OMNI_MODEL:-nemotron_3_nano_omni}"
DPI="${NEMOTRON_OMNI_PDF_DPI:-150}"

PATH_ARG="${1:?Usage: analyze_document.sh <path> <prompt> [pages] [aggregate]}"
PROMPT="${2:?Prompt is required}"
PAGES="${3:-all}"
AGGREGATE="${4:-true}"

if [ ! -f "$PATH_ARG" ]; then
  echo "{\"error\":\"File not found: $PATH_ARG\"}" >&2
  exit 1
fi

EXT="${PATH_ARG##*.}"
if [ "$EXT" != "pdf" ]; then
  echo "{\"error\":\"Unsupported extension: $EXT. Only pdf is supported.\"}" >&2
  exit 1
fi

# Check for pdftoppm
if ! command -v pdftoppm &>/dev/null; then
  echo "{\"error\":\"pdftoppm not found. Install: brew install poppler (macOS) or apt-get install poppler-utils (Linux)\"}" >&2
  exit 1
fi

# Create temp dir
TMPDIR=$(mktemp -d /tmp/omni-perception-pdf-XXXXXX)
trap "rm -rf $TMPDIR" EXIT

# Render pages
if [ "$PAGES" = "all" ]; then
  pdftoppm -r "$DPI" -png "$PATH_ARG" "$TMPDIR/page"
else
  # Convert comma-separated pages to -f/-l ranges
  # For simplicity, render the range from min to max
  FIRST=$(echo "$PAGES" | tr ',' '\n' | sort -n | head -1)
  LAST=$(echo "$PAGES" | tr ',' '\n' | sort -n | tail -1)
  pdftoppm -r "$DPI" -png -f "$FIRST" -l "$LAST" "$PATH_ARG" "$TMPDIR/page"
fi

# Analyze each page
python3 -c "
import json, os, subprocess, sys

base_url = '$BASE_URL'
model = '$MODEL'
prompt = '''$PROMPT'''
tmpdir = '$TMPDIR'
pages_str = '$PAGES'
aggregate = '$AGGREGATE' == 'true'

# Collect PNG files
pngs = sorted([f for f in os.listdir(tmpdir) if f.endswith('.png')])
if not pngs:
    print(json.dumps({'error': 'No pages rendered'}))
    sys.exit(1)

# Parse requested pages
if pages_str == 'all':
    requested = list(range(1, len(pngs) + 1))
else:
    requested = [int(p.strip()) for p in pages_str.split(',')]

start_page = int('${FIRST:-1}')
per_page = []

for i, png in enumerate(pngs):
    page_num = start_page + i
    if page_num not in requested:
        continue

    png_path = os.path.join(tmpdir, png)
    file_uri = 'file://' + png_path.replace(' ', '%20')

    payload = json.dumps({
        'model': model,
        'messages': [{
            'role': 'user',
            'content': [
                {'type': 'image_url', 'image_url': {'url': file_uri}},
                {'type': 'text', 'text': f'Page {page_num} of the document.\n\n{prompt}'}
            ]
        }],
        'max_tokens': 20480,
        'temperature': 0.6,
        'extra_body': {
            'chat_template_kwargs': {'enable_thinking': True}
        }
    })

    try:
        result = subprocess.run(
            ['curl', '-sf', '--max-time', '300', f'{base_url}/chat/completions',
             '-H', 'Content-Type: application/json',
             '-d', payload],
            capture_output=True, text=True, timeout=310
        )
        resp = json.loads(result.stdout)
        content = resp.get('choices', [{}])[0].get('message', {}).get('content', '')
        per_page.append({'page': page_num, 'content': content})
    except Exception as e:
        per_page.append({'page': page_num, 'content': f'Error: {e}'})

# Aggregate if requested
summary = None
if aggregate and len(per_page) > 1:
    summaries = '\n\n'.join(f'--- Page {p[\"page\"]} ---\n{p[\"content\"]}' for p in per_page)
    agg_payload = json.dumps({
        'model': model,
        'messages': [{
            'role': 'user',
            'content': [{'type': 'text', 'text': f'You analyzed each page individually. Per-page summaries follow. Answer the user prompt holistically.\n\n{summaries}\n\nUser prompt: {prompt}'}]
        }],
        'max_tokens': 20480,
        'temperature': 0.6,
        'extra_body': {
            'chat_template_kwargs': {'enable_thinking': True}
        }
    })
    try:
        result = subprocess.run(
            ['curl', '-sf', '--max-time', '300', f'{base_url}/chat/completions',
             '-H', 'Content-Type: application/json',
             '-d', agg_payload],
            capture_output=True, text=True, timeout=310
        )
        resp = json.loads(result.stdout)
        summary = resp.get('choices', [{}])[0].get('message', {}).get('content', '')
    except:
        summary = None

output = {'per_page': per_page, 'page_count': len(pngs)}
if summary:
    output['summary'] = summary

print(json.dumps(output, indent=2))
"
