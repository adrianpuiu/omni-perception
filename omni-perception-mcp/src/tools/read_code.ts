/**
 * Tool: read_code
 * Read code from a screenshot and return clean, copy-pasteable text.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniClient, ChatRequest } from "../client.js";
import { MediaHandler } from "../media.js";
import { withLogging } from "../tool-utils.js";

const InputSchema = z.object({
  path: z.string().describe("Absolute local path to screenshot image"),
  language_hint: z
    .string()
    .optional()
    .describe("Programming language hint (e.g., 'python', 'yaml', 'rust', 'bash'). Helps formatting."),
});

export function registerReadCode(
  server: McpServer,
  client: OmniClient,
  media: MediaHandler,
): void {
  server.registerTool(
    "read_code",
    {
      title: "Read Code from Screenshot",
      description:
        "Read code, stack traces, config files, or terminal output from a screenshot. " +
        "Returns clean, copy-pasteable text with no commentary. " +
        "Preserves indentation, line breaks, and formatting. " +
        "Useful for extracting code from error screenshots, config screenshots, " +
        "shared code snippets, and terminal output captures.",
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withLogging("read_code", async (params) => {
      const uri = await media.assertImage(params.path);

      const langInstruction = params.language_hint
        ? `The code appears to be ${params.language_hint}. Format your output accordingly.`
        : "Detect the programming language and format accordingly.";

      const systemPrompt =
        "You are a code extraction engine. This screenshot contains code, a stack trace, " +
        "a configuration file, terminal output, or similar technical text.\n\n" +
        "Your job:\n" +
        "1. Read ALL text in the image exactly as written\n" +
        "2. Output the text as clean, copy-pasteable code\n" +
        "3. Preserve indentation, line breaks, and formatting precisely\n" +
        "4. Do NOT add commentary, explanations, or markdown formatting\n" +
        "5. If text is partially cut off, include what's readable and note [truncated] where missing\n" +
        `6. ${langInstruction}\n\n` +
        "Output ONLY the raw code/text from the image. Nothing else.";

      const req: ChatRequest = {
        parts: [
          { type: "image_url", imageUrl: uri },
          { type: "text", text: "Extract all code/text from this screenshot." },
        ],
        reasoning: { enableThinking: false },
        maxTokens: 16384,
        temperature: 0.1,
      };

      const result = await client.chat(req);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                code: result.content,
                language_hint: params.language_hint ?? "auto",
                line_count: result.content.split("\n").length,
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
