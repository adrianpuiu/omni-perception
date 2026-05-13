/**
 * Tool: analyze_document
 * PDF understanding: render pages to images, call model per page, optionally aggregate.
 * Implements: R5.1, R5.2, R5.3, R5.4, R5.5, R5.6
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniClient, ChatRequest } from "../client.js";
import { MediaHandler, toFileUri } from "../media.js";
import { PdfRenderer } from "../pdf.js";
import { defaultsFor, mergeReasoning } from "../reasoning.js";
import { logger } from "../logger.js";
import { withLogging } from "../tool-utils.js";
import type { Config } from "../config.js";

const InputSchema = z.object({
  path: z.string().describe("Absolute local path to PDF file"),
  prompt: z.string().min(1).describe("What to extract or analyze from the document"),
  pages: z.union([
    z.literal("all"),
    z.number().int().positive(),
    z.array(z.number().int().positive()),
  ]).optional().describe("Pages to process: 'all', a single page number, or array of page numbers (1-indexed). Default: 'all'"),
  aggregate: z.boolean().optional().describe("Generate aggregate summary across all pages (default: true if pages != single number)"),
  dpi: z.number().int().optional().describe("DPI for rendering (default: 150)"),
  thinking: z.boolean().optional().describe("Enable reasoning mode (default: true)"),
  reasoning_budget: z.number().int().positive().optional().describe("Max reasoning tokens (default: 16384)"),
  max_tokens: z.number().int().positive().optional().describe("Max output tokens per page (default: 20480)"),
});

export function registerAnalyzeDocument(
  server: McpServer,
  client: OmniClient,
  media: MediaHandler,
  cfg: Config,
): void {
  const pdfRenderer = new PdfRenderer({
    pdfDpi: cfg.pdfDpi,
    tmpDir: cfg.tmpDir,
  });

  server.registerTool(
    "analyze_document",
    {
      title: "Analyze Document (PDF)",
      description:
        "Analyze a PDF document by rendering pages to images and processing each page. " +
        "Supports OCR, table extraction, chart reading, and text understanding. " +
        "Can process specific pages or all pages, with optional cross-page aggregation. " +
        "Reasoning mode ON by default.",
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    withLogging("analyze_document", async (params) => {
      // Validate PDF path
      const pdfPath = await media.assertPdf(params.path);

      // Resolve pages parameter
      const pageSpec = params.pages ?? "all";
      const pages: "all" | number[] =
        pageSpec === "all"
          ? "all"
          : typeof pageSpec === "number"
            ? [pageSpec]
            : pageSpec;

      // Determine if we should aggregate
      const shouldAggregate =
        params.aggregate ?? (pages === "all" || pages.length > 1);

      // Render pages to PNG
      const rendered = await pdfRenderer.render(pdfPath, pages);

      try {
        const defaults = defaultsFor("document");
        const reasoning = mergeReasoning(
          defaults,
          params.thinking,
          params.reasoning_budget,
        );

        // Process each page
        const perPage: Array<{
          page: number;
          content: string;
          reasoning_content: string;
        }> = [];

        for (const page of rendered.pages) {
          const uri = toFileUri(page.pngPath);
          const req: ChatRequest = {
            parts: [
              { type: "image_url", imageUrl: uri },
              {
                type: "text",
                text: `Page ${page.pageNumber} of the document.\n\n${params.prompt}`,
              },
            ],
            reasoning,
            maxTokens: params.max_tokens,
            topP: reasoning.enableThinking ? 0.95 : undefined,
          };

          const result = await client.chat(req);
          perPage.push({
            page: page.pageNumber,
            content: result.content,
            reasoning_content: result.reasoningContent,
          });
        }

        // Aggregate summary (R5.4)
        let summary: string | undefined;
        if (shouldAggregate && perPage.length > 1) {
          const perPageSummaries = perPage
            .map((p) => `--- Page ${p.page} ---\n${p.content}`)
            .join("\n\n");

          const aggReq: ChatRequest = {
            parts: [
              {
                type: "text",
                text: `You analyzed each page individually. Per-page summaries follow. Answer the user prompt holistically.\n\n${perPageSummaries}\n\nUser prompt: ${params.prompt}`,
              },
            ],
            reasoning,
            maxTokens: params.max_tokens ?? cfg.defaultMaxTokens,
          };

          const aggResult = await client.chat(aggReq);
          summary = aggResult.content;
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  per_page: perPage,
                  ...(summary ? { summary } : {}),
                  page_count: rendered.pageCount,
                },
                null,
                2,
              ),
            },
          ],
        };
      } finally {
        // Always cleanup (R5.6)
        await rendered.cleanup();
      }
    }),
  );
}
