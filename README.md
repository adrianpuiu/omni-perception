# Omni Perception

Multimodal AI perception powered by [NVIDIA Nemotron 3 Nano Omni](https://build.nvidia.com/nvidia/nemotron-3-nano-omni-30b-a3b) — a single model that sees, hears, reads, and understands images, audio, video, and PDFs.

Two packages, one model:

- **`omni-perception-mcp/`** — TypeScript MCP server with 20 tools over stdio
- **`omni-perception-skill/`** — Standalone skill with 21 bash scripts, no Node.js required

Both connect to a local [vLLM](https://github.com/vllm-project/vllm) endpoint serving Nemotron 3 Nano Omni. No cloud API keys. No per-token costs. Runs entirely on your hardware.

## What it can do

| Modality | Capabilities |
|---|---|
| **Images** | OCR, chart analysis, code from screenshots, alt text, visual diffs, classification, structured data extraction |
| **Audio** | Transcription, audio Q&A, voice intent parsing (voice command → JSON) |
| **Video** | Scene understanding, timestamped timelines, searchable video indexing |
| **Documents** | PDF analysis (per-page + aggregate), document Q&A with page citations, structured extraction |
| **Workflows** | Meeting notes (audio + slides), content repurposing (video → blog + social + email), output verification |

## Architecture

```
┌──────────────┐     ┌───────────────┐     ┌─────────────────────┐
│  MCP Client  │────▶│  MCP Server   │────▶│                     │
│ (Claude, etc)│     │ (20 tools)    │     │  vLLM + Nemotron    │
└──────────────┘     └───────────────┘     │  3 Nano Omni        │
                                          │  (NVIDIA GPU)       │
┌──────────────┐     ┌───────────────┐     │                     │
│  Agent / CLI │────▶│  Bash Scripts │────▶│  ~21GB NVFP4        │
│              │     │ (21 scripts)  │     └─────────────────────┘
└──────────────┘     └───────────────┘
```

## Quick start

### 1. Start vLLM

```bash
# Pull and serve the model (requires NVIDIA GPU)
vllm serve nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-NVFP4 \
  --max-model-len 4096 --gpu-memory-utilization 0.9
```

### 2. Pick your interface

#### MCP Server (for Claude Code, Cursor, etc.)

```bash
cd omni-perception-mcp
pnpm install && pnpm build

# Add to your MCP config:
# ~/.config/claude-code/mcp.json
{
  "mcpServers": {
    "omni-perception": {
      "command": "node",
      "args": ["/path/to/omni-perception-mcp/dist/index.js"],
      "env": {
        "NEMOTRON_OMNI_BASE_URL": "http://localhost:8000/v1"
      }
    }
  }
}
```

#### Skill (for pi, any agent, or plain CLI)

```bash
# No install needed — just run scripts directly
cd omni-perception-skill

# Check the server is up
./scripts/health.sh

# Analyze an image
./scripts/analyze_image.sh screenshot.png "What's on screen?"

# Transcribe audio
./scripts/transcribe.sh recording.wav

# Extract data from a receipt
./scripts/extract.sh receipt.jpg "vendor, date, total, line items" json
```

## 20 MCP Tools

### Core Analysis (7)

| Tool | Description |
|---|---|
| `omni_health` | Probe vLLM server health |
| `analyze_image` | OCR, charts, scene description |
| `analyze_audio` | Q&A over audio |
| `transcribe_audio` | Speech-to-text |
| `analyze_video` | Video understanding (≤2 min) |
| `analyze_document` | PDF analysis (per-page + aggregate) |
| `analyze_multimodal` | Cross-modal (image + audio + video) |

### Advanced Workflows (6)

| Tool | Description |
|---|---|
| `compare_images` | Visual diff between two images |
| `extract_data` | Structured JSON/CSV from images & PDFs |
| `video_timeline` | Timestamped scene breakdown |
| `describe_media` | Alt text / accessibility descriptions |
| `read_code` | Clean code from screenshots |
| `classify_media` | Content classification with confidence |

### Multi-Call Workflows (3)

| Tool | Description |
|---|---|
| `meeting_notes` | Audio + slides → structured notes with decisions, action items, timestamps |
| `qa_document` | Ask questions against a PDF with page citations |
| `repurpose_content` | Video/audio → blog + social thread + email + key quotes |

### Agent Building Blocks (4)

| Tool | Description |
|---|---|
| `video_search_index` | Segment video into chunks, build searchable JSON index |
| `analyze_chart` | Chart analysis with data extraction + visualization critique |
| `voice_intent` | Voice command → structured intent JSON for tool dispatch |
| `verify_output` | Fact-check claims against source media, flag hallucinations |

## 21 Bash Scripts

All scripts in `omni-perception-skill/scripts/` — require only `curl` and `python3`.

| Script | One-liner |
|---|---|
| `health.sh` | Check if vLLM is running |
| `analyze_image.sh` | Analyze/describe images |
| `analyze_audio.sh` | Q&A over audio |
| `transcribe.sh` | Speech-to-text |
| `analyze_video.sh` | Video understanding |
| `analyze_document.sh` | PDF analysis |
| `analyze_multimodal.sh` | Cross-modal analysis |
| `batch.sh` | Process all files in a directory |
| `extract.sh` | Structured data extraction (JSON/CSV) |
| `compare.sh` | Visual diff between two images |
| `video_timeline.sh` | Timestamped scene breakdown |
| `describe.sh` | Alt text / accessibility descriptions |
| `read_code.sh` | Code from screenshots |
| `classify.sh` | Content classification |
| `meeting_notes.sh` | Audio + slides → structured notes |
| `qa_document.sh` | Q&A against a PDF |
| `repurpose.sh` | Video/audio → multiple content formats |
| `video_search_index.sh` | Searchable video index |
| `analyze_chart.sh` | Chart/graph analysis + critique |
| `voice_intent.sh` | Voice command → intent JSON |
| `verify_output.sh` | Verify claims against media |

## Configuration

Both packages share the same environment variables:

| Variable | Default | Description |
|---|---|---|
| `NEMOTRON_OMNI_BASE_URL` | `http://localhost:8000/v1` | vLLM endpoint URL |
| `NEMOTRON_OMNI_MODEL` | `nemotron_3_nano_omni` | Model identifier |
| `NEMOTRON_OMNI_ALLOWED_MEDIA_PATH` | `$HOME` | Allowed media directory |
| `NEMOTRON_OMNI_DEFAULT_MAX_TOKENS` | `20480` | Default max output tokens |
| `NEMOTRON_OMNI_PDF_DPI` | `150` | PDF rendering DPI |

## Requirements

- **Hardware**: NVIDIA GPU with ≥24GB VRAM (DGX Spark, RTX 3090/4090, RTX 6000 Ada, etc.)
- **Software**: vLLM, Node.js ≥20 (MCP only), `pdftoppm` (PDF analysis), `ffprobe` (video duration)
- **Model**: `nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-NVFP4` (~21GB)

## License

MIT
