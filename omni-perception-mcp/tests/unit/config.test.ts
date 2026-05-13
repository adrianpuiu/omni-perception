import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadConfig } from "../../src/config.js";

describe("loadConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("should apply all defaults when no env vars set", () => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("NEMOTRON_OMNI_")) {
        delete process.env[key];
      }
    }

    const cfg = loadConfig();
    expect(cfg.baseUrl).toBe("http://localhost:8000/v1");
    expect(cfg.model).toBe("nemotron_3_nano_omni");
    expect(cfg.defaultMaxTokens).toBe(20480);
    expect(cfg.requestTimeoutMs).toBe(600_000);
    expect(cfg.pdfDpi).toBe(150);
    expect(cfg.logLevel).toBe("info");
    expect(cfg.tmpDir).toBe("/tmp");
  });

  it("should override with env vars", () => {
    process.env.NEMOTRON_OMNI_BASE_URL = "http://192.168.1.100:8000/v1";
    process.env.NEMOTRON_OMNI_MODEL = "custom_model";
    process.env.NEMOTRON_OMNI_DEFAULT_MAX_TOKENS = "4096";
    process.env.NEMOTRON_OMNI_PDF_DPI = "200";
    process.env.NEMOTRON_OMNI_LOG_LEVEL = "debug";

    const cfg = loadConfig();
    expect(cfg.baseUrl).toBe("http://192.168.1.100:8000/v1");
    expect(cfg.model).toBe("custom_model");
    expect(cfg.defaultMaxTokens).toBe(4096);
    expect(cfg.pdfDpi).toBe(200);
    expect(cfg.logLevel).toBe("debug");
  });

  it("should reject invalid PDF DPI (< 72)", () => {
    process.env.NEMOTRON_OMNI_PDF_DPI = "50";
    expect(() => loadConfig()).toThrow();
  });

  it("should reject invalid PDF DPI (> 300)", () => {
    process.env.NEMOTRON_OMNI_PDF_DPI = "500";
    expect(() => loadConfig()).toThrow();
  });

  it("should reject invalid base URL", () => {
    process.env.NEMOTRON_OMNI_BASE_URL = "not-a-url";
    expect(() => loadConfig()).toThrow();
  });

  it("should reject invalid log level", () => {
    process.env.NEMOTRON_OMNI_LOG_LEVEL = "verbose";
    expect(() => loadConfig()).toThrow();
  });
});
