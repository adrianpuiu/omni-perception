#!/usr/bin/env bash
# Build a searchable video index: segment video into chunks, analyze each, output JSON index.
# Multi-call workflow inspired by Corey's podcast archive pipeline.
# Usage: video_search_index.sh <path> [chunk_seconds] [topics]
# Example: video_search_index.sh podcast.mp4 30 "networking,AI,hardware"
set -euo pipefail

BASE_URL="${NEMOTRON_OMNI_BASE_URL:-http://localhost:8000/v1}"
MODEL="${NEMOTRON_OMNI_MODEL:-nemotron_3_nano_omni}"

PATH_ARG="${1:?Usage: video_search_index.sh <path> [chunk_seconds] [topics]}"
CHUNK_SEC="${2:-30}"
TOPICS="${3:-}"

if [ ! -f "$PATH_ARG" ]; then
  echo "{\"error\":\"File not found: $PATH_ARG\"}" >&2
  exit 1
fi

# Get video duration
DURATION=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$PATH_ARG" 2>/dev/null | cut -d. -f1)
if [ -z "$DURATION" ] || [ "$DURATION" -lt 1 ]; then
  echo "{\"error\":\"Could not determine video duration\"}" >&2
  exit 1
fi

if [ "$DURATION" -gt 600 ]; then
  echo "{\"error\":\"Video too long: ${DURATION}s. Max 600s (10 min).\"}" >&2
  exit 1
fi

CHUNK_COUNT=$(( (DURATION + CHUNK_SEC - 1) / CHUNK_SEC ))

FILE_URI="file://$(python3 -c "import urllib.parse; print(urllib.parse.quote('$PATH_ARG'))")"

echo "Indexing ${DURATION}s video in ${CHUNK_COUNT} chunks of ${CHUNK_SEC}s..." >&2

# Step 1: Full video analysis for overview
OVERVIEW=$(curl -sf --max-time 600 "$BASE_URL/chat/completions" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c "
import json
print(json.dumps({
    'model': '$MODEL',
    'messages': [{'role': 'user', 'content': [
        {'type': 'video_url', 'video_url': {'url': '$FILE_URI'}},
        {'type': 'text', 'text': '''Analyze this video in detail. Duration: ${DURATION}s.
Provide:
1. A 2-3 sentence overall summary
2. A list of all topics discussed
3. A list of all speakers/people visible or audible
4. Key moments with approximate timestamps
Format as structured text with clear headers.'''}
    ]}],
    'max_tokens': 8192,
    'temperature': 0.2,
    'extra_body': {'mm_processor_kwargs': {'use_audio_in_video': True}, 'chat_template_kwargs': {'enable_thinking': False}}
}))
")" | python3 -c "import sys,json; print(json.load(sys.stdin).get('choices',[{}])[0].get('message',{}).get('content',''))")

echo "Got overview, building chunk index..." >&2

# Step 2: Build chunk index from overview
TOPIC_INSTRUCTION=""
if [ -n "$TOPICS" ]; then
  TOPIC_INSTRUCTION="Tag each chunk against these topics: $TOPICS"
fi

curl -sf --max-time 600 "$BASE_URL/chat/completions" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c "
import json, sys

overview = '''$(echo "$OVERVIEW" | python3 -c "import sys; print(sys.stdin.read())")'''
chunk_sec = $CHUNK_SEC
duration = $DURATION
chunk_count = $CHUNK_COUNT
topics_instruction = '''$TOPIC_INSTRUCTION'''

prompt = f'''Based on the following video analysis, create a time-based index.

Video duration: {duration}s. Chunk size: {chunk_sec}s. Total chunks: {chunk_count}.

Video analysis:
{overview}

For EACH chunk, output a JSON object with this schema:
{{\"chunk\": N, \"start_seconds\": S, \"end_seconds\": E, \"timestamp\": \"MM:SS - MM:SS\", \"transcript_excerpt\": \"what is being discussed in this segment\", \"visual_description\": \"what is shown on screen\", \"topics\": [\"topic1\", \"topic2\"], \"speakers\": [\"speaker name\"], \"keywords\": [\"kw1\", \"kw2\"]}}

{topics_instruction}

Output a JSON array of {chunk_count} chunk objects. Nothing else.'''

print(json.dumps({
    'model': '$MODEL',
    'messages': [{'role': 'user', 'content': [{'type': 'text', 'text': prompt}]}],
    'max_tokens': min(chunk_count * 500, 32768),
    'temperature': 0.2,
    'extra_body': {'chat_template_kwargs': {'enable_thinking': False}}
}))
")" | python3 -c "
import sys, json

resp = json.load(sys.stdin)
content = resp.get('choices', [{}])[0].get('message', {}).get('content', '').strip()
overview = '''$(echo "$OVERVIEW" | python3 -c "import sys; print(sys.stdin.read())")'''

# Try to parse chunks as JSON
chunks = None
raw = None
try:
    cleaned = content
    if cleaned.startswith('\`\`\`'):
        cleaned = cleaned.split('\n', 1)[1] if '\n' in cleaned else cleaned[3:]
        if cleaned.endswith('\`\`\`'):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()
    chunks = json.loads(cleaned)
except:
    raw = content

result = {
    'index': {
        'source': '$PATH_ARG',
        'duration_seconds': $DURATION,
        'chunk_seconds': $CHUNK_SEC,
        'chunk_count': $CHUNK_COUNT,
    },
    'overview': overview,
}
if chunks:
    result['chunks'] = chunks
else:
    result['raw_chunks'] = raw
    result['parse_warning'] = 'Model did not return valid JSON array'
result['usage_hint'] = 'Store chunks in a vector DB with embeddings of transcript_excerpt + keywords for semantic search. Use timestamp to seek to the relevant segment.'

print(json.dumps(result, indent=2))
"
