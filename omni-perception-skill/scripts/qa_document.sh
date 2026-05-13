#!/usr/bin/env bash
# Q&A with a PDF document. Extracts all pages, then answers your question.
# Usage: qa_document.sh <path> <question> [detail_level] [pages]
# Example: qa_document.sh report.pdf "What is the total revenue?" summary
# Example: qa_document.sh contract.pdf "What are the termination clauses?" full "1,2,3"
set -euo pipefail

BASE_URL="${NEMOTRON_OMNI_BASE_URL:-http://localhost:8000/v1}"
MODEL="${NEMOTRON_OMNI_MODEL:-nemotron_3_nano_omni}"
DPI="${NEMOTRON_OMNI_PDF_DPI:-150}"

PATH_ARG="${1:?Usage: qa_document.sh <path> <question> [detail_level] [pages]}"
QUESTION="${2:-}"
DETAIL="${3:-summary}"
PAGES="${4:-all}"

if [ ! -f "$PATH_ARG" ]; then
  echo "{\"error\":\"File not found: $PATH_ARG\"}" >&2
  exit 1
fi

if ! command -v pdftoppm &>/dev/null; then
  echo "{\"error\":\"pdftoppm not found. Install: brew install poppler\"}" >&2
  exit 1
fi

TMPDIR=$(mktemp -d /tmp/omni-qa-XXXXXX)
trap "rm -rf $TMPDIR" EXIT

# Render pages
if [ "$PAGES" = "all" ]; then
  pdftoppm -r "$DPI" -png "$PATH_ARG" "$TMPDIR/page"
else
  FIRST=$(echo "$PAGES" | tr ',' '\n' | sort -n | head -1)
  LAST=$(echo "$PAGES" | tr ',' '\n' | sort -n | tail -1)
  pdftoppm -r "$DPI" -png -f "$FIRST" -l "$LAST" "$PATH_ARG" "$TMPDIR/page"
fi

echo "Extracting document content..." >&2

# Extract per-page content using python3
python3 << 'PYEOF'
import json, os, subprocess, sys

base_url = os.environ.get("NEMOTRON_OMNI_BASE_URL", "http://localhost:8000/v1")
model = os.environ.get("NEMOTRON_OMNI_MODEL", "nemotron_3_nano_omni")
tmpdir = os.environ.get("TMPDIR")
detail = os.environ.get("DETAIL", "summary")
question = os.environ.get("QUESTION", "")
pages_str = os.environ.get("PAGES", "all")

pngs = sorted(f for f in os.listdir(tmpdir) if f.endswith('.png'))
if not pngs:
    print(json.dumps({"error": "No pages rendered"}))
    sys.exit(1)

# Parse requested pages
if pages_str == "all":
    requested = set(range(1, len(pngs) + 1))
else:
    requested = set(int(p.strip()) for p in pages_str.split(","))
start_page = int(os.environ.get("FIRST", "1"))

per_page = []
for i, png in enumerate(pngs):
    page_num = start_page + i
    if page_num not in requested:
        continue

    uri = "file://" + os.path.join(tmpdir, png).replace(" ", "%20")

    if detail == "full":
        prompt = f"Page {page_num}. Extract ALL text, numbers, table data, and labels. Preserve structure."
        max_tok = 4096
    else:
        prompt = f"Page {page_num}. Provide a concise 2-3 sentence summary. Include key numbers and facts."
        max_tok = 512

    payload = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": uri}},
            {"type": "text", "text": prompt}
        ]}],
        "max_tokens": max_tok,
        "temperature": 0.2,
        "extra_body": {"chat_template_kwargs": {"enable_thinking": False}}
    })

    try:
        result = subprocess.run(
            ["curl", "-sf", "--max-time", "120", f"{base_url}/chat/completions",
             "-H", "Content-Type: application/json", "-d", payload],
            capture_output=True, text=True, timeout=130
        )
        resp = json.loads(result.stdout)
        content = resp.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
        per_page.append({"page": page_num, "content": content})
        print(f"  Extracted page {page_num}", file=sys.stderr)
    except Exception as e:
        per_page.append({"page": page_num, "content": f"Error: {e}"})

# If no question, return extraction only
if not question:
    print(json.dumps({
        "per_page": per_page,
        "page_count": len(pngs),
        "detail_level": detail,
        "hint": "Call again with a question to get targeted answers."
    }, indent=2))
    sys.exit(0)

# Answer question against full context
print("Answering question against document...", file=sys.stderr)
context = "\n\n".join(f"--- Page {p['page']} ---\n{p['content']}" for p in per_page)

qa_payload = json.dumps({
    "model": model,
    "messages": [{"role": "user", "content": [
        {"type": "text", "text": f"You have access to the following document content (page by page):\n\n{context}\n\nAnswer this question based on the document: {question}\n\nRules:\n- Answer based ONLY on the document content above\n- Cite specific page numbers: [Page N]\n- If the document doesn't contain the answer, say so clearly\n- Be specific with numbers, names, and dates"}
    ]}],
    "max_tokens": 8192,
    "temperature": 0.6,
    "extra_body": {"chat_template_kwargs": {"enable_thinking": True}}
})

result = subprocess.run(
    ["curl", "-sf", "--max-time", "300", f"{base_url}/chat/completions",
     "-H", "Content-Type: application/json", "-d", qa_payload],
    capture_output=True, text=True, timeout=310
)
resp = json.loads(result.stdout)
answer = resp.get("choices", [{}])[0].get("message", {}).get("content", "")

# Strip think tags
final = answer
idx = final.find("</think")
if idx != -1:
    close = final.find(">", idx)
    if close != -1:
        final = final[close+1:].strip()

print(json.dumps({
    "question": question,
    "answer": final,
    "source_pages": [p["page"] for p in per_page],
    "page_count": len(pngs)
}, indent=2))
PYEOF
