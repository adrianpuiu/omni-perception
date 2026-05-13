#!/usr/bin/env bash
# Generate structured meeting notes from audio + optional slides PDF.
# Multi-call workflow: transcribe → analyze slides → synthesize notes.
# Usage: meeting_notes.sh <audio_path> [slides_pdf_path] [language]
set -euo pipefail

BASE_URL="${NEMOTRON_OMNI_BASE_URL:-http://localhost:8000/v1}"
MODEL="${NEMOTRON_OMNI_MODEL:-nemotron_3_nano_omni}"

AUDIO_PATH="${1:?Usage: meeting_notes.sh <audio_path> [slides_pdf_path] [language]}"
SLIDES_PATH="${2:-}"
LANGUAGE="${3:-English}"

# Validate audio
if [ ! -f "$AUDIO_PATH" ]; then
  echo "{\"error\":\"Audio file not found: $AUDIO_PATH\"}" >&2
  exit 1
fi
AUDIO_URI="file://$(python3 -c "import urllib.parse; print(urllib.parse.quote('$AUDIO_PATH'))")"

echo "Step 1/3: Transcribing audio..." >&2

# Step 1: Transcribe
TRANSCRIPT=$(curl -sf --max-time 600 "$BASE_URL/chat/completions" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c "
import json
print(json.dumps({
    'model': '$MODEL',
    'messages': [{'role': 'user', 'content': [
        {'type': 'input_audio', 'input_audio': {'data': '$AUDIO_URI', 'format': 'url'}},
        {'type': 'text', 'text': 'Transcribe this meeting audio in full detail. Language: $LANGUAGE. Include who is speaking when identifiable.'}
    ]}],
    'max_tokens': 20480,
    'temperature': 0.2,
    'extra_body': {'top_k': 1, 'chat_template_kwargs': {'enable_thinking': False}}
}))
")" | python3 -c "import sys,json; print(json.load(sys.stdin).get('choices',[{}])[0].get('message',{}).get('content',''))")

echo "Step 2/3: Analyzing slides..." >&2

# Step 2: Analyze slides (if provided)
SLIDES_CONTEXT=""
if [ -n "$SLIDES_PATH" ] && [ -f "$SLIDES_PATH" ]; then
  if ! command -v pdftoppm &>/dev/null; then
    echo "Warning: pdftoppm not found, skipping slides analysis" >&2
  else
    TMPDIR=$(mktemp -d /tmp/omni-meeting-XXXXXX)
    trap "rm -rf $TMPDIR" EXIT
    pdftoppm -r 150 -png "$SLIDES_PATH" "$TMPDIR/page"

    SLIDES_CONTEXT=$(python3 -c "
import os, json, subprocess

tmpdir = '$TMPDIR'
base_url = '$BASE_URL'
model = '$MODEL'
pngs = sorted(f for f in os.listdir(tmpdir) if f.endswith('.png'))
parts = []
for i, png in enumerate(pngs):
    uri = 'file://' + os.path.join(tmpdir, png).replace(' ', '%20')
    payload = json.dumps({
        'model': model,
        'messages': [{'role': 'user', 'content': [
            {'type': 'image_url', 'image_url': {'url': uri}},
            {'type': 'text', 'text': f'Slide {i+1}. One-sentence summary.'}
        ]}],
        'max_tokens': 256,
        'temperature': 0.2,
        'extra_body': {'chat_template_kwargs': {'enable_thinking': False}}
    })
    result = subprocess.run(
        ['curl', '-sf', '--max-time', '60', f'{base_url}/chat/completions',
         '-H', 'Content-Type: application/json', '-d', payload],
        capture_output=True, text=True, timeout=70
    )
    resp = json.loads(result.stdout)
    content = resp.get('choices', [{}])[0].get('message', {}).get('content', '').strip()
    parts.append(f'Slide {i+1}: {content}')

print('\n'.join(parts))
")
  fi
fi

echo "Step 3/3: Generating structured notes..." >&2

# Step 3: Synthesize
SLIDES_SECTION=""
if [ -n "$SLIDES_CONTEXT" ]; then
  SLIDES_SECTION="\n\n## Slides Referenced\n$SLIDES_CONTEXT"
fi

curl -sf --max-time 600 "$BASE_URL/chat/completions" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c "
import json
print(json.dumps({
    'model': '$MODEL',
    'messages': [{'role': 'user', 'content': [{'type': 'text', 'text': '''
You are a meeting notes assistant. Based on the following meeting data, produce structured notes.

## Meeting Transcript
$(echo "$TRANSCRIPT" | python3 -c "import sys; print(sys.stdin.read())")
$SLIDES_SECTION

Produce the notes in this EXACT format:

# Meeting Notes

## Summary
(2-3 sentence executive summary)

## Key Decisions
(numbered list — each decision with who decided)

## Action Items
(numbered list — each item with owner and deadline if mentioned)

## Discussion Topics
(numbered list with timestamps if identifiable — format: [MM:SS] Topic)

## Open Questions
(unresolved questions or topics that need follow-up)

Be thorough and specific. Extract actual names, numbers, and commitments.
'''}]}],
    'max_tokens': 8192,
    'temperature': 0.6,
    'extra_body': {'chat_template_kwargs': {'enable_thinking': True}}
}))
")" | python3 -c "
import sys, json
resp = json.load(sys.stdin)
content = resp.get('choices', [{}])[0].get('message', {}).get('content', '')
usage = resp.get('usage', {})
# Strip think tags if present
final = content
idx = final.find('</think')
if idx != -1:
    close = final.find('>', idx)
    if close != -1:
        final = final[close+1:].strip()
print(json.dumps({
    'notes': final,
    'transcript': '''$(echo "$TRANSCRIPT" | python3 -c "import sys; print(sys.stdin.read()[:500])")...''',
    'prompt_tokens': usage.get('prompt_tokens', 0),
    'completion_tokens': usage.get('completion_tokens', 0)
}, indent=2))
"
