#!/usr/bin/env bash
# Extract structured intent JSON from a voice command.
# Wendell's voice-to-tool-calling pattern: audio → intent JSON → dispatch.
# Usage: voice_intent.sh <path> [available_actions] [parameters_schema]
# Example: voice_intent.sh command.wav "run_script,search_web,send_email" '{"script":"string","target":"string"}'
set -euo pipefail

BASE_URL="${NEMOTRON_OMNI_BASE_URL:-http://localhost:8000/v1}"
MODEL="${NEMOTRON_OMNI_MODEL:-nemotron_3_nano_omni}"

PATH_ARG="${1:?Usage: voice_intent.sh <path> [available_actions] [parameters_schema]}"
ACTIONS="${2:-}"
PARAMS_SCHEMA="${3:-}"

if [ ! -f "$PATH_ARG" ]; then
  echo "{\"error\":\"File not found: $PATH_ARG\"}" >&2
  exit 1
fi

FILE_URI="file://$(python3 -c "import urllib.parse; print(urllib.parse.quote('$PATH_ARG'))")"

echo "Extracting voice intent..." >&2

curl -sf --max-time 300 "$BASE_URL/chat/completions" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c "
import json

actions = '''$ACTIONS'''
params_schema = '''$PARAMS_SCHEMA'''

prompt = '''You are a voice command parser. Listen to this audio clip and extract the user's intent.

Rules:
1. Transcribe what the user said (handle accents, colloquialisms, and indirect phrasing)
2. Determine the intent — what does the user want to happen?
3. Extract any parameters mentioned (targets, values, names, quantities, etc.)
4. Rate your confidence from 0.0 to 1.0
'''

if actions:
    action_list = [a.strip() for a in actions.split(',') if a.strip()]
    if action_list:
        prompt += 'Available actions (map the user\\'s request to the closest match):\n'
        for i, a in enumerate(action_list, 1):
            prompt += f'{i}. {a}\n'
        prompt += 'If the request doesn\\'t match any action, set action to \"unknown\".\n'

if params_schema:
    prompt += f'\nExpected parameters schema:\n{params_schema}\n'
    prompt += 'Extract parameters matching this schema. If a parameter isn\'t mentioned, set it to null.\n'

prompt += '''
Output ONLY valid JSON with this structure:
{
  \"transcript\": \"what was said\",
  \"action\": \"identified_action\",
  \"parameters\": { ... extracted params ... },
  \"confidence\": 0.0,
  \"ambiguities\": [\"any unclear parts\"],
  \"clarification_needed\": false
}

Set clarification_needed to true if the intent is ambiguous.'''

print(json.dumps({
    'model': '$MODEL',
    'messages': [{'role': 'user', 'content': [
        {'type': 'input_audio', 'input_audio': {'data': '$FILE_URI', 'format': 'url'}},
        {'type': 'text', 'text': prompt}
    ]}],
    'max_tokens': 2048,
    'temperature': 0.1,
    'extra_body': {'chat_template_kwargs': {'enable_thinking': False}}
}))
")" | python3 -c "
import sys, json

resp = json.load(sys.stdin)
content = resp.get('choices', [{}])[0].get('message', {}).get('content', '').strip()

# Try to parse as JSON
try:
    cleaned = content
    if cleaned.startswith('\`\`\`'):
        cleaned = cleaned.split('\n', 1)[1] if '\n' in cleaned else cleaned[3:]
        if cleaned.endswith('\`\`\`'):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()
    intent = json.loads(cleaned)
    print(json.dumps({'intent': intent}, indent=2))
except:
    print(json.dumps({'raw': content, 'parse_warning': 'Model did not return valid JSON'}, indent=2))
"
