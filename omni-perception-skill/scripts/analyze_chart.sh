#!/usr/bin/env bash
# Analyze charts, graphs & data visualizations with data extraction + optional critique.
# Multi-call workflow inspired by Wendell's graph critique use case.
# Usage: analyze_chart.sh <path> [extract_data] [critique] [thinking]
# Example: analyze_chart.sh benchmark.png true true true
set -euo pipefail

BASE_URL="${NEMOTRON_OMNI_BASE_URL:-http://localhost:8000/v1}"
MODEL="${NEMOTRON_OMNI_MODEL:-nemotron_3_nano_omni}"

PATH_ARG="${1:?Usage: analyze_chart.sh <path> [extract_data] [critique] [thinking]}"
EXTRACT="${2:-true}"
CRITIQUE="${3:-false}"
THINKING="${4:-true}"

if [ ! -f "$PATH_ARG" ]; then
  echo "{\"error\":\"File not found: $PATH_ARG\"}" >&2
  exit 1
fi

FILE_URI="file://$(python3 -c "import urllib.parse; print(urllib.parse.quote('$PATH_ARG'))")"

# Step 1: Chart analysis
echo "Analyzing chart..." >&2

ANALYSIS=$(curl -sf --max-time 300 "$BASE_URL/chat/completions" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c "
import json
print(json.dumps({
    'model': '$MODEL',
    'messages': [{'role': 'user', 'content': [
        {'type': 'image_url', 'image_url': {'url': '$FILE_URI'}},
        {'type': 'text', 'text': '''Analyze this chart/graph/data visualization in detail.

Provide:
## Chart Type
(What type of visualization: bar, line, scatter, pie, heatmap, box plot, histogram, etc.)

## Axes & Scales
- X-axis: label, unit, range, scale type (linear/log)
- Y-axis: label, unit, range, scale type (linear/log)
- Any secondary axes

## Data Series
- Each series: name, color/pattern, number of visible data points
- Legend information

## Key Observations
- Trends (increasing, decreasing, cyclical, flat)
- Notable peaks, valleys, inflection points
- Outliers or anomalies
- Any visible thresholds, reference lines, or annotations

## Summary
One paragraph describing what this chart shows and the main takeaway.'''}
    ]}],
    'max_tokens': 8192,
    'extra_body': {'chat_template_kwargs': {'enable_thinking': $THINKING}}
}))
")" | python3 -c "import sys,json; print(json.load(sys.stdin).get('choices',[{}])[0].get('message',{}).get('content',''))")

# Step 2: Data extraction (optional)
EXTRACTION=""
if [ "$EXTRACT" = "true" ]; then
  echo "Extracting data points..." >&2
  EXTRACTION=$(curl -sf --max-time 120 "$BASE_URL/chat/completions" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c "
import json
print(json.dumps({
    'model': '$MODEL',
    'messages': [{'role': 'user', 'content': [
        {'type': 'image_url', 'image_url': {'url': '$FILE_URI'}},
        {'type': 'text', 'text': '''Extract all visible data points from this chart as JSON.

Output schema:
{
  \"chart_type\": \"...\",
  \"x_axis\": {\"label\": \"...\", \"unit\": \"...\", \"values\": [...]},
  \"y_axis\": {\"label\": \"...\", \"unit\": \"...\"},
  \"series\": [
    {\"name\": \"...\", \"data_points\": [{\"x\": ..., \"y\": ...}, ...]}
  ]
}

Rules:
- Estimate values as precisely as you can
- Include ALL visible data points
- If values are approximate, include them anyway
Output ONLY valid JSON. No markdown.'''}
    ]}],
    'max_tokens': 4096,
    'temperature': 0.1,
    'extra_body': {'chat_template_kwargs': {'enable_thinking': False}}
}))
")" | python3 -c "
import sys, json
resp = json.load(sys.stdin)
content = resp.get('choices', [{}])[0].get('message', {}).get('content', '').strip()
# Try to parse as JSON
try:
    if content.startswith('\`\`\`'):
        content = content.split('\n', 1)[1] if '\n' in content else content[3:]
        if content.endswith('\`\`\`'):
            content = content[:-3]
        content = content.strip()
    data = json.loads(content)
    print(json.dumps(data))
except:
    print(json.dumps({'raw': content}))
")
fi

# Step 3: Visualization critique (optional)
CRITIQUE_OUT=""
if [ "$CRITIQUE" = "true" ]; then
  echo "Critiquing visualization..." >&2
  CRITIQUE_OUT=$(curl -sf --max-time 120 "$BASE_URL/chat/completions" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c "
import json
print(json.dumps({
    'model': '$MODEL',
    'messages': [{'role': 'user', 'content': [
        {'type': 'image_url', 'image_url': {'url': '$FILE_URI'}},
        {'type': 'text', 'text': '''Critique this data visualization. Identify problems and suggest improvements.

Check for:
1. **Misleading scales** — truncated axes, non-zero baselines, inconsistent intervals
2. **Hidden data** — important data obscured by scale choices, aggregation that hides outliers
3. **Visual clutter** — too many series, unclear labels, poor color choices
4. **Statistical issues** — inappropriate bin sizes, missing error bars, P99 hidden by averages
5. **Accessibility** — color-blind unfriendly, small text, no labels on data points
6. **Suggested improvements** — specific actionable fixes

Rate: Excellent / Good / Fair / Poor
Be specific and constructive.'''}
    ]}],
    'max_tokens': 2048,
    'extra_body': {'chat_template_kwargs': {'enable_thinking': False}}
}))
")" | python3 -c "import sys,json; print(json.load(sys.stdin).get('choices',[{}])[0].get('message',{}).get('content',''))")
fi

# Assemble output
python3 -c "
import json, sys
result = {'analysis': '''$(echo "$ANALYSIS" | python3 -c "import sys; print(sys.stdin.read())")'''}
if '$EXTRACTION':
    try:
        result['extracted_data'] = json.loads('''$(echo "$EXTRACTION" | python3 -c "import sys; print(sys.stdin.read())")''')
    except:
        result['extraction_raw'] = '''$(echo "$EXTRACTION" | python3 -c "import sys; print(sys.stdin.read())")'''
if '$CRITIQUE_OUT':
    result['visualization_critique'] = '''$(echo "$CRITIQUE_OUT" | python3 -c "import sys; print(sys.stdin.read())")'''
print(json.dumps(result, indent=2))
"
