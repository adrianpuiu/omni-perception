---
name: omni-perception
description: >-
  Multimodal perception using NVIDIA Nemotron 3 Nano Omni — analyze images (OCR, charts, screenshots),
  audio (transcription, Q&A), video (visual + audio understanding), and PDF documents (per-page + aggregate)
  by calling a vLLM endpoint directly via bundled shell scripts. Also supports batch processing directories
  of files, structured data extraction (JSON/CSV) from images and PDFs, and image comparison (diff).
  Use this skill whenever the user wants to analyze, describe, transcribe, extract, compare, or batch-process
  images, screenshots, photos, audio recordings, video clips, PDF documents, receipts, invoices, tables,
  charts, or any combination of media. Also use when the user mentions OCR, ASR, speech-to-text, chart
  reading, document understanding, receipt parsing, visual diff, batch processing, or multimodal analysis —
  even if they don't name a specific modality. This skill does NOT require the MCP server — it calls vLLM
  directly via scripts, requiring only curl and python3.
---

# Omni Perception

You have direct access to NVIDIA's Nemotron 3 Nano Omni multimodal model through a local vLLM endpoint.
This is a single model that handles text, images, audio, and video — no need for separate OCR, ASR, or
vision services.

All scripts live in `scripts/` relative to this skill directory. They call vLLM via curl and output JSON
to stdout. Logs go to stderr only.

## Before you start

1. **Check health** — Run `scripts/health.sh` to confirm vLLM is up. If it fails, tell the user the server needs to be started first.
2. **File paths** — All scripts expect absolute local paths. Resolve relative paths before calling.
3. **File types** — Images: `.jpg/.jpeg/.png/.webp`, Audio: `.wav/.mp3`, Video: `.mp4`, Documents: `.pdf`.

## Quick reference

### Core analysis

| User wants to... | Script | Notes |
|---|---|---|
| Check if vLLM is running | `health.sh` | Always run this first if unsure |
| Analyze/describe an image, screenshot, chart, photo | `analyze_image.sh` | Reasoning ON by default |
| Answer questions about audio content | `analyze_audio.sh` | Reasoning OFF by default |
| Transcribe speech to text | `transcribe.sh` | Locked low-temp settings for accuracy |
| Understand what happens in a video clip | `analyze_video.sh` | Max 2 min, can include audio track |
| Analyze a PDF document | `analyze_document.sh` | Renders pages, per-page + aggregate |
| Analyze mixed media (image + audio + video) | `analyze_multimodal.sh` | Max 1 of each modality |

### Advanced workflows

| User wants to... | Script | Notes |
|---|---|---|
| Process all files in a folder | `batch.sh` | Wraps any core script over a directory |
| Extract structured data (JSON/CSV) from an image or PDF | `extract.sh` | Receipts, invoices, tables, forms |
| Compare two images and find differences | `compare.sh` | UI diffs, visual changes, before/after |
| Scene-by-scene video timeline | `video_timeline.sh` | Brief, detailed, or keyframes mode |
| Generate alt text / accessibility descriptions | `describe.sh` | Context-aware (ecommerce, docs, social) |
| Read code from a screenshot | `read_code.sh` | Clean copy-pasteable output |
| Classify/categorize content | `classify.sh` | Custom categories, confidence scores |

### Multi-call workflows

| User wants to... | Script | Chain |
|---|---|---|
| Generate structured meeting notes | `meeting_notes.sh` | Transcribe audio → analyze slides → synthesize |
| Ask questions against a PDF | `qa_document.sh` | Extract pages → Q&A with full context |
| Repurpose content into multiple formats | `repurpose.sh` | Transcribe → generate blog + social + email + quotes |

### Agent building blocks

| User wants to... | Script | Inspiration |
|---|---|---|
| Build a searchable video index for semantic search | `video_search_index.sh` | Corey's podcast archive pipeline |
| Analyze charts/graphs with data extraction + critique | `analyze_chart.sh` | Wendell's graph critique use case |
| Extract structured intent from a voice command | `voice_intent.sh` | Wendell's voice-to-tool-calling pattern |
| Verify a claim against source media | `verify_output.sh` | The output guard both panelists described |

## Script reference

### `scripts/health.sh`
```
./scripts/health.sh
```
Returns `{healthy, model, base_url, response_time_ms}` or `{healthy: false, error}`.
No arguments needed.

### `scripts/analyze_image.sh <path> <prompt> [thinking] [max_tokens]`
- `thinking`: `true` (default) or `false`
- Default max_tokens: 20480
- Reasoning ON gives deeper analysis (OCR accuracy, chart reading, spatial reasoning)
- Returns `{content, reasoning_content, prompt_tokens, completion_tokens}`

