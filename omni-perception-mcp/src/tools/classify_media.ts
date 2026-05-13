/**
 * Tool: classify_media
 * Classify/categorize media content with confidence scores.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniClient, ChatRequest } from "../client.js";
import { MediaHandler, toFileUri } from "../media.js";
import { PdfRenderer } from "../pdf.js";
import { withLogging } from "../tool-utils.js";
import type { Config } from "../config.js";

const InputSchema = z.object({
  path: z.string().describe("Absolute local path to image, audio, video, or PDF file"),
  categories: z
    .string()
    .optional()
    .describe("Comma-separated category list to choose from. Example: 'contract,invoice,letter,report'. Leave empty for auto-classification."),
  format: z
    .enum(["json", "text"])
    .optional()
    .describe("Output format (default: json)"),
});

function detectMediaType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "webp"].includes(ext)) return "image";
  if (ext === "mp4") return "video";
  if (["wav", "mp3"].includes(ext)) return "audio";
  if (ext === "pdf") return "document";
  return "media";
}

export function registerClassifyMedia(
  server: McpServer,
  client: OmniClient,
  media: MediaHandler,
  cfg: Config,
): void {
  const pdfRenderer = new PdfRenderer({ pdfDpi: cfg.pdfDpi, tmpDir: cfg.tmpDir });

  server.registerTool(
    "classify_media",
    {
      title: "Classify Media Content",
      description:
        "Classify or categorize media content with confidence scores. " +
        "Works with images, audio, video, and PDFs. " +
        "Provide a list of categories to choose from, or leave empty for auto-classification. " +
        "Returns the best category match, confidence score, and reasoning. " +
        "Use for document type detection, content moderation, genre classification, and routing pipelines.",
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withLogging("classify_media", async (params) => {
      const mediaType = detectMediaType(params.path);
      const format = params.format ?? "json";
      const ext = params.path.split(".").pop()?.toLowerCase() ?? "";

      let uri: string;
      let useAudioInVideo = false;
      let cleanup: (() => Promise<void>) | null = null;

      try {
        if (["jpg", "jpeg", "png", "webp"].includes(ext)) {
          uri = await media.assertImage(params.path);
        } else if (ext === "mp4") {
          uri = await media.assertVideo(params.path, 120);
          useAudioInVideo = true;
        } else if (["wav", "mp3"].includes(ext)) {
          uri = await media.assertAudio(params.path);
        } else if (ext === "pdf") {
          const pdfPath = await media.assertPdf(params.path);
          const rendered = await pdfRenderer.render(pdfPath, [1]);
          cleanup = rendered.cleanup;
          uri = toFileUri(rendered.pages[0]!.pngPath);
        } else {
          throw new Error(`Unsupported file type: ${ext}`);
        }

        // Build classification prompt
        let prompt: string;
        if (params.categories) {
          const catList = params.categories
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean)
            .map((c, i) => `${i + 1}. ${c}`)
            .join("\n");

          prompt =
            `Classify this ${mediaType} into exactly ONE of these categories:\n${catList}\n\n` +
            "Also provide:\n" +
            "- A confidence score from 0.0 to 1.0\n" +
            "- A one-line reason for the classification\n\n" +
            (format === "json"
              ? 'Output ONLY valid JSON: {"category": "...", "confidence": 0.0, "reason": "..."}'
              : "Output: CATEGORY (confidence: 0.0) - reason");
        } else {
          prompt =
            `Analyze this ${mediaType} and classify it.\n\n` +
            "Provide:\n" +
            "1. Primary category (what type of content is this?)\n" +
            "2. Sub-categories (more specific tags)\n" +
            "3. Content flags (e.g., contains_text, contains_people, contains_charts, is_screenshot, has_code)\n" +
            "4. A one-sentence summary\n\n" +
            (format === "json"
              ? 'Output ONLY valid JSON: {"category": "...", "sub_categories": [...], "flags": [...], "summary": "..."}'
              : "Provide structured classification.");
        }

        // Build content parts
        const parts: ChatRequest["parts"] = [];
        if (["jpg", "jpeg", "png", "webp"].includes(ext) || ext === "pdf") {
          parts.push({ type: "image_url", imageUrl: uri });
        } else if (ext === "mp4") {
          parts.push({ type: "video_url", videoUrl: uri });
        } else {
          parts.push({ type: "input_audio", audioUrl: uri });
        }
        parts.push({ type: "text", text: prompt });

        const req: ChatRequest = {
          parts,
          reasoning: { enableThinking: false },
          useAudioInVideo,
          maxTokens: 1024,
          temperature: 0.1,
        };

        const result = await client.chat(req);

        // Try JSON parse
        let data: unknown = null;
        let parseWarning: string | undefined;

        if (format === "json") {
          try {
            let cleaned = result.content.trim();
            if (cleaned.startsWith("```")) {
              cleaned = cleaned.split("\n").slice(1).join("\n");
              if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
              cleaned = cleaned.trim();
            }
            data = JSON.parse(cleaned);
          } catch {
            parseWarning = "Model did not return valid JSON";
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  data,
                  raw: result.content,
                  media_type: mediaType,
                  format,
                  ...(parseWarning ? { parse_warning: parseWarning } : {}),
                  duration_ms: result.durationMs,
                },
                null,
                2,
              ),
            },
          ],
        };
      } finally {
        await cleanup?.();
      }
    }),
  );
}
