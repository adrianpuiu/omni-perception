/**
 * Tool: video_timeline
 * Generate a scene-by-scene timeline breakdown of a video.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniClient, ChatRequest } from "../client.js";
import { MediaHandler } from "../media.js";
import { withLogging } from "../tool-utils.js";

const InputSchema = z.object({
  path: z.string().describe("Absolute local path to video file (.mp4, max 120s)"),
  detail: z
    .enum(["brief", "detailed", "keyframes"])
    .optional()
    .describe("Detail level: brief (one line per scene), detailed (action/subjects/audio), keyframes (3-8 top moments). Default: detailed"),
  max_tokens: z.number().int().positive().optional().describe("Max output tokens (default: 20480)"),
});

export function registerVideoTimeline(
  server: McpServer,
  client: OmniClient,
  media: MediaHandler,
): void {
  server.registerTool(
    "video_timeline",
    {
      title: "Video Timeline Breakdown",
      description:
        "Generate a scene-by-scene timeline of a video with timestamps. " +
        "Three detail levels: 'brief' (one line per scene), 'detailed' (action/subjects/audio per scene), " +
        "'keyframes' (3-8 most important moments only). " +
        "Always includes the audio track. Max video duration: 120 seconds.",
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withLogging("video_timeline", async (params) => {
      const uri = await media.assertVideo(params.path, 120);
      const detail = params.detail ?? "detailed";

      const prompts: Record<string, string> = {
        brief:
          "Analyze this video and provide a brief scene-by-scene timeline.\n" +
          'For each scene, output one line: [MM:SS - MM:SS] One-sentence description.\n' +
          "Keep descriptions under 15 words. Focus on key actions and transitions.",
        detailed:
          "Analyze this video and provide a detailed scene-by-scene timeline.\n" +
          "For each scene:\n" +
          "## Scene N [MM:SS - MM:SS]\n" +
          "- **Action**: What is happening\n" +
          "- **Subjects**: People, objects, or text visible\n" +
          "- **Audio**: Speech, music, or sounds heard\n\n" +
          "Be thorough. Note all visual changes, camera movements, on-screen text, and audio.",
        keyframes:
          "Analyze this video and identify the KEY MOMENTS — the most important things that happen.\n" +
          "For each key moment:\n" +
          "### [MM:SS] — Title\n" +
          "2-3 sentences describing what happens and why it matters.\n\n" +
          "Focus on dramatic changes, important actions, on-screen text, and speech content.\n" +
          "Only list 3-8 key moments.",
      };

      const req: ChatRequest = {
        parts: [
          { type: "video_url", videoUrl: uri },
          { type: "text", text: prompts[detail] ?? prompts.detailed },
        ],
        reasoning: { enableThinking: false },
        useAudioInVideo: true,
        maxTokens: params.max_tokens,
      };

      const result = await client.chat(req);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                timeline: result.content,
                detail_level: detail,
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