### `scripts/analyze_audio.sh <path> <prompt> [thinking] [max_tokens]`
- Max audio duration: 1 hour
- `thinking`: `false` (default) or `true`
- Returns `{content, prompt_tokens, completion_tokens}`

### `scripts/transcribe.sh <path> [word_timestamps]`
- `word_timestamps`: `true` or `false` (default)
- Uses locked settings: temperature=0.2, top_k=1, no reasoning
- Output is a clean transcript
- Returns `{content, prompt_tokens, completion_tokens}`

### `scripts/analyze_video.sh <path> <prompt> [with_audio] [thinking] [max_tokens]`
- Max video duration: 120 seconds (2 min)
- `with_audio`: `true` (default) or `false`
- `thinking`: `false` (default) or `true`
- Longer videos: tell the user to chunk into ≤2 min segments

### `scripts/analyze_document.sh <path> <prompt> [pages] [aggregate]`
- `pages`: `all` (default), a page number, or comma-separated (e.g., `1,3,5`)
- `aggregate`: `true` (default) or `false`
- Renders each PDF page to an image at 150 DPI, analyzes individually, then synthesizes
- For large PDFs (>10 pages), suggest processing specific pages first
- Requires `pdftoppm` (install via `brew install poppler` or `apt-get install poppler-utils`)

### `scripts/analyze_multimodal.sh <prompt> <image_path> <audio_path> <video_path>`
- Pass `""` (empty string) for modalities you don't need
- At least one media path must be non-empty
- Max 1 of each modality per call (vLLM serving limit)
- Automatically picks reasoning mode based on what's provided

### `scripts/batch.sh <script> <directory> <prompt> [extra_args...]`
Wraps any other script over all matching files in a directory.
Automatically filters by file type based on the target script.
```
# Transcribe all audio files in a folder
./scripts/batch.sh transcribe.sh ~/recordings/ "Transcribe this audio"

# OCR all images
./scripts/batch.sh analyze_image.sh ~/screenshots/ "Extract all text from this screenshot"

# Analyze all PDFs
./scripts/batch.sh analyze_document.sh ~/invoices/ "Extract vendor, date, and total"
```
Outputs `{total, errors, files}` with individual results per file.

### `scripts/extract.sh <path> <what_to_extract> [format]`
Forces structured output instead of free-form description.
- `format`: `json` (default) or `csv`
- Uses low temperature (0.1) for deterministic extraction
- Automatically strips markdown fences from model output
- Returns `{raw, format, data, prompt_tokens, completion_tokens}`
```
# Receipt → JSON
./scripts/extract.sh receipt.jpg "vendor, date, total, line items" json

# Table → CSV
./scripts/extract.sh spreadsheet.png "all rows and columns with headers" csv

# Invoice → JSON
./scripts/extract.sh invoice.pdf "invoice_number, vendor, date, due_date, line_items, subtotal, tax, total"
```

### `scripts/compare.sh <image1> <image2> [prompt]`
Feeds two images with labeling ("Image A" / "Image B") and asks for differences.
- Default prompt: "What are the differences? List every change."
- Uses reasoning mode ON for careful analysis
- Returns `{content, reasoning_content, prompt_tokens, completion_tokens}`
```
# UI regression testing
./scripts/compare.sh before-deploy.png after-deploy.png "What changed in the UI?"

# Photo comparison
./scripts/compare.sh photo1.jpg photo2.jpg "Describe all visual differences"
```

### `scripts/video_timeline.sh <path> [detail_level]`
Generates a scene-by-scene timeline with timestamps.
- `detail_level`: `brief` (one line per scene), `detailed` (action/subjects/audio per scene), or `keyframes` (3-8 most important moments)
- Default: `detailed`
- Always includes audio track
- Returns `{timeline, duration_seconds, detail_level, prompt_tokens, completion_tokens}`
```
# Full scene breakdown
./scripts/video_timeline.sh presentation.mp4 detailed

# Just the key moments
./scripts/video_timeline.sh talk.mp4 keyframes

# Quick summary
./scripts/video_timeline.sh clip.mp4 brief
```

### `scripts/describe.sh <path> [context] [max_length]`
Generates accessibility descriptions (alt text) for images, videos, or audio.
- `context`: `general` (default), `ecommerce`, `documentation`, `social`, `article`, `presentation`
- `max_length`: character limit (default: 250)
- Context tailors the description style and focus
- Returns `{alt_text, media_type, context, character_count, max_length, ...}`
```
# Product page alt text
./scripts/describe.sh product.jpg ecommerce 125

# Documentation screenshot
./scripts/describe.sh ui-screenshot.png documentation

# Video for social media
./scripts/describe.sh clip.mp4 social-media
```

