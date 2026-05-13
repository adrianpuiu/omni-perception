/**
 * Tool: describe_media
 * Generate accessibility descriptions (alt text) for images, videos, or audio.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniClient, ChatRequest } from "../client.js";
import { MediaHandler } from "../media.js";
import { withLogging } from "../tool-utils.js";

const InputSchema = z.object({
  path: z.string().describe("Absolute local path to image, video, or audio file"),
  context: z
    .enum(["general", "ecommerce", "documentation", "social", "article", "presentation"])
    .optional()
    .describe("Context for the description (default: general)"),
  max_length: z.number().int().positive().optional().describe("Max character length for the description (default: 250)"),
});

const CONTEXT_PROMPTS: Record<string, (mediaType: string, maxLen: number) => string> = {
  general: (m, n) =>
    `Write clear, concise alt text for this ${m}. Describe what is shown so someone who cannot see/hear it would understand it. Maximum ${n} characters. Rules: Do NOT start with 'Image of', 'Photo of', 'Video of'. Be specific: name objects, colors, actions, text, people, settings.`,
  ecommerce: (m, n) =>
    `Write alt text for this ${m} for an e-commerce product page. Describe the product, its appearance, color, and key visual details. Maximum ${n} characters. Do not start with 'Image of' or 'Photo of'.`,
  documentation: (m, n) =>
    `Write alt text for this ${m} for technical documentation. Describe the UI elements, layout, data, and any text visible. Maximum ${n} characters. Be precise and factual.`,
  social: (m, n) =>
    `Write alt text for this ${m} for a social media post. Make it engaging but descriptive. Cover the main subject and mood. Maximum ${n} characters. Do not start with 'Image of'.`,
  article: (m, n) =>
    `Write alt text for this ${m} for a news article or blog post. Describe what is shown in a way that adds context to the article. Maximum ${n} characters.`,
  presentation: (m, n) =>
    `Write alt text for this ${m} for a presentation slide. Describe charts, graphs, diagrams, and key text. Note data points and trends. Maximum ${n} characters.`,
};

function detectMediaType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "webp"].includes(ext)) return "image";
  if (ext === "mp4") return "video";
  if (["wav", "mp3"].includes(ext)) return "audio";
  return "media";
}

export function registerDescribeMedia(
  server: McpServer,
  client: OmniClient,
  media: MediaHandler,
): void {
  server.registerTool(
    "describe_media",
    {
      title: "Generate Accessibility Description (Alt Text)",
      description:
        "Generate alt text or accessibility descriptions for images, videos, or audio. " +
        "Context-aware: adapts output style for ecommerce, documentation, social media, articles, or presentations. " +
        "Useful for web accessibility (WCAG), social media posts, product catalogs, and documentation.",
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withLogging("describe_media", async (params) => {
      const context = params.context ?? "general";
      const maxLength = params.max_length ?? 250;
      const mediaType = detectMediaType(params.path);

      // Resolve URI based on media type
      let uri: string;
      let useAudioInVideo = false;
      const ext = params.path.split(".").pop()?.toLowerCase() ?? "";

      if (["jpg", "jpeg", "png", "webp"].includes(ext)) {
        uri = await media.assertImage(params.path);
      } else if (ext === "mp4") {
        uri = await media.assertVideo(params.path, 120);
        useAudioInVideo = true;
      } else if (["wav", "mp3"].includes(ext)) {
        uri = await media.assertAudio(params.path);
      } else {
        throw new Error(`Unsupported file type: ${ext}`);
      }

      const promptFn = CONTEXT_PROMPTS[context] ?? CONTEXT_PROMPTS.general;
      const prompt = promptFn(mediaType, maxLength);

      // Build content parts based on media type
      const parts: ChatRequest["parts"] = [];
      if (mediaType === "image") {
        parts.push({ type: "image_url", imageUrl: uri });
      } else if (mediaType === "video") {
        parts.push({ type: "video_url", videoUrl: uri });
      } else {
        parts.push({ type: "input_audio", audioUrl: uri });
      }
      parts.push({ type: "text", text: prompt });

      const req: ChatRequest = {
        parts,
        reasoning: { enableThinking: false },
        useAudioInVideo,
        maxTokens: 512,
        temperature: 0.2,
      };

      const result = await client.chat(req);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                alt_text: result.content.trim(),
                media_type: mediaType,
                context,
                character_count: result.content.trim().length,
                max_length: maxLength,
                duration_ms: result.durationMs,
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
