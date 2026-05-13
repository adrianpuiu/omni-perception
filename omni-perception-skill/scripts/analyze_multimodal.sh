#!/usr/bin/env bash
# Analyze multiple modalities at once using Nemotron Omni.
# Usage: analyze_multimodal.sh <prompt> <image_path> <audio_path> <video_path>
# Pass "" for modalities you don't need. At least one must be non-empty.
set -euo pipefail

BASE_URL="${NEMOTRON_OMNI_BASE_URL:-http://localhost:8000/v1}"
MODEL="${NEMOTRON_OMNI_MODEL:-nemotron_3_nano_omni}"

PROMPT="${1:?Usage: analyze_multimodal.sh <prompt> <image_path> <audio_path> <video_path>}"
IMAGE_PATH="${2:-}"
AUDIO_PATH="${3:-}"
VIDEO_PATH="${4:-}"
MAX_TOKENS="${NEMOTRON_OMNI_MAX_TOKENS:-20480}"

# At least one modality required
if [ -z "$IMAGE_PATH" ] && [ -z "$AUDIO_PATH" ] && [ -z "$VIDEO_PATH" ]; then
  echo "{\"error\":\"At least one media path is required\"}" >&2
  exit 1
fi

# Determine auto reasoning mode
THINKING="false"
if [ -n "$IMAGE_PATH" ] && [ -z "$AUDIO_PATH" ] && [ -z "$VIDEO_PATH" ]; then
  THINKING="true"
fi

python3 -c "
import json, subprocess, sys, urllib.parse

base_url = '$BASE_URL'
model = '$MODEL'
prompt = '''$PROMPT'''
image_path = '$IMAGE_PATH' if '$IMAGE_PATH' else None
audio_path = '$AUDIO_PATH' if '$AUDIO_PATH' else None
video_path = '$VIDEO_PATH' if '$VIDEO_PATH' else None
thinking = '$THINKING' == 'true'
max_tokens = $MAX_TOKENS

content_parts = []

if image_path:
    uri = 'file://' + urllib.parse.quote(image_path)
    content_parts.append({'type': 'image_url', 'image_url': {'url': uri}})

if audio_path:
    uri = 'file://' + urllib.parse.quote(audio_path)
    content_parts.append({'type': 'input_audio', 'input_audio': {'data': uri, 'format': 'url'}})

if video_path:
    uri = 'file://' + urllib.parse.quote(video_path)
    content_parts.append({'type': 'video_url', 'video_url': {'url': uri}})

content_parts.append({'type': 'text', 'text': prompt})

extra = {
    'chat_template_kwargs': {'enable_thinking': thinking}
}

# Enable audio in video if video is present
if video_path:
    extra['mm_processor_kwargs'] = {'use_audio_in_video': True}

payload = json.dumps({
    'model': model,
    'messages': [{'role': 'user', 'content': content_parts}],
    'max_tokens': max_tokens,
    'temperature': 0.6 if thinking else 0.2,
    'extra_body': extra
})

result = subprocess.run(
    ['curl', '-sf', '--max-time', '600', f'{base_url}/chat/completions',
     '-H', 'Content-Type: application/json',
     '-d', payload],
    capture_output=True, text=True, timeout=610
)

resp = json.loads(result.stdout)
content = resp.get('choices', [{}])[0].get('message', {}).get('content', '')
usage = resp.get('usage', {})

print(json.dumps({
    'content': content,
    'prompt_tokens': usage.get('prompt_tokens', 0),
    'completion_tokens': usage.get('completion_tokens', 0)
}, indent=2))
"
