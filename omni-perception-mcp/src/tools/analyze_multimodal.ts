/**
 * Tool: analyze_multimodal
 * The full omni primitive. At most one of each modality (Spark serving limit).
 * Auto-picks reasoning mode.
 * Implements: R6.1, R6.2, R6.3
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniClient, ChatRequest } from "../client.js";
import { MediaHandler } from "../media.js";
import { autoResolveThinking, mergeReasoning } from "../reasoning.js";
import { withLogging } from "../tool-utils.js";

const InputSchema = z
  .object({
    prompt: z.string().min(1).describe("The question or instruction about the provided media"),
    image_path: z.string().optional().describe("Absolute local path to an image file"),
    audio_path: z.string().optional().describe("Absolute local path to an audio file"),
    video_path: z.string().optional().describe("Absolute local path to a video file (.mp4, max 120s)"),
    thinking: z
      .union([z.boolean(), z.literal("auto")])
      .optional()
      .describe("Enable reasoning: true, false, or 'auto' (default: 'auto')"),
    with_audio_in_video: z
      .boolean()
      .optional()
      .describe("Include audio track when analyzing video (default: true)"),
    max_tokens: z.number().int().positive().optional().describe("Max output tokens (default: 20480)"),
  })
  .refine(
    (d) => d.image_path || d.audio_path || d.video_path,
    {
      message:
        "At least one of image_path, audio_path, or video_path is required. " +
        "Use a text-only LLM for pure text prompts.",
    },
  );

export function registerAnalyzeMultimodal(
  server: McpServer,
  client: OmniClient,
  media: MediaHandler,
): void {
  server.registerTool(
    "analyze_multimodal",
    {
      title: "Analyze Multimodal",
      description:
        "Analyze multiple modalities (image, audio, video) in a single call. " +
        "At most ONE of each modality per call (Spark serving limit). " +
        "Automatically selects optimal reasoning mode based on provided modalities. " +
        "This is the full omni primitive for cross-modal reasoning.",
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    withLogging("analyze_multimodal", async (params) => {
      const hasImage = !!params.image_path;
      const hasAudio = !!params.audio_path;
      const hasVideo = !!params.video_path;

      // Resolve reasoning (R6.3)
      let reasoning;
      if (params.thinking === "auto" || params.thinking === undefined) {
        reasoning = autoResolveThinking(hasImage, hasAudio, hasVideo);
      } else {
        reasoning = mergeReasoning(
          autoResolveThinking(hasImage, hasAudio, hasVideo),
          params.thinking,
        );
      }

      // Build content parts
      const parts: ChatRequest["parts"] = [];

      if (params.image_path) {
        const uri = await media.assertImage(params.image_path);
        parts.push({ type: "image_url", imageUrl: uri });
      }

      if (params.audio_path) {
        const uri = await media.assertAudio(params.audio_path);
        parts.push({ type: "input_audio", audioUrl: uri });
      }

      if (params.video_path) {
        const uri = await media.assertVideo(params.video_path, 120);
        parts.push({ type: "video_url", videoUrl: uri });
      }

      parts.push({ type: "text", text: params.prompt });

      const useAudioInVideo =
        params.with_audio_in_video !== false && hasVideo;

      const req: ChatRequest = {
        parts,
        reasoning,
        useAudioInVideo,
        maxTokens: params.max_tokens,
      };

      const result = await client.chat(req);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                content: result.content,
                reasoning_content: result.reasoningContent,
                duration_ms: result.durationMs,
                ...(result.warning ? { warning: result.warning } : {}),
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
