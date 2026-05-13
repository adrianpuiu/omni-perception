/**
 * Tool: analyze_chart
 * Specialized chart/graph analysis: reads axes, data series, scales, trends, outliers.
 * Can also critique the visualization itself (Wendell's use case).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniClient, ChatRequest } from "../client.js";
import { MediaHandler } from "../media.js";
import { withLogging } from "../tool-utils.js";

const InputSchema = z.object({
  path: z.string().describe("Absolute local path to chart/graph screenshot image"),
  extract_data: z
    .boolean()
    .optional()
    .describe("Extract data points as structured JSON (default: true)"),
  critique: z
    .boolean()
    .optional()
    .describe("Critique the visualization quality and suggest improvements (default: false)"),
  thinking: z.boolean().optional().describe("Enable reasoning mode (default: true)"),
  max_tokens: z.number().int().positive().optional().describe("Max output tokens (default: 8192)"),
});

export function registerAnalyzeChart(
  server: McpServer,
  client: OmniClient,
  media: MediaHandler,
): void {
  server.registerTool(
    "analyze_chart",
    {
      title: "Analyze Charts, Graphs & Data Visualizations",
      description:
        "Specialized analysis of scientific/technical charts, graphs, and data visualizations. " +
        "Reads axes, scales, data series, trends, and outliers. Optionally extracts data points " +
        "as structured JSON and critiques the visualization quality (misleading scales, hidden data, " +
        "poor bin sizes, etc.). Use for analyzing benchmark results, monitoring dashboards, " +
        "research papers, or any data visualization where you need precise reading.",
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withLogging("analyze_chart", async (params) => {
      const uri = await media.assertImage(params.path);
      const extractData = params.extract_data ?? true;
      const doCritique = params.critique ?? false;

      // ─── Part 1: Chart analysis ──────────────────────────────────
      const analysisPrompt =
        "Analyze this chart/graph/data visualization in detail.\n\n" +
        "Provide:\n" +
        "## Chart Type\n(What type of visualization: bar, line, scatter, pie, heatmap, box plot, histogram, etc.)\n\n" +
        "## Axes & Scales\n" +
        "- X-axis: label, unit, range, scale type (linear/log)\n" +
        "- Y-axis: label, unit, range, scale type (linear/log)\n" +
        "- Any secondary axes\n\n" +
        "## Data Series\n" +
        "- Each series: name, color/pattern, number of visible data points\n" +
        "- Legend information\n\n" +
        "## Key Observations\n" +
        "- Trends (increasing, decreasing, cyclical, flat)\n" +
        "- Notable peaks, valleys, inflection points\n" +
        "- Outliers or anomalies\n" +
        "- Any visible thresholds, reference lines, or annotations\n\n" +
        "## Summary\n" +
        "One paragraph describing what this chart shows and the main takeaway.";

      const analysisReq: ChatRequest = {
        parts: [
          { type: "image_url", imageUrl: uri },
          { type: "text", text: analysisPrompt },
        ],
        reasoning: {
          enableThinking: params.thinking ?? true,
          ...(params.thinking !== false ? { reasoningBudget: 8192 } : {}),
        },
        maxTokens: params.max_tokens ?? 8192,
        topP: params.thinking !== false ? 0.95 : undefined,
      };

      const analysis = await client.chat(analysisReq);

      // ─── Part 2: Data extraction (optional) ──────────────────────
      let dataExtraction: unknown = null;
      let extractionRaw: string | undefined;
      if (extractData) {
        const extractionPrompt =
          "Extract all visible data points from this chart as JSON.\n\n" +
          "Output schema:\n" +
          "{\n" +
          '  "chart_type": "...",\n' +
          '  "x_axis": {"label": "...", "unit": "...", "values": [...]},\n' +
          '  "y_axis": {"label": "...", "unit": "..."},\n' +
          '  "series": [\n' +
          '    {"name": "...", "data_points": [{"x": ..., "y": ...}, ...]}\n' +
          "  ]\n" +
          "}\n\n" +
          "Rules:\n" +
          "- Estimate values as precisely as you can from the chart\n" +
          "- Include ALL visible data points\n" +
          "- If values are approximate, include them anyway\n" +
          "Output ONLY valid JSON. No markdown, no explanation.";

        const extractionReq: ChatRequest = {
          parts: [
            { type: "image_url", imageUrl: uri },
            { type: "text", text: extractionPrompt },
          ],
          reasoning: { enableThinking: false },
          maxTokens: 4096,
          temperature: 0.1,
        };

        const extractionResult = await client.chat(extractionReq);
        extractionRaw = extractionResult.content;

        try {
          let cleaned = extractionRaw.trim();
          if (cleaned.startsWith("```")) {
            cleaned = cleaned.split("\n").slice(1).join("\n");
            if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
            cleaned = cleaned.trim();
          }
          dataExtraction = JSON.parse(cleaned);
          extractionRaw = undefined; // don't double-include if parse succeeded
        } catch {
          // keep raw text
        }
      }

      // ─── Part 3: Visualization critique (optional) ───────────────
      let critiqueResult: string | undefined;
      if (doCritique) {
        const critiquePrompt =
          "Critique this data visualization. Identify problems and suggest improvements.\n\n" +
          "Check for:\n" +
          "1. **Misleading scales** — truncated axes, non-zero baselines, inconsistent intervals\n" +
          "2. **Hidden data** — important data obscured by scale choices, aggregation that hides outliers\n" +
          "3. **Visual clutter** — too many series, unclear labels, poor color choices\n" +
          "4. **Statistical issues** — inappropriate bin sizes, missing error bars, P99 hidden by averages\n" +
          "5. **Accessibility** — color-blind unfriendly, small text, no labels on data points\n" +
          "6. **Suggested improvements** — specific actionable fixes\n\n" +
          "Rate the visualization quality: Excellent / Good / Fair / Poor\n" +
          "Be specific and constructive.";

        const critiqueReq: ChatRequest = {
          parts: [
            { type: "image_url", imageUrl: uri },
            { type: "text", text: critiquePrompt },
          ],
          reasoning: { enableThinking: false },
          maxTokens: 2048,
        };

        const critiqueResp = await client.chat(critiqueReq);
        critiqueResult = critiqueResp.content;
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                analysis: analysis.content,
                reasoning_content: analysis.reasoningContent,
                ...(dataExtraction ? { extracted_data: dataExtraction } : {}),
                ...(extractionRaw ? { extraction_raw: extractionRaw } : {}),
                ...(critiqueResult ? { visualization_critique: critiqueResult } : {}),
                duration_ms: analysis.durationMs,
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
