/**
 * Tool: analyze_audio
 * Q&A or summary over an audio file. Reasoning OFF by default.
 * Implements: R3.1, R3.2
 *
 * Tool: transcribe_audio
 * Pure ASR. Thinking off, temp=0.2, top_k=1.
 * Implements: R3.3, R3.4
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniClient, ChatRequest } from "../client.js";
import { MediaHandler } from "../media.js";
import { defaultsFor, mergeReasoning } from "../reasoning.js";
import { withLogging } from "../tool-utils.js";

const AnalyzeAudioSchema = z.object({
  path: z.string().describe("Absolute local path to audio file (.wav, .mp3). Max duration: 3600s (1 hour)"),
  prompt: z.string().min(1).describe("Question or instruction about the audio content"),
  thinking: z.boolean().optional().describe("Enable reasoning mode (default: false)"),
  max_tokens: z.number().int().positive().optional().describe("Max output tokens (default: 20480)"),
});

const TranscribeAudioSchema = z.object({
  path: z.string().describe("Absolute local path to audio file (.wav, .mp3)"),
  word_timestamps: z.boolean().optional().describe("Include word-level timestamps (default: false)"),
  language_hint: z.string().optional().describe("Language hint, e.g. 'en' (English only in v1)"),
});

export function registerAnalyzeAudio(
  server: McpServer,
  client: OmniClient,
  media: MediaHandler,
): void {
  server.registerTool(
    "analyze_audio",
    {
      title: "Analyze Audio",
      description:
        "Analyze or answer questions about an audio file (call recording, podcast, lecture). " +
        "Supports summarization, Q&A, and content extraction. " +
        "Max duration: 1 hour. Reasoning mode OFF by default.",
      inputSchema: AnalyzeAudioSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    withLogging("analyze_audio", async (params) => {
      const uri = await media.assertAudio(params.path);
      const defaults = defaultsFor("audio");
      const reasoning = mergeReasoning(defaults, params.thinking);

      const req: ChatRequest = {
        parts: [
          { type: "input_audio", audioUrl: uri },
          { type: "text", text: params.prompt },
        ],
        reasoning,
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

export function registerTranscribeAudio(
  server: McpServer,
  client: OmniClient,
  media: MediaHandler,
): void {
  server.registerTool(
    "transcribe_audio",
    {
      title: "Transcribe Audio",
      description:
        "Transcribe speech from an audio file to text. Pure ASR with high accuracy. " +
        "Uses temperature=0.2 and top_k=1 for deterministic transcription. " +
        "Optionally includes word-level timestamps.",
      inputSchema: TranscribeAudioSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withLogging("transcribe_audio", async (params) => {
      const uri = await media.assertAudio(params.path);
      const defaults = defaultsFor("transcribe");

      // Build system prompt (R3.3, R3.4)
      let systemSuffix = "Transcribe this audio.";
      if (params.word_timestamps) {
        systemSuffix += " Include word-level timestamps.";
      }

      const req: ChatRequest = {
        parts: [
          { type: "input_audio", audioUrl: uri },
          { type: "text", text: systemSuffix },
        ],
        reasoning: defaults,
        temperature: 0.2,
        topK: 1,
        maxTokens: 20480,
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
