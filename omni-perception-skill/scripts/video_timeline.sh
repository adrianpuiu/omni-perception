#!/usr/bin/env bash
# Generate a scene-by-scene timeline breakdown of a video.
# Usage: video_timeline.sh <path> [detail_level]
# Example: video_timeline.sh clip.mp4 detailed
# Example: video_timeline.sh clip.mp4 brief
set -euo pipefail

BASE_URL="${NEMOTRON_OMNI_BASE_URL:-http://localhost:8000/v1}"
MODEL="${NEMOTRON_OMNI_MODEL:-nemotron_3_nano_omni}"

PATH_ARG="${1:?Usage: video_timeline.sh <path> [detail_level]}"
DETAIL="${2:-detailed}"

if [ ! -f "$PATH_ARG" ]; then
  echo "{\"error\":\"File not found: $PATH_ARG\"}" >&2
  exit 1
fi

EXT="${PATH_ARG##*.}"
if [ "$EXT" != "mp4" ]; then
  echo "{\"error\":\"Only mp4 is supported. Got: $EXT\"}" >&2
  exit 1
fi

# Get duration
DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$PATH_ARG" 2>/dev/null || echo "unknown")

case "$DETAIL" in
  brief)
    PROMPT="Analyze this video and provide a brief scene-by-scene timeline.
For each scene, output one line in this exact format:
[MM:SS - MM:SS] One-sentence description of what happens.

Keep descriptions under 15 words each. Focus on key actions and transitions."
    ;;
  detailed)
    PROMPT="Analyze this video and provide a detailed scene-by-scene timeline.
For each scene, output in this format:

## Scene N [MM:SS - MM:SS]
- **Action**: What is happening (1-2 sentences)
- **Subjects**: People, objects, or text visible
- **Audio**: Speech, music, or sounds heard (if any)

Be thorough. Note all visual changes, camera movements, on-screen text, and audio content.
Include timestamps as accurately as possible."
    ;;
  keyframes)
    PROMPT="Analyze this video and identify the KEY MOMENTS — the most important or interesting things that happen.
For each key moment, output:

### [MM:SS] — Title of moment
2-3 sentences describing what happens and why it matters.

Focus on: dramatic changes, important actions, text appearing on screen, speech content, and scene transitions.
Only list 3-8 key moments, not every frame."
    ;;
  *)
    PROMPT="Analyze this video and provide a scene-by-scene timeline with timestamps."
    ;;
esac

FILE_URI="file://$(python3 -c "import urllib.parse; print(urllib.parse.quote('$PATH_ARG'))")"

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
    'max_tokens': 20480,
    'temperature': 0.2,
    'extra_body': {
        'mm_processor_kwargs': {'use_audio_in_video': True},
        'chat_template_kwargs': {'enable_thinking': False}
    }
}))
")" | python3 -c "
import sys, json
resp = json.load(sys.stdin)
content = resp.get('choices', [{}])[0].get('message', {}).get('content', '')
usage = resp.get('usage', {})
print(json.dumps({
    'timeline': content,
    'duration_seconds': '$DURATION',
    'detail_level': '$DETAIL',
    'prompt_tokens': usage.get('prompt_tokens', 0),
    'completion_tokens': usage.get('completion_tokens', 0)
}, indent=2))
"
