/**
 * Tool: analyze_image
 * OCR, chart reading, scene description, GUI screenshot interpretation.
 * Reasoning ON by default.
 * Implements: R2.1, R2.2, R2.3, R2.4, R7.1, R7.2, R7.3
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniClient, ChatRequest } from "../client.js";
import { MediaHandler } from "../media.js";
import { defaultsFor, mergeReasoning } from "../reasoning.js";
import { withLogging } from "../tool-utils.js";

const InputSchema = z.object({
  path: z.string().describe("Absolute local path to image file (.jpg, .jpeg, .png, .webp)"),
  prompt: z.string().min(1).describe("What to analyze/describe in the image"),
  thinking: z.boolean().optional().describe("Enable reasoning mode (default: true)"),
  reasoning_budget: z.number().int().positive().optional().describe("Max reasoning tokens (default: 16384)"),
  max_tokens: z.number().int().positive().optional().describe("Max output tokens (default: 20480)"),
});

export function registerAnalyzeImage(
  server: McpServer,
  client: OmniClient,
  media: MediaHandler,
): void {
  server.registerTool(
    "analyze_image",
    {
      title: "Analyze Image",
      description:
        "Analyze an image using the Nemotron Omni model. Supports OCR, chart reading, " +
        "scene description, GUI screenshot interpretation, and visual reasoning. " +
        "Reasoning mode is ON by default for deeper analysis.",
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    withLogging("analyze_image", async (params) => {
      const uri = await media.assertImage(params.path);
      const defaults = defaultsFor("image");
      const reasoning = mergeReasoning(
        defaults,
        params.thinking,
        params.reasoning_budget,
      );

      const req: ChatRequest = {
        parts: [
          { type: "image_url", imageUrl: uri },
          { type: "text", text: params.prompt },
        ],
        reasoning,
        maxTokens: params.max_tokens,
        topP: reasoning.enableThinking ? 0.95 : undefined,
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