### `scripts/read_code.sh <path> [language_hint]`
Reads code, stack traces, config files, or terminal output from a screenshot.
Returns clean, copy-pasteable text — no commentary.
- `language_hint`: optional (e.g., `python`, `yaml`, `rust`, `bash`). Helps formatting.
- Uses temperature 0.1 for exact reproduction
- Preserves indentation and line breaks
- Returns `{code, language_hint, line_count, ...}`
```
# Stack trace from screenshot
./scripts/read_code.sh error.jpg

# Python code with hint
./scripts/read_code.sh code.png python

# YAML config
./scripts/read_code.sh config.png yaml
```

### `scripts/classify.sh <path> [categories] [output_format]`
Classifies media content into categories with confidence scores.
- `categories`: comma-separated list (e.g., `"contract,invoice,letter,report"`). Leave empty for auto-classification.
- `output_format`: `json` (default) or `text`
- Works with images, audio, video, and PDFs
- Returns `{data: {category, confidence, reason}, media_type, ...}`
```
# Document type classification
./scripts/classify.sh scan.pdf "contract,invoice,letter,report,receipt"

# Image classification
./scripts/classify.sh photo.jpg "landscape,portrait,food,product,other" json

# Auto-classify (no category list)
./scripts/classify.sh mysterious.wav
```

### `scripts/meeting_notes.sh <audio_path> [slides_pdf_path] [language]`
Generate structured meeting notes from an audio recording, optionally with slides.
3-step chain: transcribe audio → analyze slides (if provided) → synthesize notes.
- Returns: Summary, Key Decisions, Action Items (with owners), Discussion Topics (with timestamps), Open Questions
- If slides are provided, includes slide references in the discussion
```
# Meeting with slides
./scripts/meeting_notes.sh meeting-recording.wav slides.pdf English

# Audio only
./scripts/meeting_notes.sh call-recording.mp3
```

### `scripts/qa_document.sh <path> <question> [detail_level] [pages]`
Ask questions against a PDF with full document context.
2-step chain: extract all pages → answer question using full context.
- `detail_level`: `summary` (default, 2-3 sentences per page) or `full` (complete text)
- `pages`: `all` (default), or comma-separated (e.g., `1,3,5`)
- If no question provided, returns page-by-page extraction only
- Always cites page numbers in answers: [Page N]
```
# Ask about specific info
./scripts/qa_document.sh report.pdf "What is the total revenue for Q4?"

# Full extraction of specific pages
./scripts/qa_document.sh contract.pdf "" full "1,2,3"

# Compare clauses
./scripts/qa_document.sh contract.pdf "What are the termination clauses?"
```

### `scripts/repurpose.sh <path> [formats] [tone] [language]`
Take a video or audio recording and generate multiple content formats.
2-step chain: transcribe/analyze media → generate each format separately.
- `formats`: comma-separated from `blog_post,social_thread,email_summary,key_quotes` (default: all)
- `tone`: `professional` (default), `casual`, `academic`, or `enthusiastic`
- `language`: output language (default: English)
```
# All formats from a video
./scripts/repurpose.sh talk.mp4

# Just blog + email, casual tone
./scripts/repurpose.sh podcast.mp3 "blog_post,email_summary" casual

# Social thread from video in Romanian
./scripts/repurpose.sh clip.mp4 "social_thread" professional "Romanian"
```

### `scripts/video_search_index.sh <path> [chunk_seconds] [topics]`
Build a searchable index from a video. Segments into time-based chunks, analyzes each chunk
(what's discussed, what's shown, topics, speakers, keywords), outputs a JSON index with timestamps.
Designed for feeding into a vector database for semantic search over video archives.
- `chunk_seconds`: granularity (default: 30). Shorter = more precise, longer = faster.
- `topics`: comma-separated topic list to tag against (optional, auto-detects if omitted)
- Max video: 600s (10 min)
```
# Index a podcast with 30s chunks
./scripts/video_search_index.sh podcast.mp4 30

# Index with topic tagging
./scripts/video_search_index.sh talk.mp4 60 "networking,AI,hardware,security"
```

