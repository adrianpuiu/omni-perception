#!/usr/bin/env node
/**
 * Omni Perception MCP Server
 *
 * Exposes NVIDIA Nemotron 3 Nano Omni multimodal perception (image, audio, video, document)
 * as 7 MCP tools over stdio transport, backed by a locally-served vLLM endpoint.
 *
 * Implements: R1.1, R1.2, R1.3, R11.3
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { initLogger, logger } from "./logger.js";
import { OmniClient } from "./client.js";
import { MediaHandler } from "./media.js";
import { registerAllTools } from "./tools/index.js";
import { DependencyError } from "./errors.js";

async function main(): Promise<void> {
  // Load config first (for log level)
  const cfg = loadConfig();
  initLogger(cfg);

  // Check system dependencies (R10.4)
  // Skip if SKIP_DEPENDENCY_CHECK is set (for testing)
  if (!process.env.SKIP_DEPENDENCY_CHECK) {
    const { checkDependencies } = await import("./dependencies.js");
    try {
      await checkDependencies();
    } catch (err) {
      if (err instanceof DependencyError) {
        logger.fatal({ err }, "Missing system dependency");
        process.exit(1);
      }
      throw err;
    }
  } else {
    logger.warn("Skipping dependency check (SKIP_DEPENDENCY_CHECK is set)");
  }

  // Create MCP server (R1.1, R1.2)
  const server = new McpServer({
    name: "omni-perception-mcp-server",
    version: "1.0.0",
  });

  // Create shared components
  const client = new OmniClient(cfg);
  const media = new MediaHandler(cfg);

  // Register all 7 tools
  registerAllTools(server, client, media, cfg);

  // Check if vLLM is reachable (degraded mode if not — R1.3)
  const health = await client.health();
  if (!health.healthy) {
    logger.warn(
      { baseUrl: cfg.baseUrl, error: health.error },
      "vLLM server unreachable — starting in degraded mode. " +
        "Tools will fail until vLLM is available.",
    );
  } else {
    logger.info(
      { baseUrl: cfg.baseUrl, model: health.model },
      "vLLM server healthy",
    );
  }

  // Connect stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info(
    { baseUrl: cfg.baseUrl, model: cfg.model },
    "omni-perception-mcp-server started",
  );
}

main().catch((err) => {
  // Must write to stderr (R11.3)
  process.stderr.write(
    `Fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
