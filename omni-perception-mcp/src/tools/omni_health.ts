/**
 * Tool: omni_health
 * Probe the upstream vLLM server. Always succeeds (returns healthy: false on failure).
 * Implements: R9.1, R9.2
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniClient } from "../client.js";
import { withLogging } from "../tool-utils.js";

export function registerHealthTool(server: McpServer, client: OmniClient): void {
  server.registerTool(
    "omni_health",
    {
      title: "Omni Perception Health Check",
      description:
        "Probe the upstream vLLM inference server. Always returns a result (never throws). " +
        "Returns {healthy: true, model, base_url, response_time_ms} on success, " +
        "or {healthy: false, error, base_url} on failure.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withLogging("omni_health", async () => {
      const result = await client.health();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }),
  );
}
