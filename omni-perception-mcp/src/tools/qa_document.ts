/**
 * Tool: qa_document
 * Multi-call workflow: extract all PDF pages into context → answer questions against it.
 * First call builds the document context. Returns page content + ready-to-query flag.
 * Subsequent calls (via context_id) reuse the cached content.
 *
 * Simplified version: extracts all pages in one call and answers questions.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniClient, ChatRequest } from "../client.js";
import { MediaHandler, toFileUri } from "../media.js";
import { PdfRenderer } from "../pdf.js";
import { defaultsFor, mergeReasoning } from "../reasoning.js";
import { withLogging } from "../tool-utils.js";
import type { Config } from "../config.js";

const InputSchema = z.object({
  path: z.string().describe("Absolute local path to PDF document"),
  question: z
    .string()
    .optional()
    .describe("Question to answer against the document. If omitted, returns page-by-page content for review."),
  pages: z
    .union([
      z.literal("all"),
      z.number().int().positive(),
      z.array(z.number().int().positive()),
    ])
    .optional()
    .describe("Pages to process (default: 'all')"),
  detail_level: z
    .enum(["full", "summary"])
    .optional()
    .describe("How much detail to extract per page: 'full' (complete text) or 'summary' (2-3 sentences). Default: summary"),
  thinking: z.boolean().optional().describe("Enable reasoning for Q&A (default: true when question is provided)"),
});

export function registerQaDocument(
  server: McpServer,
  client: OmniClient,
  media: MediaHandler,
  cfg: Config,
): void {
  const pdfRenderer = new PdfRenderer({ pdfDpi: cfg.pdfDpi, tmpDir: cfg.tmpDir });

  server.registerTool(
    "qa_document",
    {
      title: "Q&A with Document",
      description:
        "Ask questions against a PDF document. Extracts page-by-page content, then answers " +
        "your specific question using the full document as context. Much more targeted than a flat summary — " +
        "you can drill into specific details. If no question is provided, returns the page-by-page extraction " +
        "so you can review the content first. Use detail_level='full' for complete text extraction, " +
        "'summary' (default) for concise per-page summaries.",
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withLogging("qa_document", async (params) => {
      const pdfPath = await media.assertPdf(params.path);
      const pageSpec = params.pages ?? "all";
      const pages: "all" | number[] =
        pageSpec === "all"
          ? "all"
          : typeof pageSpec === "number"
            ? [pageSpec]
            : pageSpec;
      const detail = params.detail_level ?? "summary";

      const rendered = await pdfRenderer.render(pdfPath, pages);

      try {
        const defaults = defaultsFor("document");
        const reasoning = mergeReasoning(defaults, false);

        // ─── Extract content per page ──────────────────────────────
        const perPage: Array<{ page: number; content: string }> = [];

        for (const page of rendered.pages) {
          const uri = toFileUri(page.pngPath);

          const extractPrompt =
            detail === "full"
              ? `Page ${page.pageNumber}. Extract ALL text, numbers, table data, and labels from this page. Preserve structure.`
              : `Page ${page.pageNumber}. Provide a concise 2-3 sentence summary of this page's content. Include key numbers and facts.`;

          const req: ChatRequest = {
            parts: [
              { type: "image_url", imageUrl: uri },
              { type: "text", text: extractPrompt },
            ],
            reasoning,
            maxTokens: detail === "full" ? 4096 : 512,
          };

          const result = await client.chat(req);
          perPage.push({ page: page.pageNumber, content: result.content.trim() });
        }

        // ─── If no question, return extraction only ─────────────────
        if (!params.question) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    per_page: perPage,
                    page_count: rendered.pageCount,
                    detail_level: detail,
                    hint: "Call again with a 'question' to get targeted answers against this document.",
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        // ─── Answer question against full context ───────────────────
        const documentContext = perPage
          .map((p) => `--- Page ${p.page} ---\n${p.content}`)
          .join("\n\n");

        const qaReasoning = mergeReasoning(
          { enableThinking: true, reasoningBudget: 16384 },
          params.thinking,
        );

        const qaReq: ChatRequest = {
          parts: [
            {
              type: "text",
              text:
                `You have access to the following document content (page by page):\n\n${documentContext}\n\n` +
                `Answer this question based on the document: ${params.question}\n\n` +
                `Rules:\n` +
                `- Answer based ONLY on the document content above\n` +
                `- If the answer spans multiple pages, synthesize the information\n` +
                `- Cite specific page numbers when referencing details: [Page N]\n` +
                `- If the document doesn't contain the answer, say so clearly\n` +
                `- Be specific with numbers, names, and dates`,
            },
          ],
          reasoning: qaReasoning,
          maxTokens: 8192,
          topP: qaReasoning.enableThinking ? 0.95 : undefined,
        };

        const answer = await client.chat(qaReq);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  question: params.question,
                  answer: answer.content,
                  reasoning_content: answer.reasoningContent,
                  source_pages: perPage.map((p) => p.page),
                  page_count: rendered.pageCount,
                },
                null,
                2,
              ),
            },
          ],
        };
      } finally {
        await rendered.cleanup();
      }
    }),
  );
}
