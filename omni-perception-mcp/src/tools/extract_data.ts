/**
 * Tool: extract_data
 * Extract structured data (JSON/CSV) from an image or PDF.
 * Forces deterministic output with low temperature.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniClient, ChatRequest } from "../client.js";
import { MediaHandler, toFileUri } from "../media.js";
import { PdfRenderer } from "../pdf.js";
import { withLogging } from "../tool-utils.js";
import type { Config } from "../config.js";

const InputSchema = z.object({
  path: z.string().describe("Absolute local path to image or PDF file"),
  fields: z
    .string()
    .describe("What to extract, as comma-separated field names. Example: 'vendor, date, total, line_items'"),
  format: z
    .enum(["json", "csv"])
    .optional()
    .describe("Output format (default: json)"),
  thinking: z.boolean().optional().describe("Enable reasoning mode (default: false)"),
});

export function registerExtractData(
  server: McpServer,
  client: OmniClient,
  media: MediaHandler,
  cfg: Config,
): void {
  const pdfRenderer = new PdfRenderer({ pdfDpi: cfg.pdfDpi, tmpDir: cfg.tmpDir });

  server.registerTool(
    "extract_data",
    {
      title: "Extract Structured Data",
      description:
        "Extract structured data from an image or PDF as JSON or CSV. " +
        "Forces deterministic output with low temperature. " +
        "Use for receipts, invoices, tables, forms, or any document where you need " +
        "specific fields extracted into a machine-readable format.",
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withLogging("extract_data", async (params) => {
      const format = params.format ?? "json";
      const ext = params.path.split(".").pop()?.toLowerCase() ?? "";

      let imageUri: string;
      let cleanup: (() => Promise<void>) | null = null;

      try {
        if (ext === "pdf") {
          const pdfPath = await media.assertPdf(params.path);
          const rendered = await pdfRenderer.render(pdfPath, [1]);
          cleanup = rendered.cleanup;
          imageUri = toFileUri(rendered.pages[0]!.pngPath);
        } else {
          imageUri = await media.assertImage(params.path);
        }

        // Build extraction prompt
        const outputInstruction =
          format === "json"
            ? "Output ONLY valid JSON. No markdown, no explanation, no code fences. Just raw JSON. Schema: {\"extracted\": {<field_names>: <values>}}"
            : "Output ONLY valid CSV with a header row. No markdown, no explanation, no code fences.";

        const systemPrompt =
          `You are a precise data extraction engine. Extract the following fields: ${params.fields}\n\n` +
          "Rules:\n" +
          "- If a field is not found, use null\n" +
          "- Be exact with numbers — do not round or approximate\n" +
          `- ${outputInstruction}`;

        const req: ChatRequest = {
          parts: [
            { type: "image_url", imageUrl: imageUri },
            { type: "text", text: `Extract: ${params.fields}` },
          ],
          reasoning: { enableThinking: params.thinking ?? false },
          maxTokens: 8192,
          temperature: 0.1,
        };

        const result = await client.chat(req);

        // Try to parse structured output
        let data: unknown = null;
        let parseWarning: string | undefined;

        if (format === "json") {
          try {
            let cleaned = result.content.trim();
            if (cleaned.startsWith("```")) {
              cleaned = cleaned.split("\n").slice(1).join("\n");
              if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
              cleaned = cleaned.trim();
            }
            data = JSON.parse(cleaned);
          } catch {
            parseWarning = "Model did not return valid JSON";
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  data,
                  raw: result.content,
                  format,
                  ...(parseWarning ? { parse_warning: parseWarning } : {}),
                  duration_ms: result.durationMs,
                },
                null,
                2,
              ),
            },
          ],
        };
      } finally {
        await cleanup?.();
      }
    }),
  );
}
