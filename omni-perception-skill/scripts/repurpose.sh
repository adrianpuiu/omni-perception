#!/usr/bin/env bash
# Repurpose video/audio content into multiple formats.
# Usage: repurpose.sh <path> [formats] [tone] [language]
# Example: repurpose.sh talk.mp4 "blog_post,social_thread,email_summary,key_quotes" professional
# Example: repurpose.sh podcast.mp3 "blog_post,email_summary" casual
set -euo pipefail

BASE_URL="${NEMOTRON_OMNI_BASE_URL:-http://localhost:8000/v1}"
MODEL="${NEMOTRON_OMNI_MODEL:-nemotron_3_nano_omni}"

PATH_ARG="${1:?Usage: repurpose.sh <path> [formats] [tone] [language]}"
FORMATS="${2:-blog_post,social_thread,email_summary,key_quotes}"
TONE="${3:-professional}"
LANGUAGE="${4:-}"

if [ ! -f "$PATH_ARG" ]; then
  echo "{\"error\":\"File not found: $PATH_ARG\"}" >&2
  exit 1
fi

EXT="${PATH_ARG##*.}"

# Step 1: Extract source content
echo "Extracting content from $EXT..." >&2

if [ "$EXT" = "mp4" ]; then
  FILE_URI="file://$(python3 -c "import urllib.parse; print(urllib.parse.quote('$PATH_ARG'))")"
  SOURCE=$(curl -sf --max-time 600 "$BASE_URL/chat/completions" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c "
import json
print(json.dumps({
    'model': '$MODEL',
    'messages': [{'role': 'user', 'content': [
        {'type': 'video_url', 'video_url': {'url': '$FILE_URI'}},
        {'type': 'text', 'text': 'Provide a detailed summary of everything discussed or shown. Include all key points, arguments, data, and conclusions.'}
    ]}],
    'max_tokens': 8192,
    'temperature': 0.2,
    'extra_body': {'mm_processor_kwargs': {'use_audio_in_video': True}, 'chat_template_kwargs': {'enable_thinking': False}}
}))
")" | python3 -c "import sys,json; print(json.load(sys.stdin).get('choices',[{}])[0].get('message',{}).get('content',''))")
elif [ "$EXT" = "wav" ] || [ "$EXT" = "mp3" ]; then
  FILE_URI="file://$(python3 -c "import urllib.parse; print(urllib.parse.quote('$PATH_ARG'))")"
  SOURCE=$(curl -sf --max-time 600 "$BASE_URL/chat/completions" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c "
import json
print(json.dumps({
    'model': '$MODEL',
    'messages': [{'role': 'user', 'content': [
        {'type': 'input_audio', 'input_audio': {'data': '$FILE_URI', 'format': 'url'}},
        {'type': 'text', 'text': 'Transcribe this audio in full detail, including all key points, arguments, and conclusions.'}
    ]}],
    'max_tokens': 20480,
    'temperature': 0.2,
    'extra_body': {'chat_template_kwargs': {'enable_thinking': False}}
}))
")" | python3 -c "import sys,json; print(json.load(sys.stdin).get('choices',[{}])[0].get('message',{}).get('content',''))")
else
  echo "{\"error\":\"Unsupported file type: $EXT. Use .mp4, .wav, or .mp3\"}" >&2
  exit 1
fi

# Step 2: Generate each format
LANG_SUFFIX=""
[ -n "$LANGUAGE" ] && LANG_SUFFIX="Write in $LANGUAGE."

python3 << PYEOF
import json, subprocess, sys

base_url = "$BASE_URL"
model = "$MODEL"
source = '''$(echo "$SOURCE" | python3 -c "import sys; print(sys.stdin.read())")'''
tone = "$TONE"
lang = "$LANG_SUFFIX"
formats = "$FORMATS".split(",")

format_prompts = {
    "blog_post": f"""Write a well-structured blog post based on the content below.
Tone: {tone}. {lang}

Structure:
- Compelling title (H1)
- Opening hook (2-3 sentences)
- 3-5 sections with H2 headers
- Each section: 2-3 paragraphs
- Closing with key takeaway
Target length: 600-800 words. Write in markdown.""",

    "social_thread": f"""Create a social media thread (e.g., Twitter/X) based on the content below.
Tone: {tone}. {lang}

Rules:
- First tweet is the hook
- 5-8 tweets total
- Each tweet under 280 characters
- Number each tweet (1/8, 2/8, etc.)
- End with a call-to-action
- Include relevant hashtags""",

    "email_summary": f"""Write a professional email summary of the content below.
Tone: {tone}. {lang}

Structure:
- Subject line
- 3-5 bullet points with key takeaways
- One paragraph of context
- Clear next steps
Under 300 words. Make it scannable.""",

    "key_quotes": f"""Extract the 3-5 most impactful, quotable statements from the content below.
{lang}

For each quote:
1. The exact or near-exact quote
2. Context: 1 sentence explaining when/why it was said
3. Why it matters: 1 sentence on significance

Prioritize: unique insights, contrarian takes, specific numbers, and memorable phrasing."""
}

outputs = {}
for fmt in formats:
    fmt = fmt.strip()
    if fmt not in format_prompts:
        continue
    print(f"Generating {fmt}...", file=sys.stderr)
    prompt = format_prompts[fmt] + f"\n\n--- SOURCE CONTENT ---\n{source}"
    payload = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}]}],
        "max_tokens": 4096,
        "temperature": 0.6,
        "extra_body": {"chat_template_kwargs": {"enable_thinking": False}}
    })
    try:
        result = subprocess.run(
            ["curl", "-sf", "--max-time", "120", f"{base_url}/chat/completions",
             "-H", "Content-Type: application/json", "-d", payload],
            capture_output=True, text=True, timeout=130
        )
        resp = json.loads(result.stdout)
        outputs[fmt] = resp.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
    except Exception as e:
        outputs[fmt] = f"Error: {e}"

print(json.dumps({"outputs": outputs}, indent=2))
PYEOF
