/**
 * Tool: analyze_video
 * Video understanding (mp4 ≤ 2 min). Optionally include audio track.
 * Implements: R4.1, R4.2, R4.3, R4.4
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniClient, ChatRequest } from "../client.js";
import { MediaHandler } from "../media.js";
import { defaultsFor, mergeReasoning } from "../reasoning.js";
import { withLogging } from "../tool-utils.js";

const InputSchema = z.object({
  path: z.string().describe("Absolute local path to video file (.mp4). Max duration: 120s (2 minutes)"),
  prompt: z.string().min(1).describe("What to analyze in the video"),
  with_audio: z.boolean().optional().describe("Include audio track from video (default: true)"),
  thinking: z.boolean().optional().describe("Enable reasoning mode (default: false)"),
  fps: z.number().positive().optional().describe("Frames per second to sample (default: server-level 2)"),
  num_frames: z.number().int().positive().optional().describe("Max number of frames (default: server-level 256)"),
  max_tokens: z.number().int().positive().optional().describe("Max output tokens (default: 20480)"),
});

export function registerAnalyzeVideo(
  server: McpServer,
  client: OmniClient,
  media: MediaHandler,
): void {
  server.registerTool(
    "analyze_video",
    {
      title: "Analyze Video",
      description:
        "Analyze a video file using the Nemotron Omni model. Supports visual understanding, " +
        "action description, and optionally audio transcription from the video's audio track. " +
        "Max duration: 120 seconds. Reasoning mode OFF by default for speed.",
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    withLogging("analyze_video", async (params) => {
      const uri = await media.assertVideo(params.path, 120);
      const defaults = defaultsFor("video");
      const reasoning = mergeReasoning(defaults, params.thinking);
      const useAudio = params.with_audio !== false; // default true (R4.2)

      const req: ChatRequest = {
        parts: [
          { type: "video_url", videoUrl: uri },
          { type: "text", text: params.prompt },
        ],
        reasoning,
        useAudioInVideo: useAudio,
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
