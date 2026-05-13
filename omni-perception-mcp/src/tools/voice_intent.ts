/**
 * Tool: voice_intent
 * Extract structured intent JSON from a voice command.
 * Wendell's voice-to-tool-calling pattern: audio → intent JSON → dispatch to skill/tool.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniClient, ChatRequest } from "../client.js";
import { MediaHandler } from "../media.js";
import { withLogging } from "../tool-utils.js";

const InputSchema = z.object({
  path: z.string().describe("Absolute local path to audio clip containing a voice command"),
  available_actions: z
    .string()
    .optional()
    .describe("Comma-separated list of available actions/skills the user can invoke. " +
      "Example: 'run_script,search_web,send_email,toggle_device,query_database'. " +
      "If provided, the model will map the voice command to one of these actions."),
  parameters_schema: z
    .string()
    .optional()
    .describe("JSON schema hint for expected parameters. " +
      "Example: '{\"script\":\"string\",\"target\":\"string\",\"args\":\"string[]\"}'. " +
      "If provided, the model will extract parameters matching this schema."),
  language: z.string().optional().describe("Language hint (default: auto-detect)"),
});

export function registerVoiceIntent(
  server: McpServer,
  client: OmniClient,
  media: MediaHandler,
): void {
  server.registerTool(
    "voice_intent",
    {
      title: "Extract Voice Intent as Structured JSON",
      description:
        "Takes an audio clip of someone speaking a command and extracts the intent as structured JSON. " +
        "Designed as the input layer for agentic workflows: voice command → intent JSON → dispatch to tool/skill. " +
        "Optionally maps to a predefined list of available actions and extracts parameters matching a schema. " +
        "Example: 'Hey, can you run the throughput script on the server?' → " +
        "{\"action\": \"run_script\", \"parameters\": {\"script\": \"throughput\", \"target\": \"server\"}}. " +
        "Handles colloquial language, accents, and indirect requests.",
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withLogging("voice_intent", async (params) => {
      const uri = await media.assertAudio(params.path, 120);

      // Build the intent extraction prompt
      let prompt =
        "You are a voice command parser. Listen to this audio clip and extract the user's intent.\n\n" +
        "Rules:\n" +
        "1. Transcribe what the user said (handle accents, colloquialisms, and indirect phrasing)\n" +
        "2. Determine the intent — what does the user want to happen?\n" +
        "3. Extract any parameters mentioned (targets, values, names, quantities, etc.)\n" +
        "4. Rate your confidence from 0.0 to 1.0\n\n";

      if (params.available_actions) {
        const actions = params.available_actions
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean);
        prompt += `Available actions (map the user's request to the closest match):\n`;
        actions.forEach((a, i) => (prompt += `${i + 1}. ${a}\n`));
        prompt += "\nIf the request doesn't match any action, set action to \"unknown\".\n\n";
      }

      if (params.parameters_schema) {
        prompt += `Expected parameters schema:\n${params.parameters_schema}\n\n`;
        prompt += "Extract parameters matching this schema. If a parameter isn't mentioned, set it to null.\n\n";
      }

      prompt +=
        "Output ONLY valid JSON with this structure:\n" +
        "{\n" +
        '  "transcript": "what was said",\n' +
        '  "action": "identified_action",\n' +
        '  "parameters": { ... extracted params ... },\n' +
        '  "confidence": 0.0,\n' +
        '  "ambiguities": ["any unclear parts"],\n' +
        '  "clarification_needed": false\n' +
        "}\n\n" +
        "Set clarification_needed to true if the intent is ambiguous and you need to ask the user to clarify.";

      const langSuffix = params.language ? `\nLanguage: ${params.language}.` : "";

      const req: ChatRequest = {
        parts: [
          { type: "input_audio", audioUrl: uri },
          { type: "text", text: prompt + langSuffix },
        ],
        reasoning: { enableThinking: false },
        maxTokens: 2048,
        temperature: 0.1,
      };

      const result = await client.chat(req);

      // Parse the JSON output
      let intent: unknown = null;
      let parseWarning: string | undefined;

      try {
        let cleaned = result.content.trim();
        if (cleaned.startsWith("```")) {
          cleaned = cleaned.split("\n").slice(1).join("\n");
          if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
          cleaned = cleaned.trim();
        }
        intent = JSON.parse(cleaned);
      } catch {
        parseWarning = "Model did not return valid JSON";
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                intent,
                ...(parseWarning ? { raw: result.content, parse_warning: parseWarning } : {}),
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
