#!/usr/bin/env bash
# Generate accessibility descriptions (alt text) for images or videos.
# Usage: describe.sh <path> [context] [max_length]
# Example: describe.sh photo.jpg "ecommerce product page" 125
# Example: describe.sh ui-screenshot.png "documentation"
# Example: describe.sh clip.mp4 "social media post"
set -euo pipefail

BASE_URL="${NEMOTRON_OMNI_BASE_URL:-http://localhost:8000/v1}"
MODEL="${NEMOTRON_OMNI_MODEL:-nemotron_3_nano_omni}"

PATH_ARG="${1:?Usage: describe.sh <path> [context] [max_length]}"
CONTEXT="${2:-general}"
MAX_LENGTH="${3:-250}"

if [ ! -f "$PATH_ARG" ]; then
  echo "{\"error\":\"File not found: $PATH_ARG\"}" >&2
  exit 1
fi

EXT="${PATH_ARG##*.}"
FILE_URI="file://$(python3 -c "import urllib.parse; print(urllib.parse.quote('$PATH_ARG'))")"

case "$EXT" in
  jpg|jpeg|png|webp)
    MEDIA_TYPE="image"
    MEDIA_PART="{\"type\": \"image_url\", \"image_url\": {\"url\": \"$FILE_URI\"}}"
    ;;
  mp4)
    MEDIA_TYPE="video"
    MEDIA_PART="{\"type\": \"video_url\", \"video_url\": {\"url\": \"$FILE_URI\"}}"
    ;;
  wav|mp3)
    MEDIA_TYPE="audio"
    MEDIA_PART="{\"type\": \"input_audio\", \"input_audio\": {\"data\": \"$FILE_URI\", \"format\": \"url\"}}"
    ;;
  *)
    echo "{\"error\":\"Unsupported file type: $EXT\"}" >&2
    exit 1
    ;;
esac

# Build context-aware prompt
case "$CONTEXT" in
  ecommerce|product|shop|store)
    PROMPT="Write alt text for this $MEDIA_TYPE for an e-commerce product page.
Describe the product, its appearance, color, and key visual details.
Maximum $MAX_LENGTH characters. Do not start with 'Image of' or 'Photo of'."
    ;;
  documentation|docs|technical)
    PROMPT="Write alt text for this $MEDIA_TYPE for technical documentation.
Describe the UI elements, layout, data, and any text visible.
Maximum $MAX_LENGTH characters. Be precise and factual."
    ;;
  social|social-media|post|tweet)
    PROMPT="Write alt text for this $MEDIA_TYPE for a social media post.
Make it engaging but descriptive. Cover the main subject and mood.
Maximum $MAX_LENGTH characters. Do not start with 'Image of'."
    ;;
  article|blog|news)
    PROMPT="Write alt text for this $MEDIA_TYPE for a news article or blog post.
Describe what is shown in a way that adds context to the article.
Maximum $MAX_LENGTH characters."
    ;;
  presentation|slides|deck)
    PROMPT="Write alt text for this $MEDIA_TYPE for a presentation slide.
Describe charts, graphs, diagrams, and key text. Note data points and trends.
Maximum $MAX_LENGTH characters."
    ;;
  *)
    PROMPT="Write clear, concise alt text for this $MEDIA_TYPE.
Describe what is shown so someone who cannot see it would understand it.
Maximum $MAX_LENGTH characters.
Rules:
- Do NOT start with 'Image of', 'Photo of', 'Video of', or 'This shows'
- Be specific: name objects, colors, actions, text, people, settings
- Focus on what matters most for understanding"
    ;;
esac

# Build extra_body for video (include audio)
EXTRA_BODY='{"chat_template_kwargs": {"enable_thinking": false}}'
if [ "$MEDIA_TYPE" = "video" ]; then
  EXTRA_BODY='{"mm_processor_kwargs": {"use_audio_in_video": true}, "chat_template_kwargs": {"enable_thinking": false}}'
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
            $MEDIA_PART,
            {'type': 'text', 'text': '''$PROMPT'''}
        ]
    }],
    'max_tokens': 512,
    'temperature': 0.2,
    'extra_body': $EXTRA_BODY
}))
")" | python3 -c "
import sys, json
resp = json.load(sys.stdin)
content = resp.get('choices', [{}])[0].get('message', {}).get('content', '').strip()
usage = resp.get('usage', {})
print(json.dumps({
    'alt_text': content,
    'media_type': '$MEDIA_TYPE',
    'context': '$CONTEXT',
    'character_count': len(content),
    'max_length': $MAX_LENGTH,
    'prompt_tokens': usage.get('prompt_tokens', 0),
    'completion_tokens': usage.get('completion_tokens', 0)
}, indent=2))
"
