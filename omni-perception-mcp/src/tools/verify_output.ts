/**
 * Tool: verify_output
 * The "output guard" — verify a claim or previous analysis against the actual media.
 * Takes media + a claim about it, checks accuracy, flags hallucinations.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniClient, ChatRequest } from "../client.js";
import { MediaHandler, toFileUri } from "../media.js";
import { PdfRenderer } from "../pdf.js";
import { withLogging } from "../tool-utils.js";
import type { Config } from "../config.js";

const InputSchema = z.object({
  path: z.string().describe("Absolute local path to the source media (image, audio, video, or PDF)"),
  claim: z.string().describe("The claim or previous analysis to verify against the media"),
  strict: z
    .boolean()
    .optional()
    .describe("Strict mode: flag any approximation, rounding, or inference (default: false)"),
  media_type: z
    .enum(["image", "audio", "video", "document"])
    .optional()
    .describe("Override media type detection. Usually auto-detected from file extension."),
});

export function registerVerifyOutput(
  server: McpServer,
  client: OmniClient,
  media: MediaHandler,
  cfg: Config,
): void {
  const pdfRenderer = new PdfRenderer({ pdfDpi: cfg.pdfDpi, tmpDir: cfg.tmpDir });

  server.registerTool(
    "verify_output",
    {
      title: "Verify Analysis Against Source Media",
      description:
        "Verify a claim or previous analysis against the actual source media. " +
        "Acts as the 'output guard' in an agentic pipeline: takes media + a claim about it, " +
        "re-examines the media independently, and checks every assertion for accuracy. " +
        "Returns a verification report with: verified facts, corrections, hallucinations found, " +
        "and an overall confidence score. Use to self-correct OCR, validate extractions, " +
        "or add a verification step to any multimodal pipeline.",
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withLogging("verify_output", async (params) => {
      const ext = params.path.split(".").pop()?.toLowerCase() ?? "";
      const strict = params.strict ?? false;

      let uri: string;
      let useAudioInVideo = false;
      let cleanup: (() => Promise<void>) | null = null;
      let detectedType: string;

      // Determine media type
      if (params.media_type) {
        detectedType = params.media_type;
      } else if (["jpg", "jpeg", "png", "webp"].includes(ext)) {
        detectedType = "image";
      } else if (ext === "mp4") {
        detectedType = "video";
      } else if (["wav", "mp3"].includes(ext)) {
        detectedType = "audio";
      } else if (ext === "pdf") {
        detectedType = "document";
      } else {
        throw new Error(`Unsupported file type: ${ext}`);
      }

      // Resolve URI
      if (detectedType === "image") {
        uri = await media.assertImage(params.path);
      } else if (detectedType === "video") {
        uri = await media.assertVideo(params.path, 120);
        useAudioInVideo = true;
      } else if (detectedType === "audio") {
        uri = await media.assertAudio(params.path);
      } else if (detectedType === "document") {
        const pdfPath = await media.assertPdf(params.path);
        const rendered = await pdfRenderer.render(pdfPath, [1]);
        cleanup = rendered.cleanup;
        uri = toFileUri(rendered.pages[0]!.pngPath);
        // For documents, treat as image for verification
        detectedType = "image";
      } else {
        throw new Error(`Unsupported media type: ${detectedType}`);
      }

      try {
        // ─── Verification prompt ──────────────────────────────────
        const verifyPrompt =
          "You are a verification engine. You will be shown media and a claim about it.\n" +
          "Your job is to independently examine the media and verify EVERY assertion in the claim.\n\n" +
          "For each assertion in the claim:\n" +
          "1. Check it against the media directly\n" +
          "2. Mark it as: VERIFIED ✅, CORRECTED ⚠️ (with the right value), or HALLUCINATION ❌\n\n" +
          (strict
            ? "STRICT MODE: Flag ANY approximation, rounding, inference, or guess as CORRECTED.\n\n"
            : "") +
          `Claim to verify:\n---\n${params.claim}\n---\n\n` +
          "Output ONLY valid JSON:\n" +
          "{\n" +
          '  "verified_facts": ["fact that was confirmed correct"],\n' +
          '  "corrections": [{"original": "what was claimed", "correct": "what it actually is", "severity": "minor|major"}],\n' +
          '  "hallucinations": ["claims that have no basis in the media"],\n' +
          '  "missing_details": ["important things in the media that the claim missed"],\n' +
          '  "overall_accuracy": 0.0,\n' +
          '  "confidence": 0.0,\n' +
          '  "summary": "one sentence verdict"\n' +
          "}";

        // Build content parts
        const parts: ChatRequest["parts"] = [];
        if (detectedType === "image") {
          parts.push({ type: "image_url", imageUrl: uri });
        } else if (detectedType === "video") {
          parts.push({ type: "video_url", videoUrl: uri });
        } else {
          parts.push({ type: "input_audio", audioUrl: uri });
        }
        parts.push({ type: "text", text: verifyPrompt });

        const req: ChatRequest = {
          parts,
          reasoning: { enableThinking: true, reasoningBudget: 8192 },
          useAudioInVideo,
          maxTokens: 4096,
          topP: 0.95,
        };

        const result = await client.chat(req);

        // Parse the verification JSON
        let verification: unknown = null;
        let parseWarning: string | undefined;

        try {
          let cleaned = result.content.trim();
          if (cleaned.startsWith("```")) {
            cleaned = cleaned.split("\n").slice(1).join("\n");
            if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
            cleaned = cleaned.trim();
          }
          verification = JSON.parse(cleaned);
        } catch {
          parseWarning = "Model did not return valid JSON";
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  verification,
                  reasoning_content: result.reasoningContent,
                  ...(parseWarning ? { raw: result.content, parse_warning: parseWarning } : {}),
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