### `scripts/analyze_chart.sh <path> [extract_data] [critique] [thinking]`
Analyze a chart, graph, or data visualization. Reads axes, scales, data series, trends, outliers.
Optional data extraction as structured JSON and visualization critique (misleading scales, hidden data, etc.).
- `extract_data`: `true`/`false` (default: true) — extract data points as JSON
- `critique`: `true`/`false` (default: false) — critique visualization quality
- `thinking`: `true`/`false` (default: true) — enable reasoning mode
```
# Full analysis with extraction
./scripts/analyze_chart.sh benchmark.png

# Analysis + critique
./scripts/analyze_chart.sh graph.png true true

# Quick analysis only
./scripts/analyze_chart.sh chart.jpg false false false
```

### `scripts/voice_intent.sh <path> [available_actions] [parameters_schema]`
Extract structured intent JSON from a voice command. Designed as the input layer for agentic workflows:
audio → intent JSON → dispatch to tool/skill.
- `available_actions`: comma-separated action list to map to (e.g., `'run_script,search_web,send_email'`)
- `parameters_schema`: JSON schema hint for expected params (e.g., `'{"script":"string","target":"string"}'`)
```
# With action list and schema
./scripts/voice_intent.sh command.wav "run_script,search_web" '{"script":"string","target":"string"}'

# Auto-detect intent without constraints
./scripts/voice_intent.sh question.wav
```

### `scripts/verify_output.sh <path> <claim> [strict] [media_type]`
Verify a claim or previous analysis against the actual source media. The "output guard" that re-examines
the media independently and checks every assertion for accuracy.
- `claim`: the text to verify (quote it!)
- `strict`: `true`/`false` (default: false) — flag approximations and inferences too
- `media_type`: `image`/`audio`/`video`/`document`/`auto` (default: auto-detect from extension)
```
# Verify an extraction
./scripts/verify_output.sh scan.png "This is an invoice for $42.50 from Acme Corp dated 2024-01-15"

# Strict verification of audio transcription
./scripts/verify_output.sh call.wav "The caller said 'deploy on Friday'" true audio

# Verify video description
./scripts/verify_output.sh clip.mp4 "The video shows a cat jumping over a fence" false video
```

## Reasoning mode defaults

The model has a "thinking" mode where it reasons before answering. The defaults are chosen per NVIDIA's guidance:

- **Image, Document, Compare**: Reasoning ON (deeper analysis worth the latency)
- **Audio, Video, Transcription, Extraction**: Reasoning OFF (speed and determinism matter more)
- **Multimodal (auto)**: OFF if video present, ON if image-only, OFF otherwise

Don't override these unless the user explicitly asks for deeper/simpler analysis.

## Tips for best results

**Images:**
- Be specific in prompts: "Read all text in this chart" not "what's this"
- For screenshots, mention "describe the UI elements and their layout"
- For charts/tables, ask for "exact values visible" to get numbers
- Use `extract.sh` when you need structured data, not `analyze_image.sh`

**Audio:**
- For transcription, always use `transcribe.sh` not `analyze_audio.sh` — it's tuned for accuracy
- Use `analyze_audio.sh` when the user wants summarization, Q&A, or analysis of content

**Video:**
- Always enable `with_audio=true` unless the user specifically says they only care about visuals
- For videos >2 min, explain the limit and offer to analyze key segments

**Documents:**
- Start with `aggregate=true` for a holistic summary
- For specific info extraction, target relevant pages to save time
- For tables/charts in PDFs, use the image analysis defaults (reasoning ON)
- Use `extract.sh` for receipts, invoices, forms — it enforces structured output

**Batch processing:**
- Works with any core script: `transcribe.sh`, `analyze_image.sh`, `analyze_audio.sh`, `analyze_video.sh`, `analyze_document.sh`
- Processes files alphabetically — no parallel execution (avoids overloading the GPU)
- Check results for individual errors in the output

**Comparison:**
- Both images must be the same type (jpg, png, etc.) but don't need to be the same size
- The model sees them as "Image A" and "Image B" — reference them that way in your prompt
- For more than 2 images, run multiple pairwise comparisons

**Chaining workflows:**
- Transcribe audio → then analyze the transcript as text for deeper insights
- Extract data from multiple pages → combine into a summary
- Compare before/after screenshots → then extract specific changed values
- Batch extract from receipts → combine into a spreadsheet

## Environment variables

All scripts read these from the environment (sensible defaults provided):

| Variable | Default |
|---|---|
| `NEMOTRON_OMNI_BASE_URL` | `http://localhost:8000/v1` |
| `NEMOTRON_OMNI_MODEL` | `nemotron_3_nano_omni` |
| `NEMOTRON_OMNI_PDF_DPI` | `150` |
| `NEMOTRON_OMNI_MAX_TOKENS` | `20480` |
