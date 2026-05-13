/**
 * Tool: meeting_notes
 * Multi-call workflow: transcribe audio + analyze slides PDF → structured meeting notes.
 * Chains: transcribe_audio → analyze_document (if slides) → synthesize into structured notes.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniClient, ChatRequest } from "../client.js";
import { MediaHandler, toFileUri } from "../media.js";
import { PdfRenderer } from "../pdf.js";
import { defaultsFor, mergeReasoning } from "../reasoning.js";
import { withLogging } from "../tool-utils.js";
import type { Config } from "../config.js";

const InputSchema = z.object({
  audio_path: z.string().describe("Absolute local path to meeting audio recording (.wav, .mp3)"),
  slides_path: z
    .string()
    .optional()
    .describe("Absolute local path to slides PDF (optional). Pass if slides were shared."),
  language: z.string().optional().describe("Language hint (default: English). Example: 'en', 'ro'"),
});

export function registerMeetingNotes(
  server: McpServer,
  client: OmniClient,
  media: MediaHandler,
  cfg: Config,
): void {
  const pdfRenderer = new PdfRenderer({ pdfDpi: cfg.pdfDpi, tmpDir: cfg.tmpDir });

  server.registerTool(
    "meeting_notes",
    {
      title: "Generate Structured Meeting Notes",
      description:
        "Generate structured meeting notes from an audio recording, optionally combined with slides. " +
        "Transcribes the audio, analyzes slides (if provided), then synthesizes into structured notes with: " +
        "key decisions, action items with owners, timestamped discussion topics, and slide references. " +
        "This is a multi-call workflow — it chains transcription, slide analysis, and synthesis into one result.",
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    withLogging("meeting_notes", async (params) => {
      // ─── Step 1: Transcribe audio ────────────────────────────────
      const audioUri = await media.assertAudio(params.audio_path, 3600);

      const langSuffix = params.language ? ` Language: ${params.language}.` : "";
      const transcribeReq: ChatRequest = {
        parts: [
          { type: "input_audio", audioUrl: audioUri },
          { type: "text", text: `Transcribe this meeting audio in full detail.${langSuffix} Include who is speaking when identifiable.` },
        ],
        reasoning: { enableThinking: false },
        temperature: 0.2,
        topK: 1,
        maxTokens: 20480,
      };

      const transcript = await client.chat(transcribeReq);

      // ─── Step 2: Analyze slides (if provided) ────────────────────
      let slideSummaries: string | undefined;
      if (params.slides_path) {
        const pdfPath = await media.assertPdf(params.slides_path);
        const rendered = await pdfRenderer.render(pdfPath, "all");

        try {
          const defaults = defaultsFor("document");
          const reasoning = mergeReasoning(defaults, false);
          const pageParts: string[] = [];

          for (const page of rendered.pages) {
            const uri = toFileUri(page.pngPath);
            const req: ChatRequest = {
              parts: [
                { type: "image_url", imageUrl: uri },
                { type: "text", text: `Slide ${page.pageNumber}. Provide a concise 1-2 sentence summary of this slide's content.` },
              ],
              reasoning,
              maxTokens: 512,
            };
            const result = await client.chat(req);
            pageParts.push(`Slide ${page.pageNumber}: ${result.content.trim()}`);
          }

          slideSummaries = pageParts.join("\n");
        } finally {
          await rendered.cleanup();
        }
      }

      // ─── Step 3: Synthesize into structured notes ────────────────
      const contextParts: string[] = [
        "## Meeting Transcript",
        transcript.content,
      ];

      if (slideSummaries) {
        contextParts.push("", "## Slides Referenced", slideSummaries);
      }

      const fullContext = contextParts.join("\n");

      const synthesisReq: ChatRequest = {
        parts: [
          {
            type: "text",
            text:
              `You are a meeting notes assistant. Based on the following meeting data, produce structured notes.\n\n` +
              `${fullContext}\n\n` +
              `Produce the notes in this EXACT format:\n\n` +
              `# Meeting Notes\n\n` +
              `## Summary\n(2-3 sentence executive summary)\n\n` +
              `## Key Decisions\n( numbered list — each decision on its own line with who decided)\n\n` +
              `## Action Items\n( numbered list — each item with owner and deadline if mentioned)\n\n` +
              `## Discussion Topics\n` +
              `(numbered list with timestamps if identifiable — format: [MM:SS] Topic)\n\n` +
              (slideSummaries ? `## Slide References\n(when a discussion topic relates to a specific slide, note it)\n\n` : "") +
              `## Open Questions\n(unresolved questions or topics that need follow-up)\n\n` +
              `Be thorough and specific. Extract actual names, numbers, and commitments — do not summarize vaguely.`,
          },
        ],
        reasoning: { enableThinking: true, reasoningBudget: 16384 },
        maxTokens: 8192,
        topP: 0.95,
      };

      const notes = await client.chat(synthesisReq);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                notes: notes.content,
                reasoning_content: notes.reasoningContent,
                transcript: transcript.content,
                ...(slideSummaries ? { slide_summaries: slideSummaries } : {}),
                duration_ms: transcript.durationMs + notes.durationMs,
              },
              null,
              2,
            ),
          },
        ],
      };
    }),
  );
}
