import { describe, it, expect, vi, beforeEach } from "vitest";
import { withLogging } from "../../src/tool-utils.js";
import { z } from "zod";

// Mock logger
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { logger } from "../../src/logger.js";

describe("withLogging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should log tool_name, duration_ms, and status='ok' on success", async () => {
    const handler = withLogging("test_tool", async () => ({
      content: [{ type: "text" as const, text: "ok" }],
    }));

    const result = await handler({});

    expect(result.content[0].text).toBe("ok");
    expect(logger.info).toHaveBeenCalled();

    const logCall = vi.mocked(logger.info).mock.calls[0]![0] as Record<string, unknown>;
    expect(logCall.tool_name).toBe("test_tool");
    expect(logCall.status).toBe("ok");
    expect(logCall.duration_ms).toBeGreaterThanOrEqual(0);
    expect(logCall.request_id).toBeDefined();
  });

  it("should log status='error' when handler returns isError", async () => {
    const handler = withLogging("fail_tool", async () => ({
      isError: true,
      content: [{ type: "text" as const, text: "bad" }],
    }));

    await handler({});

    const logCall = vi.mocked(logger.info).mock.calls[0]![0] as Record<string, unknown>;
    expect(logCall.status).toBe("error");
  });

  it("should catch ZodError and return InvalidParams", async () => {
    const handler = withLogging("zod_tool", async () => {
      throw new z.ZodError([
        { code: "too_small", path: ["prompt"], message: "too short", minimum: 1, type: "string" },
      ]);
    });

    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("-32602");
    expect(result.content[0].text).toContain("Invalid parameters");
  });

  it("should catch generic errors and return formatted error", async () => {
    const handler = withLogging("err_tool", async () => {
      throw new Error("something broke");
    });

    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("something broke");

    const logCall = vi.mocked(logger.info).mock.calls[0]![0] as Record<string, unknown>;
    expect(logCall.status).toBe("unhandled_error");
  });
});
