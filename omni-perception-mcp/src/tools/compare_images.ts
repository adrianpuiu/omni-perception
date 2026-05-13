/**
 * Tool: compare_images
 * Compare two images and describe the differences.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniClient, ChatRequest } from "../client.js";
import { MediaHandler } from "../media.js";
import { withLogging } from "../tool-utils.js";

const InputSchema = z.object({
  image_a: z.string().describe("Absolute local path to the first image (Image A)"),
  image_b: z.string().describe("Absolute local path to the second image (Image B)"),
  prompt: z
    .string()
    .optional()
    .describe("What to compare (default: 'What are the differences? List every change.')"),
  thinking: z.boolean().optional().describe("Enable reasoning mode (default: true)"),
  max_tokens: z.number().int().positive().optional().describe("Max output tokens (default: 20480)"),
});

export function registerCompareImages(
  server: McpServer,
  client: OmniClient,
  media: MediaHandler,
): void {
  server.registerTool(
    "compare_images",
    {
      title: "Compare Two Images",
      description:
        "Compare two images side-by-side and describe the visual differences. " +
        "Labels them as 'Image A' and 'Image B' for clear reference. " +
        "Use for UI regression testing, before/after comparisons, document revision tracking, " +
        "security camera diffs, or any visual change detection.",
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    withLogging("compare_images", async (params) => {
      const uriA = await media.assertImage(params.image_a);
      const uriB = await media.assertImage(params.image_b);

      const prompt =
        params.prompt ??
        "What are the differences between these two images? List every change you can find.";

      const req: ChatRequest = {
        parts: [
          { type: "text", text: "I am showing you two images. The first image (Image A) and the second image (Image B)." },
          { type: "image_url", imageUrl: uriA },
          { type: "text", text: "Above is Image A. Below is Image B." },
          { type: "image_url", imageUrl: uriB },
          { type: "text", text: prompt },
        ],
        reasoning: {
          enableThinking: params.thinking ?? true,
          ...(params.thinking !== false ? { reasoningBudget: 16384 } : {}),
        },
        maxTokens: params.max_tokens,
        topP: params.thinking !== false ? 0.95 : undefined,
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
