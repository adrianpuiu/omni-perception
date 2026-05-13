/**
 * Tool: repurpose_content
 * Multi-call workflow: transcribe/analyze media → generate multiple content formats.
 * Takes a video or audio file and produces blog post, social thread, email, and key quotes.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniClient, ChatRequest } from "../client.js";
import { MediaHandler } from "../media.js";
import { withLogging } from "../tool-utils.js";

const InputSchema = z.object({
  path: z.string().describe("Absolute local path to video (.mp4) or audio (.wav, .mp3) file"),
  formats: z
    .array(z.enum(["blog_post", "social_thread", "email_summary", "key_quotes"]))
    .optional()
    .describe("Which formats to generate (default: all four). Pass a subset to skip unwanted formats."),
  tone: z
    .enum(["professional", "casual", "academic", "enthusiastic"])
    .optional()
    .describe("Tone for generated content (default: professional)"),
  language: z.string().optional().describe("Output language (default: English)"),
});

const FORMAT_PROMPTS: Record<string, (tone: string, lang: string) => string> = {
  blog_post: (tone, lang) =>
    `Write a well-structured blog post based on the content below.\n` +
    `Tone: ${tone}. ${lang}\n\n` +
    `Structure:\n` +
    `- Compelling title (H1)\n` +
    `- Opening hook (2-3 sentences that grab attention)\n` +
    `- 3-5 sections with H2 headers\n` +
    `- Each section: 2-3 paragraphs\n` +
    `- Closing with key takeaway\n` +
    `Target length: 600-800 words. Write in markdown.`,

  social_thread: (tone, lang) =>
    `Create a social media thread (e.g., Twitter/X) based on the content below.\n` +
    `Tone: ${tone}. ${lang}\n\n` +
    `Rules:\n` +
    `- First tweet is the hook (must grab attention)\n` +
    `- 5-8 tweets total\n` +
    `- Each tweet under 280 characters\n` +
    `- Number each tweet (1/8, 2/8, etc.)\n` +
    `- End with a call-to-action tweet\n` +
    `- Include relevant hashtags`,

  email_summary: (tone, lang) =>
    `Write a professional email summary of the content below.\n` +
    `Tone: ${tone}. ${lang}\n\n` +
    `Structure:\n` +
    `- Subject line (concise, specific)\n` +
    `- 3-5 bullet points covering key takeaways\n` +
    `- One paragraph of context\n` +
    `- Clear next steps or call to action\n` +
    `Keep it under 300 words. Make it scannable.`,

  key_quotes: (tone, lang) =>
    `Extract the 3-5 most impactful, quotable statements from the content below.\n` +
    `${lang}\n\n` +
    `For each quote:\n` +
    `1. The exact or near-exact quote (cleaned up for readability)\n` +
    `2. Context: 1 sentence explaining when/why it was said\n` +
    `3. Why it matters: 1 sentence on significance\n\n` +
    `Prioritize: unique insights, contrarian takes, specific numbers, and memorable phrasing.`,
};

export function registerRepurposeContent(
  server: McpServer,
  client: OmniClient,
  media: MediaHandler,
): void {
  server.registerTool(
    "repurpose_content",
    {
      title: "Repurpose Content into Multiple Formats",
      description:
        "Take a video or audio recording and generate multiple content formats from it: " +
        "blog post, social media thread, email summary, and key quotes. " +
        "Transcribes/analyzes the source media once, then generates each format in a separate call. " +
        "Choose which formats to generate, or get all four. " +
        "Great for content repurposing: one recording → blog + tweets + email + pull quotes.",
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withLogging("repurpose_content", async (params) => {
      const ext = params.path.split(".").pop()?.toLowerCase() ?? "";
      const tone = params.tone ?? "professional";
      const lang = params.language ? `Write in ${params.language}.` : "";
      const formats = params.formats ?? ["blog_post", "social_thread", "email_summary", "key_quotes"];

      // ─── Step 1: Extract content from media ──────────────────────
      let sourceContent: string;

      if (ext === "mp4") {
        // Video: transcribe with audio understanding
        const uri = await media.assertVideo(params.path, 120);

        const req: ChatRequest = {
          parts: [
            { type: "video_url", videoUrl: uri },
            { type: "text", text: "Provide a detailed summary of everything discussed or shown in this video. Include all key points, arguments, data, and conclusions." },
          ],
          reasoning: { enableThinking: false },
          useAudioInVideo: true,
          maxTokens: 8192,
        };

        const result = await client.chat(req);
        sourceContent = result.content;
      } else if (["wav", "mp3"].includes(ext)) {
        // Audio: transcribe
        const uri = await media.assertAudio(params.path, 3600);

        const req: ChatRequest = {
          parts: [
            { type: "input_audio", audioUrl: uri },
            { type: "text", text: "Transcribe this audio in full detail, including all key points, arguments, and conclusions." },
          ],
          reasoning: { enableThinking: false },
          temperature: 0.2,
          maxTokens: 20480,
        };

        const result = await client.chat(req);
        sourceContent = result.content;
      } else {
        throw new Error(`Unsupported file type: ${ext}. Use video (.mp4) or audio (.wav, .mp3).`);
      }

      // ─── Step 2: Generate each format ────────────────────────────
      const outputs: Record<string, string> = {};

      for (const format of formats) {
        const promptFn = FORMAT_PROMPTS[format];
        if (!promptFn) continue;

        const prompt = promptFn(tone, lang);

        const req: ChatRequest = {
          parts: [
            {
              type: "text",
              text: `${prompt}\n\n--- SOURCE CONTENT ---\n${sourceContent}`,
            },
          ],
          reasoning: { enableThinking: false },
          maxTokens: 4096,
        };

        const result = await client.chat(req);
        outputs[format] = result.content.trim();
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ outputs }, null, 2),
          },
        ],
      };
    }),
  );
}
