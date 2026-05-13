/**
 * Centralized tool handler wrapper providing:
 * - Structured per-call logging (R11.1): tool_name, duration_ms, status
 * - Zod validation error → MCP InvalidParams mapping (R10.1)
 * - Consistent error response formatting
 */
import { z } from "zod";
import { logger } from "./logger.js";
import { toMcpErrorCode, toMcpErrorMessage } from "./errors.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type ToolHandler<T> = (params: T) => Promise<CallToolResult>;

/**
 * Wrap a tool handler with structured logging and error handling.
 * R11.1: logs {tool_name, duration_ms, status} to stderr as structured JSON.
 * R10.1: maps ZodError to MCP InvalidParams (-32602).
 */
export function withLogging<T>(
  toolName: string,
  handler: ToolHandler<T>,
): ToolHandler<T> {
  return async (params: T) => {
    const start = Date.now();
    const requestId = `req_${start.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

    try {
      const result = await handler(params);
      const durationMs = Date.now() - start;

      logger.info(
        {
          tool_name: toolName,
          request_id: requestId,
          duration_ms: durationMs,
          status: result.isError ? "error" : "ok",
        },
        "tool call completed",
      );

      return result;
    } catch (err) {
      const durationMs = Date.now() - start;

      // R10.1: Zod validation errors → MCP InvalidParams
      if (err instanceof z.ZodError) {
        logger.info(
          {
            tool_name: toolName,
            request_id: requestId,
            duration_ms: durationMs,
            status: "validation_error",
          },
          "tool call validation failed",
        );

        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error (-32602): Invalid parameters: ${err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`,
            },
          ],
        };
      }

      logger.info(
        {
          tool_name: toolName,
          request_id: requestId,
          duration_ms: durationMs,
          status: "unhandled_error",
          error: err instanceof Error ? err.message : String(err),
        },
        "tool call failed",
      );

      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error (${toMcpErrorCode(err)}): ${toMcpErrorMessage(err)}`,
          },
        ],
      };
    }
  };
}
