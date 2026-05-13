import pino from "pino";
import type { Config } from "./config.js";

/**
 * Structured logger writing to stderr (stdout is reserved for MCP frames).
 * Implements: R11.1, R11.2, R11.3
 */

let _logger: pino.Logger | null = null;

export function initLogger(cfg: Pick<Config, "logLevel">): void {
  _logger = pino({
    level: cfg.logLevel,
    transport:
      cfg.logLevel === "debug"
        ? { target: "pino/file", options: { destination: 2 } } // stderr
        : undefined,
    // Always write to stderr (fd=2)
    // pino defaults to stdout, so we set the destination explicitly
  });
  // Redirect to stderr
  const dest = pino.destination({ fd: 2 });
  _logger = pino({ level: cfg.logLevel }, dest);
}

export const logger: pino.Logger = new Proxy({} as pino.Logger, {
  get(_target, prop: string | symbol) {
    if (!_logger) {
      // Fallback before init: stderr-only minimal logger
      _logger = pino(
        { level: "info" },
        pino.destination({ fd: 2 }),
      );
    }
    const val = (_logger as Record<string | symbol, unknown>)[prop];
    return typeof val === "function" ? val.bind(_logger) : val;
  },
});
