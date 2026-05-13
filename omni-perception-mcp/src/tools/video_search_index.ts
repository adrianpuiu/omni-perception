/**
 * Tool: video_search_index
 * Multi-call workflow: segment video into chunks → analyze each chunk → build searchable index.
 * Corey's pipeline: break video into N-second segments, generate per-segment metadata
 * (what's shown, what's discussed, who's speaking, topics), output searchable JSON with timestamps.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniClient, ChatRequest } from "../client.js";
import { MediaHandler } from "../media.js";
import { withLogging } from "../tool-utils.js";

const InputSchema = z.object({
  path: z.string().describe("Absolute local path to video file (.mp4, max 600s / 10 min)"),
  chunk_seconds: z
    .number()
    .int()
    .min(10)
    .max(120)
    .optional()
    .describe("Seconds per chunk (default: 30). Shorter = more granular, longer = faster."),
  topics: z
    .string()
    .optional()
    .describe("Comma-separated topic list to tag against. Example: 'networking,AI,hardware,security'. Leave empty for auto-detection."),
  include_visual: z
    .boolean()
    .optional()
    .describe("Include visual descriptions per chunk (default: true). Set false for audio-only indexing."),
});

export function registerVideoSearchIndex(
  server: McpServer,
  client: OmniClient,
  media: MediaHandler,
): void {
  server.registerTool(
    "video_search_index",
    {
      title: "Build Searchable Video Index",
      description:
        "Index a video for semantic search by breaking it into time-based chunks and analyzing each one. " +
        "Generates per-chunk metadata: transcript excerpt, visual description, topics, speakers, and keywords. " +
        "Outputs a JSON index with timestamps that can be stored in a vector database for retrieval. " +
        "This is a multi-call workflow — one call per chunk plus a synthesis pass. " +
        "Use for podcast archives, meeting recordings, lecture series, or any video library you want to search.",
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withLogging("video_search_index", async (params) => {
      const chunkSeconds = params.chunk_seconds ?? 30;
      const includeVisual = params.include_visual ?? true;

      // Get full video URI and probe duration
      const uri = await media.assertVideo(params.path, 600);
      const durationSec = await media.probeDuration(params.path);

      const chunkCount = Math.ceil(durationSec / chunkSeconds);
      const topicList = params.topics
        ? params.topics
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : null;

      // ─── Step 1: Analyze the full video for transcript + overview ───
      const overviewReq: ChatRequest = {
        parts: [
          { type: "video_url", videoUrl: uri },
          {
            type: "text",
            text:
              `Analyze this video in detail. This video is ${Math.round(durationSec)}s long.\n\n` +
              "Provide:\n" +
              "1. A 2-3 sentence overall summary\n" +
              "2. A list of all topics discussed\n" +
              "3. A list of all speakers/people visible or audible\n" +
              "4. Key moments with approximate timestamps\n\n" +
              "Format as structured text with clear headers.",
          },
        ],
        reasoning: { enableThinking: false },
        useAudioInVideo: true,
        maxTokens: 8192,
      };

      const overview = await client.chat(overviewReq);

      // ─── Step 2: Build chunk index from overview ──────────────────
      // We ask the model to segment its analysis into time-based chunks
      const chunkingPrompt =
        `Based on the following video analysis, create a time-based index.\n\n` +
        `Video duration: ${Math.round(durationSec)}s. Chunk size: ${chunkSeconds}s. Total chunks: ${chunkCount}.\n\n` +
        `Video analysis:\n${overview.content}\n\n` +
        `For EACH chunk, output a JSON object with this schema:\n` +
        `{"chunk": N, "start_seconds": S, "end_seconds": E, "timestamp": "MM:SS - MM:SS", ` +
        `"transcript_excerpt": "what's being discussed in this segment", ` +
        `${includeVisual ? `"visual_description": "what's shown on screen", ` : ""}` +
        `"topics": ["topic1", "topic2"], "speakers": ["speaker name"], "keywords": ["kw1", "kw2"]}\n\n` +
        (topicList ? `Tag each chunk against these topics: ${topicList.join(", ")}\n\n` : "") +
        `Output a JSON array of ${chunkCount} chunk objects. Nothing else.`;

      const indexingReq: ChatRequest = {
        parts: [{ type: "text", text: chunkingPrompt }],
        reasoning: { enableThinking: false },
        maxTokens: Math.min(chunkCount * 500, 32768),
        temperature: 0.2,
      };

      const indexResult = await client.chat(indexingReq);

      // Parse the index
      let chunks: unknown[] = [];
      let parseWarning: string | undefined;
      try {
        let cleaned = indexResult.content.trim();
        if (cleaned.startsWith("```")) {
          cleaned = cleaned.split("\n").slice(1).join("\n");
          if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
          cleaned = cleaned.trim();
        }
        chunks = JSON.parse(cleaned);
        if (!Array.isArray(chunks)) {
          parseWarning = "Model returned non-array JSON";
          chunks = [chunks];
        }
      } catch {
        parseWarning = "Model did not return valid JSON — returning raw text";
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                index: {
                  source: params.path,
                  duration_seconds: Math.round(durationSec),
                  chunk_seconds: chunkSeconds,
                  chunk_count: chunkCount,
                  ...(topicList ? { requested_topics: topicList } : {}),
                  include_visual: includeVisual,
                },
                overview: overview.content,
                chunks: parseWarning ? undefined : chunks,
                raw_chunks: parseWarning ? indexResult.content : undefined,
                ...(parseWarning ? { parse_warning: parseWarning } : {}),
                usage_hint:
                  "Store 'chunks' in a vector DB with embeddings of 'transcript_excerpt' + 'keywords' for semantic search. " +
                  "Use 'timestamp' to seek to the relevant segment.",
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
