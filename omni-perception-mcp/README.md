# Omni Perception MCP Server

A TypeScript MCP server that exposes **NVIDIA Nemotron 3 Nano Omni** multimodal perception (image, audio, video, document analysis) as **7 MCP tools** over stdio transport, backed by a locally-served vLLM endpoint.

## Quick Start

### 1. Start vLLM

```bash
./scripts/serve.sh
```

This pulls and runs the vLLM container with the Nemotron 3 Nano Omni NVFP4 model on your DGX Spark. First run downloads ~21 GB weights.

### 2. Build & Install

```bash
pnpm install
pnpm build
```

### 3. Wire to Claude Code

Add to `~/.config/claude-code/mcp.json`:

```json
{
  "mcpServers": {
    "omni-perception": {
      "command": "node",
      "args": ["/path/to/omni-perception-mcp/dist/index.js"],
      "env": {
        "NEMOTRON_OMNI_BASE_URL": "http://localhost:8000/v1",
        "NEMOTRON_OMNI_ALLOWED_MEDIA_PATH": "/home/$USER"
      }
    }
  }
}
```

### 4. Use

Ask Claude Code: *"Use omni-perception to analyze /path/to/image.png and describe what's on screen."*

## Tools

### Core Analysis (7)

| Tool | Description | Reasoning Default |
|------|-------------|-------------------|
| `omni_health` | Probe vLLM server health | N/A |
| `analyze_image` | OCR, charts, scene description | ON (budget: 16384) |
| `analyze_audio` | Q&A / summary over audio | OFF |
| `transcribe_audio` | Pure ASR transcription | OFF |
| `analyze_video` | Video understanding (≤ 2 min) | OFF |
| `analyze_document` | PDF analysis (per-page + aggregate) | ON (budget: 16384) |
| `analyze_multimodal` | Cross-modal (1 image + 1 audio + 1 video) | Auto |

### Advanced Workflows (6)

| Tool | Description | Reasoning Default |
|------|-------------|-------------------|
| `compare_images` | Visual diff between two images | ON |
| `extract_data` | Structured JSON/CSV from images/PDFs | OFF |
| `video_timeline` | Scene-by-scene timestamped breakdown | OFF |
| `describe_media` | Alt text / accessibility descriptions | OFF |
| `read_code` | Clean code from screenshots | OFF |
| `classify_media` | Content classification with confidence | OFF |

### Multi-Call Workflows (3)

| Tool | Description | Calls |
|------|-------------|-------|
| `meeting_notes` | Audio + slides → structured notes with decisions, action items, timestamps | 2-5+ calls |
| `qa_document` | Ask questions against a PDF with full document context | 1 per page + 1 Q&A |
| `repurpose_content` | Video/audio → blog post + social thread + email + key quotes | 1 extract + 4 generate |

### Agent Building Blocks (4)

| Tool | Description | Inspiration |
|------|-------------|-------------|
| `video_search_index` | Segment video into chunks, generate per-chunk metadata, output searchable JSON index | Corey's podcast archive pipeline |
| `analyze_chart` | Chart/graph analysis: axes, data series, trends, outliers + optional visualization critique | Wendell's graph critique use case |
| `voice_intent` | Voice command → structured intent JSON. Maps to available actions with parameters | Wendell's voice-to-tool-calling pattern |
| `verify_output` | Verify a claim against source media. Flags hallucinations, corrections, missing details | The output guard both panelists described |

## Configuration

Set via environment variables:

| Variable | Default |
|----------|---------|
| `NEMOTRON_OMNI_BASE_URL` | `http://localhost:8000/v1` |
| `NEMOTRON_OMNI_MODEL` | `nemotron_3_nano_omni` |
| `NEMOTRON_OMNI_ALLOWED_MEDIA_PATH` | `$HOME` |
| `NEMOTRON_OMNI_DEFAULT_MAX_TOKENS` | `20480` |
| `NEMOTRON_OMNI_REQUEST_TIMEOUT_MS` | `600000` (10 min) |
| `NEMOTRON_OMNI_PDF_DPI` | `150` |
| `NEMOTRON_OMNI_LOG_LEVEL` | `info` |
| `NEMOTRON_OMNI_TMP_DIR` | `/tmp` |

## System Requirements

- **Node.js** ≥ 20.11
- **vLLM** container with Nemotron 3 Nano Omni
- **poppler-utils** (`pdftoppm` for PDF analysis): `sudo apt-get install poppler-utils`
- **ffmpeg** (`ffprobe` for media duration): `sudo apt-get install ffmpeg`
- **Hardware**: NVIDIA DGX Spark (GB10, 128 GB unified, ARM64) or compatible GPU

## Development

```bash
pnpm dev           # Dev mode with auto-reload
pnpm build         # Production build
pnpm test:unit     # Unit tests (no vLLM needed)
pnpm test:integration  # Integration tests (requires running vLLM; set INTEGRATION=1)
pnpm test:e2e      # End-to-end stdio tests
```

> **Note:** On systems without `pdftoppm`/`ffprobe`, set `SKIP_DEPENDENCY_CHECK=1` for testing.

## Architecture

```
Claude Code ──stdio──▶ omni-perception-mcp (Node.js)
                              │
                              │ HTTP /v1/chat/completions
                              ▼
                        vLLM Server (Docker)
                        Model: Nemotron-3-Nano-Omni-30B-A3B-Reasoning-NVFP4
```

## Known Limitations

- **English only** for audio/video (non-English performance undocumented)
- **Video max 2 minutes** / 256 frames at 1080p
- **Max 1 of each modality** per call (Spark serving limit)
- **No TTS** — text output only

## License

MIT
