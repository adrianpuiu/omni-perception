#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/logger.ts
import pino from "pino";
function initLogger(cfg) {
  _logger = pino({
    level: cfg.logLevel,
    transport: cfg.logLevel === "debug" ? { target: "pino/file", options: { destination: 2 } } : void 0
    // Always write to stderr (fd=2)
    // pino defaults to stdout, so we set the destination explicitly
  });
  const dest = pino.destination({ fd: 2 });
  _logger = pino({ level: cfg.logLevel }, dest);
}
var _logger, logger;
var init_logger = __esm({
  "src/logger.ts"() {
    "use strict";
    _logger = null;
    logger = new Proxy({}, {
      get(_target, prop) {
        if (!_logger) {
          _logger = pino(
            { level: "info" },
            pino.destination({ fd: 2 })
          );
        }
        const val = _logger[prop];
        return typeof val === "function" ? val.bind(_logger) : val;
      }
    });
  }
});

// src/errors.ts
function toMcpErrorCode(e) {
  if (e instanceof PathSecurityError) return -32602;
  if (e instanceof MediaValidationError) return -32602;
  if (e instanceof ValidationError) return -32602;
  if (e instanceof TimeoutError) return -32603;
  if (e instanceof UpstreamError) return -32603;
  return -32603;
}
function toMcpErrorMessage(e) {
  if (e instanceof OmniError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
var OmniError, MediaValidationError, PathSecurityError, ValidationError, TimeoutError, UpstreamError, DependencyError;
var init_errors = __esm({
  "src/errors.ts"() {
    "use strict";
    OmniError = class extends Error {
      name = "OmniError";
      code;
      constructor(message, code) {
        super(message);
        this.code = code;
      }
    };
    MediaValidationError = class extends OmniError {
      name = "MediaValidationError";
      constructor(message) {
        super(message, "MEDIA_VALIDATION");
      }
    };
    PathSecurityError = class extends OmniError {
      name = "PathSecurityError";
      constructor(message) {
        super(message, "PATH_SECURITY");
      }
    };
    ValidationError = class extends OmniError {
      name = "ValidationError";
      constructor(message) {
        super(message, "VALIDATION");
      }
    };
    TimeoutError = class extends OmniError {
      name = "TimeoutError";
      constructor(message) {
        super(message, "TIMEOUT");
      }
    };
    UpstreamError = class extends OmniError {
      name = "UpstreamError";
      constructor(message) {
        super(message, "UPSTREAM");
      }
    };
    DependencyError = class extends OmniError {
      name = "DependencyError";
      constructor(message) {
        super(message, "DEPENDENCY");
      }
    };
  }
});

// src/dependencies.ts
var dependencies_exports = {};
__export(dependencies_exports, {
  checkDependencies: () => checkDependencies
});
import { execFile as execFile3 } from "child_process";
import { promisify as promisify3 } from "util";
async function checkDependencies() {
  const deps = [
    { cmd: "pdftoppm", args: ["-v"], label: "poppler-utils (pdftoppm)" },
    { cmd: "ffprobe", args: ["-version"], label: "ffmpeg (ffprobe)" }
  ];
  for (const dep of deps) {
    try {
      await execFileAsync3(dep.cmd, dep.args, { timeout: 5e3 });
    } catch {
      const hint = dep.cmd === "pdftoppm" ? "Install with: sudo apt-get install poppler-utils" : "Install with: sudo apt-get install ffmpeg";
      throw new DependencyError(
        `Missing required dependency: ${dep.label}. ${hint}`
      );
    }
  }
  logger.info("All system dependencies satisfied");
}
var execFileAsync3;
var init_dependencies = __esm({
  "src/dependencies.ts"() {
    "use strict";
    init_errors();
    init_logger();
    execFileAsync3 = promisify3(execFile3);
  }
});

// src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// src/config.ts
import { z } from "zod";
var ConfigSchema = z.object({
  baseUrl: z.string().url(),
  model: z.string().min(1),
  allowedMediaPath: z.string().min(1),
  defaultMaxTokens: z.number().int().positive(),
  requestTimeoutMs: z.number().int().positive(),
  pdfDpi: z.number().int().min(72).max(300),
  logLevel: z.enum(["trace", "debug", "info", "warn", "error"]),
  tmpDir: z.string().min(1)
});
function loadConfig() {
  const homeDir = process.env.HOME || `/home/${process.env.USER || "user"}`;
  const raw = {
    baseUrl: process.env.NEMOTRON_OMNI_BASE_URL ?? "http://localhost:8000/v1",
    model: process.env.NEMOTRON_OMNI_MODEL ?? "nemotron_3_nano_omni",
    allowedMediaPath: process.env.NEMOTRON_OMNI_ALLOWED_MEDIA_PATH ?? homeDir,
    defaultMaxTokens: intOr(
      process.env.NEMOTRON_OMNI_DEFAULT_MAX_TOKENS,
      20480
    ),
    requestTimeoutMs: intOr(
      process.env.NEMOTRON_OMNI_REQUEST_TIMEOUT_MS,
      6e5
    ),
    pdfDpi: intOr(process.env.NEMOTRON_OMNI_PDF_DPI, 150),
    logLevel: process.env.NEMOTRON_OMNI_LOG_LEVEL ?? "info",
    tmpDir: process.env.NEMOTRON_OMNI_TMP_DIR ?? "/tmp"
  };
  return ConfigSchema.parse(raw);
}
function intOr(val, fallback) {
  if (val === void 0) return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

// src/index.ts
init_logger();

// src/client.ts
init_logger();
init_errors();
import OpenAI from "openai";

// src/reasoning.ts
function defaultsFor(modality) {
  switch (modality) {
    case "image":
      return { enableThinking: true, reasoningBudget: 16384 };
    case "document":
      return { enableThinking: true, reasoningBudget: 16384 };
    case "audio":
      return { enableThinking: false };
    case "video":
      return { enableThinking: false };
    case "omni":
      return { enableThinking: false };
    case "transcribe":
      return { enableThinking: false };
  }
}
function autoResolveThinking(hasImage, hasAudio, hasVideo) {
  if (hasVideo) return { enableThinking: false };
  if (hasImage && !hasAudio) return { enableThinking: true, reasoningBudget: 16384 };
  return { enableThinking: false };
}
function parseResponse(raw) {
  const CLOSE_TAG = "</think";
  const idx = raw.indexOf(CLOSE_TAG);
  if (idx === -1) {
    return {
      reasoningContent: "",
      content: raw.trim(),
      warning: "no_think_delimiter"
    };
  }
  const closeEnd = raw.indexOf(">", idx);
  const tagEnd = closeEnd === -1 ? idx + CLOSE_TAG.length + 1 : closeEnd + 1;
  let reasoning = raw.slice(0, idx);
  const thinkOpenIdx = reasoning.indexOf("<think");
  if (thinkOpenIdx !== -1) {
    const thinkOpenEnd = reasoning.indexOf(">", thinkOpenIdx);
    if (thinkOpenEnd !== -1) {
      reasoning = reasoning.slice(thinkOpenEnd + 1);
    } else {
      reasoning = reasoning.slice(thinkOpenIdx + "<think".length);
    }
  }
  return {
    reasoningContent: reasoning.trim(),
    content: raw.slice(tagEnd).trim()
  };
}
function mergeReasoning(defaults, override, budget) {
  const enableThinking = override ?? defaults.enableThinking;
  const reasoningBudget = budget ?? defaults.reasoningBudget;
  return {
    enableThinking,
    ...reasoningBudget !== void 0 ? { reasoningBudget } : {}
  };
}

// src/client.ts
var OmniClient = class {
  client;
  config;
  constructor(cfg) {
    this.config = cfg;
    this.client = new OpenAI({
      baseURL: cfg.baseUrl,
      apiKey: "EMPTY",
      timeout: cfg.requestTimeoutMs,
      maxRetries: 0
      // We handle retries ourselves
    });
  }
  /**
   * Health check: GET /models with 2s timeout.
   * Implements: R9.1, R9.2
   */
  async health() {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2e3);
      const resp = await fetch(`${this.config.baseUrl}/models`, {
        signal: controller.signal
      });
      clearTimeout(timer);
      const data = await resp.json();
      const model = data.data?.[0]?.id ?? this.config.model;
      return {
        healthy: true,
        baseUrl: this.config.baseUrl,
        model,
        responseTimeMs: Date.now() - start
      };
    } catch (err) {
      return {
        healthy: false,
        baseUrl: this.config.baseUrl,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }
  /**
   * Send a chat completion request with retry-on-5xx.
   * Implements: R7.1, R7.3, R10.2, R10.3
   */
  async chat(req) {
    const start = Date.now();
    const messages = this.buildMessages(req);
    const extraBody = this.buildExtraBody(req);
    if (req.reasoning.enableThinking && req.reasoning.reasoningBudget && req.reasoning.reasoningBudget > 0) {
      return this.budgetControlledChat(req, messages, extraBody, start);
    }
    const chatParams = {
      model: this.config.model,
      messages,
      max_tokens: req.maxTokens ?? this.config.defaultMaxTokens,
      temperature: req.temperature ?? this.getDefaultTemp(req.reasoning.enableThinking),
      ...req.topP !== void 0 ? { top_p: req.topP } : {},
      ...extraBody
    };
    logger.debug({ request: this.sanitizeForLog(chatParams) }, "chat request");
    const result = await this.doChatWithRetry(chatParams);
    const parsed = parseResponse(result.content);
    const response = {
      ...parsed,
      durationMs: Date.now() - start,
      promptTokens: result.usage?.prompt_tokens ?? 0,
      completionTokens: result.usage?.completion_tokens ?? 0
    };
    logger.debug(
      { response: { durationMs: response.durationMs, promptTokens: response.promptTokens, completionTokens: response.completionTokens, contentLength: response.content.length } },
      "chat response"
    );
    return response;
  }
  // ─── Private ──────────────────────────────────────────────────────────
  buildMessages(req) {
    const content = [];
    for (const part of req.parts) {
      switch (part.type) {
        case "text":
          content.push({ type: "text", text: part.text });
          break;
        case "image_url":
          content.push({
            type: "image_url",
            image_url: { url: part.imageUrl }
          });
          break;
        case "input_audio":
          content.push({
            type: "input_audio",
            input_audio: { data: part.audioUrl, format: "url" }
          });
          break;
        case "video_url":
          content.push({
            type: "video_url",
            // Cast for vLLM compatibility
            video_url: { url: part.videoUrl }
          });
          break;
      }
    }
    const messages = [
      { role: "user", content }
    ];
    return messages;
  }
  buildExtraBody(req) {
    const extra = {};
    const chatTemplateKwargs = {};
    if (req.reasoning.enableThinking) {
      chatTemplateKwargs.enable_thinking = true;
      if (req.reasoning.reasoningBudget) {
        const grace = req.reasoning.gracePeriod ?? 1024;
        extra.thinking_token_budget = req.reasoning.reasoningBudget + grace;
        chatTemplateKwargs.reasoning_budget = req.reasoning.reasoningBudget;
      }
    } else {
      chatTemplateKwargs.enable_thinking = false;
    }
    extra.chat_template_kwargs = chatTemplateKwargs;
    if (req.topK !== void 0) {
      extra.top_k = req.topK;
    }
    if (req.useAudioInVideo) {
      extra.mm_processor_kwargs = { use_audio_in_video: true };
    }
    return extra;
  }
  getDefaultTemp(enableThinking) {
    return enableThinking ? 0.6 : 0.2;
  }
  /**
   * R11.2: Sanitize request for debug logging.
   * Logs everything except media content (only paths/URLs are kept).
   */
  sanitizeForLog(params) {
    const sanitized = { ...params };
    if (Array.isArray(sanitized.messages)) {
      sanitized.messages = sanitized.messages.map(
        (msg) => {
          if (Array.isArray(msg.content)) {
            return {
              ...msg,
              content: msg.content.map(
                (part) => {
                  if (part.type === "image_url" || part.type === "video_url" || part.type === "input_audio") {
                    const urlKey = part.type === "image_url" ? "image_url" : part.type === "video_url" ? "video_url" : "input_audio";
                    const nested = part[urlKey];
                    return { type: part.type, [urlKey]: nested ? { url: nested.url ?? "[path]" } : "[media]" };
                  }
                  return part;
                }
              )
            };
          }
          return msg;
        }
      );
    }
    return sanitized;
  }
  /**
   * Budget-controlled two-step inference pattern.
   * Implements: R7.1
   * Step 1: Generate up to reasoning_budget tokens
   * Step 2: Force-close thinking, generate final answer
   */
  async budgetControlledChat(req, messages, extraBody, start) {
    const budget = req.reasoning.reasoningBudget;
    const grace = req.reasoning.gracePeriod ?? 1024;
    const thinkingResult = await this.doChatWithRetry({
      model: this.config.model,
      messages,
      max_tokens: budget + grace,
      temperature: req.temperature ?? 0.6,
      top_p: req.topP ?? 0.95,
      ...extraBody
    });
    const thinkingContent = thinkingResult.content;
    const thinkEnd = thinkingContent.includes("</think");
    if (thinkEnd) {
      const parsed2 = parseResponse(thinkingContent);
      return {
        ...parsed2,
        durationMs: Date.now() - start,
        promptTokens: thinkingResult.usage?.prompt_tokens ?? 0,
        completionTokens: thinkingResult.usage?.completion_tokens ?? 0
      };
    }
    const forceClosePrompt = `${thinkingContent}
</think
>`;
    const continuationMessages = [
      {
        role: "user",
        content: "Continue and provide your final answer based on your reasoning above."
      },
      {
        role: "assistant",
        content: forceClosePrompt
      }
    ];
    const finalResult = await this.doCompletionWithRetry({
      model: this.config.model,
      prompt: `<|user|>
Continue and provide your final answer.
<|assistant|
>${forceClosePrompt}`,
      max_tokens: req.maxTokens ?? this.config.defaultMaxTokens,
      temperature: req.temperature ?? 0.6,
      ...extraBody
    });
    const fullContent = `${thinkingContent}
</think
>${finalContent(finalResult)}`;
    const parsed = parseResponse(fullContent);
    return {
      ...parsed,
      durationMs: Date.now() - start,
      promptTokens: (thinkingResult.usage?.prompt_tokens ?? 0) + (finalResult.usage?.prompt_tokens ?? 0),
      completionTokens: (thinkingResult.usage?.completion_tokens ?? 0) + (finalResult.usage?.completion_tokens ?? 0)
    };
  }
  /**
   * Execute chat completion with retry-on-5xx (R10.2).
   */
  async doChatWithRetry(params) {
    try {
      return await this.client.chat.completions.create({
        ...params,
        stream: false
      });
    } catch (err) {
      if (is5xx(err)) {
        logger.warn({ err }, "5xx from vLLM, retrying after 1s");
        await sleep(1e3);
        try {
          return await this.client.chat.completions.create({
            ...params,
            stream: false
          });
        } catch (retryErr) {
          throw new UpstreamError(
            `vLLM returned 5xx after retry: ${errorMessage(retryErr)}`
          );
        }
      }
      if (isTimeout(err)) {
        throw new TimeoutError(
          `Request exceeded timeout of ${this.config.requestTimeoutMs}ms`
        );
      }
      throw new UpstreamError(`vLLM error: ${errorMessage(err)}`);
    }
  }
  /**
   * Execute completion with retry-on-5xx (for budget-controlled step 2).
   */
  async doCompletionWithRetry(params) {
    try {
      const resp = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...params,
          stream: false
        }),
        signal: AbortSignal.timeout(this.config.requestTimeoutMs)
      });
      if (!resp.ok) {
        if (resp.status >= 500) {
          logger.warn({ status: resp.status }, "5xx on completion, retrying");
          await sleep(1e3);
          const retryResp = await fetch(
            `${this.config.baseUrl}/chat/completions`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...params, stream: false }),
              signal: AbortSignal.timeout(this.config.requestTimeoutMs)
            }
          );
          if (!retryResp.ok) {
            throw new UpstreamError(
              `vLLM completion returned ${retryResp.status} after retry`
            );
          }
          const retryData = await retryResp.json();
          return extractCompletion(retryData);
        }
        throw new UpstreamError(
          `vLLM completion returned ${resp.status}`
        );
      }
      const data = await resp.json();
      return extractCompletion(data);
    } catch (err) {
      if (err instanceof UpstreamError || err instanceof TimeoutError) throw err;
      if (isTimeout(err)) {
        throw new TimeoutError(
          `Completion request exceeded timeout of ${this.config.requestTimeoutMs}ms`
        );
      }
      throw new UpstreamError(`vLLM completion error: ${errorMessage(err)}`);
    }
  }
};
function extractCompletion(data) {
  const d = data;
  return {
    content: d.choices?.[0]?.message?.content ?? "",
    usage: d.usage
  };
}
function finalContent(result) {
  return result.content;
}
function is5xx(err) {
  if (err && typeof err === "object" && "status" in err) {
    const status = err.status;
    return status >= 500 && status < 600;
  }
  return false;
}
function isTimeout(err) {
  if (err instanceof Error) {
    return err.name === "TimeoutError" || err.name === "AbortError" || err.message.includes("timeout") || err.message.includes("ETIMEDOUT");
  }
  return false;
}
function errorMessage(err) {
  if (err instanceof Error) return err.message;
  return String(err);
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// src/media.ts
init_errors();
import { realpath, stat } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
var execFileAsync = promisify(execFile);
var IMAGE_EXT = [".jpg", ".jpeg", ".png", ".webp"];
var AUDIO_EXT = [".wav", ".mp3"];
var VIDEO_EXT = [".mp4"];
var PDF_EXT = [".pdf"];
var MediaHandler = class {
  allowedPath;
  constructor(cfg) {
    this.allowedPath = cfg.allowedMediaPath;
  }
  /**
   * Validate an image path and return a file:// URI.
   * Implements: R2.1, R2.4
   */
  async assertImage(filePath) {
    const resolved = await this.validate(
      filePath,
      IMAGE_EXT,
      "image",
      IMAGE_EXT.join(", ")
    );
    return toFileUri(resolved);
  }
  /**
   * Validate an audio path and return a file:// URI.
   * Duration must be ≤ maxDurationSec (default 3600).
   * Implements: R3.1
   */
  async assertAudio(filePath, maxDurationSec = 3600) {
    const resolved = await this.validate(
      filePath,
      AUDIO_EXT,
      "audio",
      AUDIO_EXT.join(", ")
    );
    const dur = await probeDurationSec(resolved);
    if (dur > maxDurationSec) {
      throw new MediaValidationError(
        `Audio duration ${dur.toFixed(1)}s exceeds maximum ${maxDurationSec}s`
      );
    }
    return toFileUri(resolved);
  }
  /**
   * Validate a video path and return a file:// URI.
   * Duration must be ≤ maxDurationSec (default 120).
   * Implements: R4.1
   */
  async assertVideo(filePath, maxDurationSec = 120) {
    const resolved = await this.validate(
      filePath,
      VIDEO_EXT,
      "video",
      VIDEO_EXT.join(", ")
    );
    const dur = await probeDurationSec(resolved);
    if (dur > maxDurationSec) {
      throw new MediaValidationError(
        `Video duration ${dur.toFixed(1)}s exceeds maximum ${maxDurationSec}s`
      );
    }
    return toFileUri(resolved);
  }
  /**
   * Validate a PDF path and return the absolute resolved path (not URI).
   * Implements: R5.1
   */
  async assertPdf(filePath) {
    return this.validate(filePath, PDF_EXT, "PDF", PDF_EXT.join(", "));
  }
  /**
   * Convert absolute path to file:// URI, encoding spaces and special chars.
   * Uses encodeURI (not encodeURIComponent) so / separators are preserved.
   */
  toFileUri(absPath) {
    return toFileUri(absPath);
  }
  // ─── Internal ─────────────────────────────────────────────────────────
  async validate(filePath, allowedExt, label, extList) {
    let resolved;
    try {
      resolved = await realpath(filePath);
    } catch {
      throw new MediaValidationError(
        `${label} file not found: ${filePath}`
      );
    }
    if (!resolved.startsWith(this.allowedPath)) {
      throw new PathSecurityError(
        `Path '${filePath}' is outside allowed media directory '${this.allowedPath}'. Set NEMOTRON_OMNI_ALLOWED_MEDIA_PATH to allow access.`
      );
    }
    const ext = getExt(resolved).toLowerCase();
    if (!allowedExt.includes(ext)) {
      throw new MediaValidationError(
        `Unsupported ${label} extension '${ext}'. Allowed: ${extList}`
      );
    }
    const info = await stat(resolved);
    if (info.size === 0) {
      throw new MediaValidationError(
        `${label} file is empty: ${filePath}`
      );
    }
    return resolved;
  }
};
function getExt(p) {
  const idx = p.lastIndexOf(".");
  return idx === -1 ? "" : p.slice(idx);
}
function toFileUri(absPath) {
  return `file://${encodeURI(absPath)}`;
}
async function probeDurationSec(filePath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath
  ]);
  const dur = parseFloat(stdout.trim());
  if (!Number.isFinite(dur)) {
    throw new MediaValidationError(
      `Could not determine duration for: ${filePath}`
    );
  }
  return dur;
}

// src/tools/omni_health.ts
import { z as z3 } from "zod";

// src/tool-utils.ts
init_logger();
init_errors();
import { z as z2 } from "zod";
function withLogging(toolName, handler) {
  return async (params) => {
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
          status: result.isError ? "error" : "ok"
        },
        "tool call completed"
      );
      return result;
    } catch (err) {
      const durationMs = Date.now() - start;
      if (err instanceof z2.ZodError) {
        logger.info(
          {
            tool_name: toolName,
            request_id: requestId,
            duration_ms: durationMs,
            status: "validation_error"
          },
          "tool call validation failed"
        );
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Error (-32602): Invalid parameters: ${err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`
            }
          ]
        };
      }
      logger.info(
        {
          tool_name: toolName,
          request_id: requestId,
          duration_ms: durationMs,
          status: "unhandled_error",
          error: err instanceof Error ? err.message : String(err)
        },
        "tool call failed"
      );
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Error (${toMcpErrorCode(err)}): ${toMcpErrorMessage(err)}`
          }
        ]
      };
    }
  };
}

// src/tools/omni_health.ts
function registerHealthTool(server, client) {
  server.registerTool(
    "omni_health",
    {
      title: "Omni Perception Health Check",
      description: "Probe the upstream vLLM inference server. Always returns a result (never throws). Returns {healthy: true, model, base_url, response_time_ms} on success, or {healthy: false, error, base_url} on failure.",
      inputSchema: z3.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    withLogging("omni_health", async () => {
      const result = await client.health();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    })
  );
}

// src/tools/analyze_image.ts
import { z as z4 } from "zod";
var InputSchema = z4.object({
  path: z4.string().describe("Absolute local path to image file (.jpg, .jpeg, .png, .webp)"),
  prompt: z4.string().min(1).describe("What to analyze/describe in the image"),
  thinking: z4.boolean().optional().describe("Enable reasoning mode (default: true)"),
  reasoning_budget: z4.number().int().positive().optional().describe("Max reasoning tokens (default: 16384)"),
  max_tokens: z4.number().int().positive().optional().describe("Max output tokens (default: 20480)")
});
function registerAnalyzeImage(server, client, media) {
  server.registerTool(
    "analyze_image",
    {
      title: "Analyze Image",
      description: "Analyze an image using the Nemotron Omni model. Supports OCR, chart reading, scene description, GUI screenshot interpretation, and visual reasoning. Reasoning mode is ON by default for deeper analysis.",
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    withLogging("analyze_image", async (params) => {
      const uri = await media.assertImage(params.path);
      const defaults = defaultsFor("image");
      const reasoning = mergeReasoning(
        defaults,
        params.thinking,
        params.reasoning_budget
      );
      const req = {
        parts: [
          { type: "image_url", imageUrl: uri },
          { type: "text", text: params.prompt }
        ],
        reasoning,
        maxTokens: params.max_tokens,
        topP: reasoning.enableThinking ? 0.95 : void 0
      };
      const result = await client.chat(req);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                content: result.content,
                reasoning_content: result.reasoningContent,
                duration_ms: result.durationMs,
                ...result.warning ? { warning: result.warning } : {}
              },
              null,
              2
            )
          }
        ]
      };
    })
  );
}

// src/tools/analyze_audio.ts
import { z as z5 } from "zod";
var AnalyzeAudioSchema = z5.object({
  path: z5.string().describe("Absolute local path to audio file (.wav, .mp3). Max duration: 3600s (1 hour)"),
  prompt: z5.string().min(1).describe("Question or instruction about the audio content"),
  thinking: z5.boolean().optional().describe("Enable reasoning mode (default: false)"),
  max_tokens: z5.number().int().positive().optional().describe("Max output tokens (default: 20480)")
});
var TranscribeAudioSchema = z5.object({
  path: z5.string().describe("Absolute local path to audio file (.wav, .mp3)"),
  word_timestamps: z5.boolean().optional().describe("Include word-level timestamps (default: false)"),
  language_hint: z5.string().optional().describe("Language hint, e.g. 'en' (English only in v1)")
});
function registerAnalyzeAudio(server, client, media) {
  server.registerTool(
    "analyze_audio",
    {
      title: "Analyze Audio",
      description: "Analyze or answer questions about an audio file (call recording, podcast, lecture). Supports summarization, Q&A, and content extraction. Max duration: 1 hour. Reasoning mode OFF by default.",
      inputSchema: AnalyzeAudioSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    withLogging("analyze_audio", async (params) => {
      const uri = await media.assertAudio(params.path);
      const defaults = defaultsFor("audio");
      const reasoning = mergeReasoning(defaults, params.thinking);
      const req = {
        parts: [
          { type: "input_audio", audioUrl: uri },
          { type: "text", text: params.prompt }
        ],
        reasoning,
        maxTokens: params.max_tokens
      };
      const result = await client.chat(req);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                content: result.content,
                reasoning_content: result.reasoningContent,
                duration_ms: result.durationMs,
                ...result.warning ? { warning: result.warning } : {}
              },
              null,
              2
            )
          }
        ]
      };
    })
  );
}
function registerTranscribeAudio(server, client, media) {
  server.registerTool(
    "transcribe_audio",
    {
      title: "Transcribe Audio",
      description: "Transcribe speech from an audio file to text. Pure ASR with high accuracy. Uses temperature=0.2 and top_k=1 for deterministic transcription. Optionally includes word-level timestamps.",
      inputSchema: TranscribeAudioSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    withLogging("transcribe_audio", async (params) => {
      const uri = await media.assertAudio(params.path);
      const defaults = defaultsFor("transcribe");
      let systemSuffix = "Transcribe this audio.";
      if (params.word_timestamps) {
        systemSuffix += " Include word-level timestamps.";
      }
      const req = {
        parts: [
          { type: "input_audio", audioUrl: uri },
          { type: "text", text: systemSuffix }
        ],
        reasoning: defaults,
        temperature: 0.2,
        topK: 1,
        maxTokens: 20480
      };
      const result = await client.chat(req);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                content: result.content,
                reasoning_content: result.reasoningContent,
                duration_ms: result.durationMs,
                ...result.warning ? { warning: result.warning } : {}
              },
              null,
              2
            )
          }
        ]
      };
    })
  );
}

// src/tools/analyze_video.ts
import { z as z6 } from "zod";
var InputSchema2 = z6.object({
  path: z6.string().describe("Absolute local path to video file (.mp4). Max duration: 120s (2 minutes)"),
  prompt: z6.string().min(1).describe("What to analyze in the video"),
  with_audio: z6.boolean().optional().describe("Include audio track from video (default: true)"),
  thinking: z6.boolean().optional().describe("Enable reasoning mode (default: false)"),
  fps: z6.number().positive().optional().describe("Frames per second to sample (default: server-level 2)"),
  num_frames: z6.number().int().positive().optional().describe("Max number of frames (default: server-level 256)"),
  max_tokens: z6.number().int().positive().optional().describe("Max output tokens (default: 20480)")
});
function registerAnalyzeVideo(server, client, media) {
  server.registerTool(
    "analyze_video",
    {
      title: "Analyze Video",
      description: "Analyze a video file using the Nemotron Omni model. Supports visual understanding, action description, and optionally audio transcription from the video's audio track. Max duration: 120 seconds. Reasoning mode OFF by default for speed.",
      inputSchema: InputSchema2,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    withLogging("analyze_video", async (params) => {
      const uri = await media.assertVideo(params.path, 120);
      const defaults = defaultsFor("video");
      const reasoning = mergeReasoning(defaults, params.thinking);
      const useAudio = params.with_audio !== false;
      const req = {
        parts: [
          { type: "video_url", videoUrl: uri },
          { type: "text", text: params.prompt }
        ],
        reasoning,
        useAudioInVideo: useAudio,
        maxTokens: params.max_tokens
      };
      const result = await client.chat(req);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                content: result.content,
                reasoning_content: result.reasoningContent,
                duration_ms: result.durationMs,
                ...result.warning ? { warning: result.warning } : {}
              },
              null,
              2
            )
          }
        ]
      };
    })
  );
}

// src/tools/analyze_document.ts
import { z as z7 } from "zod";

// src/pdf.ts
init_logger();
import { execFile as execFile2 } from "child_process";
import { promisify as promisify2 } from "util";
import { mkdtemp, readdir, rm } from "fs/promises";
import { join } from "path";
var execFileAsync2 = promisify2(execFile2);
var PdfRenderer = class {
  dpi;
  tmpDir;
  constructor(cfg) {
    this.dpi = cfg.pdfDpi;
    this.tmpDir = cfg.tmpDir;
  }
  /**
   * Render specified pages of a PDF to PNG images.
   * @param pdfPath - Absolute path to the PDF file
   * @param pages - "all" or array of 1-indexed page numbers
   * @returns RenderedPdf with cleanup function
   */
  async render(pdfPath, pages) {
    const workDir = await mkdtemp(join(this.tmpDir, "omni-mcp-pdf-"));
    try {
      const pageCount = await this.getPageCount(pdfPath);
      if (pageCount > 50) {
        logger.warn(
          { pageCount, pdfPath },
          "Large PDF: %d pages, proceeding anyway"
        );
      }
      const firstPage = pages === "all" ? void 0 : Math.min(...pages);
      const lastPage = pages === "all" ? void 0 : Math.max(...pages);
      const args = ["-r", String(this.dpi), "-png"];
      if (firstPage !== void 0) args.push("-f", String(firstPage));
      if (lastPage !== void 0) args.push("-l", String(lastPage));
      args.push(pdfPath, join(workDir, "page"));
      await execFileAsync2("pdftoppm", args, { timeout: 12e4 });
      const files = await readdir(workDir);
      const pngFiles = files.filter((f) => f.endsWith(".png")).sort().map((f) => join(workDir, f));
      const pageResults = [];
      const startIdx = firstPage ?? 1;
      for (let i = 0; i < pngFiles.length; i++) {
        const pageNum = startIdx + i;
        if (pages === "all" || pages.includes(pageNum)) {
          pageResults.push({ pageNumber: pageNum, pngPath: pngFiles[i] });
        }
      }
      return {
        tempDir: workDir,
        pageCount,
        pages: pageResults,
        cleanup: async () => {
          try {
            await rm(workDir, { recursive: true, force: true });
          } catch (err) {
            logger.warn({ err, workDir }, "Failed to cleanup temp dir");
          }
        }
      };
    } catch (err) {
      try {
        await rm(workDir, { recursive: true, force: true });
      } catch {
      }
      throw err;
    }
  }
  /**
   * Get total page count via pdfinfo.
   */
  async getPageCount(pdfPath) {
    const { stdout } = await execFileAsync2("pdfinfo", [
      "-box",
      "-enc",
      "UTF-8",
      pdfPath
    ]);
    const match = stdout.match(/Pages:\s+(\d+)/);
    if (!match) {
      throw new Error(`Could not determine page count for: ${pdfPath}`);
    }
    return parseInt(match[1], 10);
  }
};

// src/tools/analyze_document.ts
var InputSchema3 = z7.object({
  path: z7.string().describe("Absolute local path to PDF file"),
  prompt: z7.string().min(1).describe("What to extract or analyze from the document"),
  pages: z7.union([
    z7.literal("all"),
    z7.number().int().positive(),
    z7.array(z7.number().int().positive())
  ]).optional().describe("Pages to process: 'all', a single page number, or array of page numbers (1-indexed). Default: 'all'"),
  aggregate: z7.boolean().optional().describe("Generate aggregate summary across all pages (default: true if pages != single number)"),
  dpi: z7.number().int().optional().describe("DPI for rendering (default: 150)"),
  thinking: z7.boolean().optional().describe("Enable reasoning mode (default: true)"),
  reasoning_budget: z7.number().int().positive().optional().describe("Max reasoning tokens (default: 16384)"),
  max_tokens: z7.number().int().positive().optional().describe("Max output tokens per page (default: 20480)")
});
function registerAnalyzeDocument(server, client, media, cfg) {
  const pdfRenderer = new PdfRenderer({
    pdfDpi: cfg.pdfDpi,
    tmpDir: cfg.tmpDir
  });
  server.registerTool(
    "analyze_document",
    {
      title: "Analyze Document (PDF)",
      description: "Analyze a PDF document by rendering pages to images and processing each page. Supports OCR, table extraction, chart reading, and text understanding. Can process specific pages or all pages, with optional cross-page aggregation. Reasoning mode ON by default.",
      inputSchema: InputSchema3,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    withLogging("analyze_document", async (params) => {
      const pdfPath = await media.assertPdf(params.path);
      const pageSpec = params.pages ?? "all";
      const pages = pageSpec === "all" ? "all" : typeof pageSpec === "number" ? [pageSpec] : pageSpec;
      const shouldAggregate = params.aggregate ?? (pages === "all" || pages.length > 1);
      const rendered = await pdfRenderer.render(pdfPath, pages);
      try {
        const defaults = defaultsFor("document");
        const reasoning = mergeReasoning(
          defaults,
          params.thinking,
          params.reasoning_budget
        );
        const perPage = [];
        for (const page of rendered.pages) {
          const uri = toFileUri(page.pngPath);
          const req = {
            parts: [
              { type: "image_url", imageUrl: uri },
              {
                type: "text",
                text: `Page ${page.pageNumber} of the document.

${params.prompt}`
              }
            ],
            reasoning,
            maxTokens: params.max_tokens,
            topP: reasoning.enableThinking ? 0.95 : void 0
          };
          const result = await client.chat(req);
          perPage.push({
            page: page.pageNumber,
            content: result.content,
            reasoning_content: result.reasoningContent
          });
        }
        let summary;
        if (shouldAggregate && perPage.length > 1) {
          const perPageSummaries = perPage.map((p) => `--- Page ${p.page} ---
${p.content}`).join("\n\n");
          const aggReq = {
            parts: [
              {
                type: "text",
                text: `You analyzed each page individually. Per-page summaries follow. Answer the user prompt holistically.

${perPageSummaries}

User prompt: ${params.prompt}`
              }
            ],
            reasoning,
            maxTokens: params.max_tokens ?? cfg.defaultMaxTokens
          };
          const aggResult = await client.chat(aggReq);
          summary = aggResult.content;
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  per_page: perPage,
                  ...summary ? { summary } : {},
                  page_count: rendered.pageCount
                },
                null,
                2
              )
            }
          ]
        };
      } finally {
        await rendered.cleanup();
      }
    })
  );
}

// src/tools/analyze_multimodal.ts
import { z as z8 } from "zod";
var InputSchema4 = z8.object({
  prompt: z8.string().min(1).describe("The question or instruction about the provided media"),
  image_path: z8.string().optional().describe("Absolute local path to an image file"),
  audio_path: z8.string().optional().describe("Absolute local path to an audio file"),
  video_path: z8.string().optional().describe("Absolute local path to a video file (.mp4, max 120s)"),
  thinking: z8.union([z8.boolean(), z8.literal("auto")]).optional().describe("Enable reasoning: true, false, or 'auto' (default: 'auto')"),
  with_audio_in_video: z8.boolean().optional().describe("Include audio track when analyzing video (default: true)"),
  max_tokens: z8.number().int().positive().optional().describe("Max output tokens (default: 20480)")
}).refine(
  (d) => d.image_path || d.audio_path || d.video_path,
  {
    message: "At least one of image_path, audio_path, or video_path is required. Use a text-only LLM for pure text prompts."
  }
);
function registerAnalyzeMultimodal(server, client, media) {
  server.registerTool(
    "analyze_multimodal",
    {
      title: "Analyze Multimodal",
      description: "Analyze multiple modalities (image, audio, video) in a single call. At most ONE of each modality per call (Spark serving limit). Automatically selects optimal reasoning mode based on provided modalities. This is the full omni primitive for cross-modal reasoning.",
      inputSchema: InputSchema4,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    withLogging("analyze_multimodal", async (params) => {
      const hasImage = !!params.image_path;
      const hasAudio = !!params.audio_path;
      const hasVideo = !!params.video_path;
      let reasoning;
      if (params.thinking === "auto" || params.thinking === void 0) {
        reasoning = autoResolveThinking(hasImage, hasAudio, hasVideo);
      } else {
        reasoning = mergeReasoning(
          autoResolveThinking(hasImage, hasAudio, hasVideo),
          params.thinking
        );
      }
      const parts = [];
      if (params.image_path) {
        const uri = await media.assertImage(params.image_path);
        parts.push({ type: "image_url", imageUrl: uri });
      }
      if (params.audio_path) {
        const uri = await media.assertAudio(params.audio_path);
        parts.push({ type: "input_audio", audioUrl: uri });
      }
      if (params.video_path) {
        const uri = await media.assertVideo(params.video_path, 120);
        parts.push({ type: "video_url", videoUrl: uri });
      }
      parts.push({ type: "text", text: params.prompt });
      const useAudioInVideo = params.with_audio_in_video !== false && hasVideo;
      const req = {
        parts,
        reasoning,
        useAudioInVideo,
        maxTokens: params.max_tokens
      };
      const result = await client.chat(req);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                content: result.content,
                reasoning_content: result.reasoningContent,
                duration_ms: result.durationMs,
                ...result.warning ? { warning: result.warning } : {}
              },
              null,
              2
            )
          }
        ]
      };
    })
  );
}

// src/tools/compare_images.ts
import { z as z9 } from "zod";
var InputSchema5 = z9.object({
  image_a: z9.string().describe("Absolute local path to the first image (Image A)"),
  image_b: z9.string().describe("Absolute local path to the second image (Image B)"),
  prompt: z9.string().optional().describe("What to compare (default: 'What are the differences? List every change.')"),
  thinking: z9.boolean().optional().describe("Enable reasoning mode (default: true)"),
  max_tokens: z9.number().int().positive().optional().describe("Max output tokens (default: 20480)")
});
function registerCompareImages(server, client, media) {
  server.registerTool(
    "compare_images",
    {
      title: "Compare Two Images",
      description: "Compare two images side-by-side and describe the visual differences. Labels them as 'Image A' and 'Image B' for clear reference. Use for UI regression testing, before/after comparisons, document revision tracking, security camera diffs, or any visual change detection.",
      inputSchema: InputSchema5,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    withLogging("compare_images", async (params) => {
      const uriA = await media.assertImage(params.image_a);
      const uriB = await media.assertImage(params.image_b);
      const prompt = params.prompt ?? "What are the differences between these two images? List every change you can find.";
      const req = {
        parts: [
          { type: "text", text: "I am showing you two images. The first image (Image A) and the second image (Image B)." },
          { type: "image_url", imageUrl: uriA },
          { type: "text", text: "Above is Image A. Below is Image B." },
          { type: "image_url", imageUrl: uriB },
          { type: "text", text: prompt }
        ],
        reasoning: {
          enableThinking: params.thinking ?? true,
          ...params.thinking !== false ? { reasoningBudget: 16384 } : {}
        },
        maxTokens: params.max_tokens,
        topP: params.thinking !== false ? 0.95 : void 0
      };
      const result = await client.chat(req);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                content: result.content,
                reasoning_content: result.reasoningContent,
                duration_ms: result.durationMs,
                ...result.warning ? { warning: result.warning } : {}
              },
              null,
              2
            )
          }
        ]
      };
    })
  );
}

// src/tools/extract_data.ts
import { z as z10 } from "zod";
var InputSchema6 = z10.object({
  path: z10.string().describe("Absolute local path to image or PDF file"),
  fields: z10.string().describe("What to extract, as comma-separated field names. Example: 'vendor, date, total, line_items'"),
  format: z10.enum(["json", "csv"]).optional().describe("Output format (default: json)"),
  thinking: z10.boolean().optional().describe("Enable reasoning mode (default: false)")
});
function registerExtractData(server, client, media, cfg) {
  const pdfRenderer = new PdfRenderer({ pdfDpi: cfg.pdfDpi, tmpDir: cfg.tmpDir });
  server.registerTool(
    "extract_data",
    {
      title: "Extract Structured Data",
      description: "Extract structured data from an image or PDF as JSON or CSV. Forces deterministic output with low temperature. Use for receipts, invoices, tables, forms, or any document where you need specific fields extracted into a machine-readable format.",
      inputSchema: InputSchema6,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    withLogging("extract_data", async (params) => {
      const format = params.format ?? "json";
      const ext = params.path.split(".").pop()?.toLowerCase() ?? "";
      let imageUri;
      let cleanup = null;
      try {
        if (ext === "pdf") {
          const pdfPath = await media.assertPdf(params.path);
          const rendered = await pdfRenderer.render(pdfPath, [1]);
          cleanup = rendered.cleanup;
          imageUri = toFileUri(rendered.pages[0].pngPath);
        } else {
          imageUri = await media.assertImage(params.path);
        }
        const outputInstruction = format === "json" ? 'Output ONLY valid JSON. No markdown, no explanation, no code fences. Just raw JSON. Schema: {"extracted": {<field_names>: <values>}}' : "Output ONLY valid CSV with a header row. No markdown, no explanation, no code fences.";
        const systemPrompt = `You are a precise data extraction engine. Extract the following fields: ${params.fields}

Rules:
- If a field is not found, use null
- Be exact with numbers \u2014 do not round or approximate
- ${outputInstruction}`;
        const req = {
          parts: [
            { type: "image_url", imageUrl: imageUri },
            { type: "text", text: `Extract: ${params.fields}` }
          ],
          reasoning: { enableThinking: params.thinking ?? false },
          maxTokens: 8192,
          temperature: 0.1
        };
        const result = await client.chat(req);
        let data = null;
        let parseWarning;
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
              type: "text",
              text: JSON.stringify(
                {
                  data,
                  raw: result.content,
                  format,
                  ...parseWarning ? { parse_warning: parseWarning } : {},
                  duration_ms: result.durationMs
                },
                null,
                2
              )
            }
          ]
        };
      } finally {
        await cleanup?.();
      }
    })
  );
}

// src/tools/video_timeline.ts
import { z as z11 } from "zod";
var InputSchema7 = z11.object({
  path: z11.string().describe("Absolute local path to video file (.mp4, max 120s)"),
  detail: z11.enum(["brief", "detailed", "keyframes"]).optional().describe("Detail level: brief (one line per scene), detailed (action/subjects/audio), keyframes (3-8 top moments). Default: detailed"),
  max_tokens: z11.number().int().positive().optional().describe("Max output tokens (default: 20480)")
});
function registerVideoTimeline(server, client, media) {
  server.registerTool(
    "video_timeline",
    {
      title: "Video Timeline Breakdown",
      description: "Generate a scene-by-scene timeline of a video with timestamps. Three detail levels: 'brief' (one line per scene), 'detailed' (action/subjects/audio per scene), 'keyframes' (3-8 most important moments only). Always includes the audio track. Max video duration: 120 seconds.",
      inputSchema: InputSchema7,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    withLogging("video_timeline", async (params) => {
      const uri = await media.assertVideo(params.path, 120);
      const detail = params.detail ?? "detailed";
      const prompts = {
        brief: "Analyze this video and provide a brief scene-by-scene timeline.\nFor each scene, output one line: [MM:SS - MM:SS] One-sentence description.\nKeep descriptions under 15 words. Focus on key actions and transitions.",
        detailed: "Analyze this video and provide a detailed scene-by-scene timeline.\nFor each scene:\n## Scene N [MM:SS - MM:SS]\n- **Action**: What is happening\n- **Subjects**: People, objects, or text visible\n- **Audio**: Speech, music, or sounds heard\n\nBe thorough. Note all visual changes, camera movements, on-screen text, and audio.",
        keyframes: "Analyze this video and identify the KEY MOMENTS \u2014 the most important things that happen.\nFor each key moment:\n### [MM:SS] \u2014 Title\n2-3 sentences describing what happens and why it matters.\n\nFocus on dramatic changes, important actions, on-screen text, and speech content.\nOnly list 3-8 key moments."
      };
      const req = {
        parts: [
          { type: "video_url", videoUrl: uri },
          { type: "text", text: prompts[detail] ?? prompts.detailed }
        ],
        reasoning: { enableThinking: false },
        useAudioInVideo: true,
        maxTokens: params.max_tokens
      };
      const result = await client.chat(req);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                timeline: result.content,
                detail_level: detail,
                duration_ms: result.durationMs
              },
              null,
              2
            )
          }
        ]
      };
    })
  );
}

// src/tools/describe_media.ts
import { z as z12 } from "zod";
var InputSchema8 = z12.object({
  path: z12.string().describe("Absolute local path to image, video, or audio file"),
  context: z12.enum(["general", "ecommerce", "documentation", "social", "article", "presentation"]).optional().describe("Context for the description (default: general)"),
  max_length: z12.number().int().positive().optional().describe("Max character length for the description (default: 250)")
});
var CONTEXT_PROMPTS = {
  general: (m, n) => `Write clear, concise alt text for this ${m}. Describe what is shown so someone who cannot see/hear it would understand it. Maximum ${n} characters. Rules: Do NOT start with 'Image of', 'Photo of', 'Video of'. Be specific: name objects, colors, actions, text, people, settings.`,
  ecommerce: (m, n) => `Write alt text for this ${m} for an e-commerce product page. Describe the product, its appearance, color, and key visual details. Maximum ${n} characters. Do not start with 'Image of' or 'Photo of'.`,
  documentation: (m, n) => `Write alt text for this ${m} for technical documentation. Describe the UI elements, layout, data, and any text visible. Maximum ${n} characters. Be precise and factual.`,
  social: (m, n) => `Write alt text for this ${m} for a social media post. Make it engaging but descriptive. Cover the main subject and mood. Maximum ${n} characters. Do not start with 'Image of'.`,
  article: (m, n) => `Write alt text for this ${m} for a news article or blog post. Describe what is shown in a way that adds context to the article. Maximum ${n} characters.`,
  presentation: (m, n) => `Write alt text for this ${m} for a presentation slide. Describe charts, graphs, diagrams, and key text. Note data points and trends. Maximum ${n} characters.`
};
function detectMediaType(path) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "webp"].includes(ext)) return "image";
  if (ext === "mp4") return "video";
  if (["wav", "mp3"].includes(ext)) return "audio";
  return "media";
}
function registerDescribeMedia(server, client, media) {
  server.registerTool(
    "describe_media",
    {
      title: "Generate Accessibility Description (Alt Text)",
      description: "Generate alt text or accessibility descriptions for images, videos, or audio. Context-aware: adapts output style for ecommerce, documentation, social media, articles, or presentations. Useful for web accessibility (WCAG), social media posts, product catalogs, and documentation.",
      inputSchema: InputSchema8,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    withLogging("describe_media", async (params) => {
      const context = params.context ?? "general";
      const maxLength = params.max_length ?? 250;
      const mediaType = detectMediaType(params.path);
      let uri;
      let useAudioInVideo = false;
      const ext = params.path.split(".").pop()?.toLowerCase() ?? "";
      if (["jpg", "jpeg", "png", "webp"].includes(ext)) {
        uri = await media.assertImage(params.path);
      } else if (ext === "mp4") {
        uri = await media.assertVideo(params.path, 120);
        useAudioInVideo = true;
      } else if (["wav", "mp3"].includes(ext)) {
        uri = await media.assertAudio(params.path);
      } else {
        throw new Error(`Unsupported file type: ${ext}`);
      }
      const promptFn = CONTEXT_PROMPTS[context] ?? CONTEXT_PROMPTS.general;
      const prompt = promptFn(mediaType, maxLength);
      const parts = [];
      if (mediaType === "image") {
        parts.push({ type: "image_url", imageUrl: uri });
      } else if (mediaType === "video") {
        parts.push({ type: "video_url", videoUrl: uri });
      } else {
        parts.push({ type: "input_audio", audioUrl: uri });
      }
      parts.push({ type: "text", text: prompt });
      const req = {
        parts,
        reasoning: { enableThinking: false },
        useAudioInVideo,
        maxTokens: 512,
        temperature: 0.2
      };
      const result = await client.chat(req);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                alt_text: result.content.trim(),
                media_type: mediaType,
                context,
                character_count: result.content.trim().length,
                max_length: maxLength,
                duration_ms: result.durationMs
              },
              null,
              2
            )
          }
        ]
      };
    })
  );
}

// src/tools/read_code.ts
import { z as z13 } from "zod";
var InputSchema9 = z13.object({
  path: z13.string().describe("Absolute local path to screenshot image"),
  language_hint: z13.string().optional().describe("Programming language hint (e.g., 'python', 'yaml', 'rust', 'bash'). Helps formatting.")
});
function registerReadCode(server, client, media) {
  server.registerTool(
    "read_code",
    {
      title: "Read Code from Screenshot",
      description: "Read code, stack traces, config files, or terminal output from a screenshot. Returns clean, copy-pasteable text with no commentary. Preserves indentation, line breaks, and formatting. Useful for extracting code from error screenshots, config screenshots, shared code snippets, and terminal output captures.",
      inputSchema: InputSchema9,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    withLogging("read_code", async (params) => {
      const uri = await media.assertImage(params.path);
      const langInstruction = params.language_hint ? `The code appears to be ${params.language_hint}. Format your output accordingly.` : "Detect the programming language and format accordingly.";
      const systemPrompt = `You are a code extraction engine. This screenshot contains code, a stack trace, a configuration file, terminal output, or similar technical text.

Your job:
1. Read ALL text in the image exactly as written
2. Output the text as clean, copy-pasteable code
3. Preserve indentation, line breaks, and formatting precisely
4. Do NOT add commentary, explanations, or markdown formatting
5. If text is partially cut off, include what's readable and note [truncated] where missing
6. ${langInstruction}

Output ONLY the raw code/text from the image. Nothing else.`;
      const req = {
        parts: [
          { type: "image_url", imageUrl: uri },
          { type: "text", text: "Extract all code/text from this screenshot." }
        ],
        reasoning: { enableThinking: false },
        maxTokens: 16384,
        temperature: 0.1
      };
      const result = await client.chat(req);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                code: result.content,
                language_hint: params.language_hint ?? "auto",
                line_count: result.content.split("\n").length,
                duration_ms: result.durationMs
              },
              null,
              2
            )
          }
        ]
      };
    })
  );
}

// src/tools/classify_media.ts
import { z as z14 } from "zod";
var InputSchema10 = z14.object({
  path: z14.string().describe("Absolute local path to image, audio, video, or PDF file"),
  categories: z14.string().optional().describe("Comma-separated category list to choose from. Example: 'contract,invoice,letter,report'. Leave empty for auto-classification."),
  format: z14.enum(["json", "text"]).optional().describe("Output format (default: json)")
});
function detectMediaType2(path) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "webp"].includes(ext)) return "image";
  if (ext === "mp4") return "video";
  if (["wav", "mp3"].includes(ext)) return "audio";
  if (ext === "pdf") return "document";
  return "media";
}
function registerClassifyMedia(server, client, media, cfg) {
  const pdfRenderer = new PdfRenderer({ pdfDpi: cfg.pdfDpi, tmpDir: cfg.tmpDir });
  server.registerTool(
    "classify_media",
    {
      title: "Classify Media Content",
      description: "Classify or categorize media content with confidence scores. Works with images, audio, video, and PDFs. Provide a list of categories to choose from, or leave empty for auto-classification. Returns the best category match, confidence score, and reasoning. Use for document type detection, content moderation, genre classification, and routing pipelines.",
      inputSchema: InputSchema10,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    withLogging("classify_media", async (params) => {
      const mediaType = detectMediaType2(params.path);
      const format = params.format ?? "json";
      const ext = params.path.split(".").pop()?.toLowerCase() ?? "";
      let uri;
      let useAudioInVideo = false;
      let cleanup = null;
      try {
        if (["jpg", "jpeg", "png", "webp"].includes(ext)) {
          uri = await media.assertImage(params.path);
        } else if (ext === "mp4") {
          uri = await media.assertVideo(params.path, 120);
          useAudioInVideo = true;
        } else if (["wav", "mp3"].includes(ext)) {
          uri = await media.assertAudio(params.path);
        } else if (ext === "pdf") {
          const pdfPath = await media.assertPdf(params.path);
          const rendered = await pdfRenderer.render(pdfPath, [1]);
          cleanup = rendered.cleanup;
          uri = toFileUri(rendered.pages[0].pngPath);
        } else {
          throw new Error(`Unsupported file type: ${ext}`);
        }
        let prompt;
        if (params.categories) {
          const catList = params.categories.split(",").map((c) => c.trim()).filter(Boolean).map((c, i) => `${i + 1}. ${c}`).join("\n");
          prompt = `Classify this ${mediaType} into exactly ONE of these categories:
${catList}

Also provide:
- A confidence score from 0.0 to 1.0
- A one-line reason for the classification

` + (format === "json" ? 'Output ONLY valid JSON: {"category": "...", "confidence": 0.0, "reason": "..."}' : "Output: CATEGORY (confidence: 0.0) - reason");
        } else {
          prompt = `Analyze this ${mediaType} and classify it.

Provide:
1. Primary category (what type of content is this?)
2. Sub-categories (more specific tags)
3. Content flags (e.g., contains_text, contains_people, contains_charts, is_screenshot, has_code)
4. A one-sentence summary

` + (format === "json" ? 'Output ONLY valid JSON: {"category": "...", "sub_categories": [...], "flags": [...], "summary": "..."}' : "Provide structured classification.");
        }
        const parts = [];
        if (["jpg", "jpeg", "png", "webp"].includes(ext) || ext === "pdf") {
          parts.push({ type: "image_url", imageUrl: uri });
        } else if (ext === "mp4") {
          parts.push({ type: "video_url", videoUrl: uri });
        } else {
          parts.push({ type: "input_audio", audioUrl: uri });
        }
        parts.push({ type: "text", text: prompt });
        const req = {
          parts,
          reasoning: { enableThinking: false },
          useAudioInVideo,
          maxTokens: 1024,
          temperature: 0.1
        };
        const result = await client.chat(req);
        let data = null;
        let parseWarning;
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
              type: "text",
              text: JSON.stringify(
                {
                  data,
                  raw: result.content,
                  media_type: mediaType,
                  format,
                  ...parseWarning ? { parse_warning: parseWarning } : {},
                  duration_ms: result.durationMs
                },
                null,
                2
              )
            }
          ]
        };
      } finally {
        await cleanup?.();
      }
    })
  );
}

// src/tools/meeting_notes.ts
import { z as z15 } from "zod";
var InputSchema11 = z15.object({
  audio_path: z15.string().describe("Absolute local path to meeting audio recording (.wav, .mp3)"),
  slides_path: z15.string().optional().describe("Absolute local path to slides PDF (optional). Pass if slides were shared."),
  language: z15.string().optional().describe("Language hint (default: English). Example: 'en', 'ro'")
});
function registerMeetingNotes(server, client, media, cfg) {
  const pdfRenderer = new PdfRenderer({ pdfDpi: cfg.pdfDpi, tmpDir: cfg.tmpDir });
  server.registerTool(
    "meeting_notes",
    {
      title: "Generate Structured Meeting Notes",
      description: "Generate structured meeting notes from an audio recording, optionally combined with slides. Transcribes the audio, analyzes slides (if provided), then synthesizes into structured notes with: key decisions, action items with owners, timestamped discussion topics, and slide references. This is a multi-call workflow \u2014 it chains transcription, slide analysis, and synthesis into one result.",
      inputSchema: InputSchema11,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    withLogging("meeting_notes", async (params) => {
      const audioUri = await media.assertAudio(params.audio_path, 3600);
      const langSuffix = params.language ? ` Language: ${params.language}.` : "";
      const transcribeReq = {
        parts: [
          { type: "input_audio", audioUrl: audioUri },
          { type: "text", text: `Transcribe this meeting audio in full detail.${langSuffix} Include who is speaking when identifiable.` }
        ],
        reasoning: { enableThinking: false },
        temperature: 0.2,
        topK: 1,
        maxTokens: 20480
      };
      const transcript = await client.chat(transcribeReq);
      let slideSummaries;
      if (params.slides_path) {
        const pdfPath = await media.assertPdf(params.slides_path);
        const rendered = await pdfRenderer.render(pdfPath, "all");
        try {
          const defaults = defaultsFor("document");
          const reasoning = mergeReasoning(defaults, false);
          const pageParts = [];
          for (const page of rendered.pages) {
            const uri = toFileUri(page.pngPath);
            const req = {
              parts: [
                { type: "image_url", imageUrl: uri },
                { type: "text", text: `Slide ${page.pageNumber}. Provide a concise 1-2 sentence summary of this slide's content.` }
              ],
              reasoning,
              maxTokens: 512
            };
            const result = await client.chat(req);
            pageParts.push(`Slide ${page.pageNumber}: ${result.content.trim()}`);
          }
          slideSummaries = pageParts.join("\n");
        } finally {
          await rendered.cleanup();
        }
      }
      const contextParts = [
        "## Meeting Transcript",
        transcript.content
      ];
      if (slideSummaries) {
        contextParts.push("", "## Slides Referenced", slideSummaries);
      }
      const fullContext = contextParts.join("\n");
      const synthesisReq = {
        parts: [
          {
            type: "text",
            text: `You are a meeting notes assistant. Based on the following meeting data, produce structured notes.

${fullContext}

Produce the notes in this EXACT format:

# Meeting Notes

## Summary
(2-3 sentence executive summary)

## Key Decisions
( numbered list \u2014 each decision on its own line with who decided)

## Action Items
( numbered list \u2014 each item with owner and deadline if mentioned)

## Discussion Topics
(numbered list with timestamps if identifiable \u2014 format: [MM:SS] Topic)

` + (slideSummaries ? `## Slide References
(when a discussion topic relates to a specific slide, note it)

` : "") + `## Open Questions
(unresolved questions or topics that need follow-up)

Be thorough and specific. Extract actual names, numbers, and commitments \u2014 do not summarize vaguely.`
          }
        ],
        reasoning: { enableThinking: true, reasoningBudget: 16384 },
        maxTokens: 8192,
        topP: 0.95
      };
      const notes = await client.chat(synthesisReq);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                notes: notes.content,
                reasoning_content: notes.reasoningContent,
                transcript: transcript.content,
                ...slideSummaries ? { slide_summaries: slideSummaries } : {},
                duration_ms: transcript.durationMs + notes.durationMs
              },
              null,
              2
            )
          }
        ]
      };
    })
  );
}

// src/tools/qa_document.ts
import { z as z16 } from "zod";
var InputSchema12 = z16.object({
  path: z16.string().describe("Absolute local path to PDF document"),
  question: z16.string().optional().describe("Question to answer against the document. If omitted, returns page-by-page content for review."),
  pages: z16.union([
    z16.literal("all"),
    z16.number().int().positive(),
    z16.array(z16.number().int().positive())
  ]).optional().describe("Pages to process (default: 'all')"),
  detail_level: z16.enum(["full", "summary"]).optional().describe("How much detail to extract per page: 'full' (complete text) or 'summary' (2-3 sentences). Default: summary"),
  thinking: z16.boolean().optional().describe("Enable reasoning for Q&A (default: true when question is provided)")
});
function registerQaDocument(server, client, media, cfg) {
  const pdfRenderer = new PdfRenderer({ pdfDpi: cfg.pdfDpi, tmpDir: cfg.tmpDir });
  server.registerTool(
    "qa_document",
    {
      title: "Q&A with Document",
      description: "Ask questions against a PDF document. Extracts page-by-page content, then answers your specific question using the full document as context. Much more targeted than a flat summary \u2014 you can drill into specific details. If no question is provided, returns the page-by-page extraction so you can review the content first. Use detail_level='full' for complete text extraction, 'summary' (default) for concise per-page summaries.",
      inputSchema: InputSchema12,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    withLogging("qa_document", async (params) => {
      const pdfPath = await media.assertPdf(params.path);
      const pageSpec = params.pages ?? "all";
      const pages = pageSpec === "all" ? "all" : typeof pageSpec === "number" ? [pageSpec] : pageSpec;
      const detail = params.detail_level ?? "summary";
      const rendered = await pdfRenderer.render(pdfPath, pages);
      try {
        const defaults = defaultsFor("document");
        const reasoning = mergeReasoning(defaults, false);
        const perPage = [];
        for (const page of rendered.pages) {
          const uri = toFileUri(page.pngPath);
          const extractPrompt = detail === "full" ? `Page ${page.pageNumber}. Extract ALL text, numbers, table data, and labels from this page. Preserve structure.` : `Page ${page.pageNumber}. Provide a concise 2-3 sentence summary of this page's content. Include key numbers and facts.`;
          const req = {
            parts: [
              { type: "image_url", imageUrl: uri },
              { type: "text", text: extractPrompt }
            ],
            reasoning,
            maxTokens: detail === "full" ? 4096 : 512
          };
          const result = await client.chat(req);
          perPage.push({ page: page.pageNumber, content: result.content.trim() });
        }
        if (!params.question) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    per_page: perPage,
                    page_count: rendered.pageCount,
                    detail_level: detail,
                    hint: "Call again with a 'question' to get targeted answers against this document."
                  },
                  null,
                  2
                )
              }
            ]
          };
        }
        const documentContext = perPage.map((p) => `--- Page ${p.page} ---
${p.content}`).join("\n\n");
        const qaReasoning = mergeReasoning(
          { enableThinking: true, reasoningBudget: 16384 },
          params.thinking
        );
        const qaReq = {
          parts: [
            {
              type: "text",
              text: `You have access to the following document content (page by page):

${documentContext}

Answer this question based on the document: ${params.question}

Rules:
- Answer based ONLY on the document content above
- If the answer spans multiple pages, synthesize the information
- Cite specific page numbers when referencing details: [Page N]
- If the document doesn't contain the answer, say so clearly
- Be specific with numbers, names, and dates`
            }
          ],
          reasoning: qaReasoning,
          maxTokens: 8192,
          topP: qaReasoning.enableThinking ? 0.95 : void 0
        };
        const answer = await client.chat(qaReq);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  question: params.question,
                  answer: answer.content,
                  reasoning_content: answer.reasoningContent,
                  source_pages: perPage.map((p) => p.page),
                  page_count: rendered.pageCount
                },
                null,
                2
              )
            }
          ]
        };
      } finally {
        await rendered.cleanup();
      }
    })
  );
}

// src/tools/repurpose_content.ts
import { z as z17 } from "zod";
var InputSchema13 = z17.object({
  path: z17.string().describe("Absolute local path to video (.mp4) or audio (.wav, .mp3) file"),
  formats: z17.array(z17.enum(["blog_post", "social_thread", "email_summary", "key_quotes"])).optional().describe("Which formats to generate (default: all four). Pass a subset to skip unwanted formats."),
  tone: z17.enum(["professional", "casual", "academic", "enthusiastic"]).optional().describe("Tone for generated content (default: professional)"),
  language: z17.string().optional().describe("Output language (default: English)")
});
var FORMAT_PROMPTS = {
  blog_post: (tone, lang) => `Write a well-structured blog post based on the content below.
Tone: ${tone}. ${lang}

Structure:
- Compelling title (H1)
- Opening hook (2-3 sentences that grab attention)
- 3-5 sections with H2 headers
- Each section: 2-3 paragraphs
- Closing with key takeaway
Target length: 600-800 words. Write in markdown.`,
  social_thread: (tone, lang) => `Create a social media thread (e.g., Twitter/X) based on the content below.
Tone: ${tone}. ${lang}

Rules:
- First tweet is the hook (must grab attention)
- 5-8 tweets total
- Each tweet under 280 characters
- Number each tweet (1/8, 2/8, etc.)
- End with a call-to-action tweet
- Include relevant hashtags`,
  email_summary: (tone, lang) => `Write a professional email summary of the content below.
Tone: ${tone}. ${lang}

Structure:
- Subject line (concise, specific)
- 3-5 bullet points covering key takeaways
- One paragraph of context
- Clear next steps or call to action
Keep it under 300 words. Make it scannable.`,
  key_quotes: (tone, lang) => `Extract the 3-5 most impactful, quotable statements from the content below.
${lang}

For each quote:
1. The exact or near-exact quote (cleaned up for readability)
2. Context: 1 sentence explaining when/why it was said
3. Why it matters: 1 sentence on significance

Prioritize: unique insights, contrarian takes, specific numbers, and memorable phrasing.`
};
function registerRepurposeContent(server, client, media) {
  server.registerTool(
    "repurpose_content",
    {
      title: "Repurpose Content into Multiple Formats",
      description: "Take a video or audio recording and generate multiple content formats from it: blog post, social media thread, email summary, and key quotes. Transcribes/analyzes the source media once, then generates each format in a separate call. Choose which formats to generate, or get all four. Great for content repurposing: one recording \u2192 blog + tweets + email + pull quotes.",
      inputSchema: InputSchema13,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    withLogging("repurpose_content", async (params) => {
      const ext = params.path.split(".").pop()?.toLowerCase() ?? "";
      const tone = params.tone ?? "professional";
      const lang = params.language ? `Write in ${params.language}.` : "";
      const formats = params.formats ?? ["blog_post", "social_thread", "email_summary", "key_quotes"];
      let sourceContent;
      if (ext === "mp4") {
        const uri = await media.assertVideo(params.path, 120);
        const req = {
          parts: [
            { type: "video_url", videoUrl: uri },
            { type: "text", text: "Provide a detailed summary of everything discussed or shown in this video. Include all key points, arguments, data, and conclusions." }
          ],
          reasoning: { enableThinking: false },
          useAudioInVideo: true,
          maxTokens: 8192
        };
        const result = await client.chat(req);
        sourceContent = result.content;
      } else if (["wav", "mp3"].includes(ext)) {
        const uri = await media.assertAudio(params.path, 3600);
        const req = {
          parts: [
            { type: "input_audio", audioUrl: uri },
            { type: "text", text: "Transcribe this audio in full detail, including all key points, arguments, and conclusions." }
          ],
          reasoning: { enableThinking: false },
          temperature: 0.2,
          maxTokens: 20480
        };
        const result = await client.chat(req);
        sourceContent = result.content;
      } else {
        throw new Error(`Unsupported file type: ${ext}. Use video (.mp4) or audio (.wav, .mp3).`);
      }
      const outputs = {};
      for (const format of formats) {
        const promptFn = FORMAT_PROMPTS[format];
        if (!promptFn) continue;
        const prompt = promptFn(tone, lang);
        const req = {
          parts: [
            {
              type: "text",
              text: `${prompt}

--- SOURCE CONTENT ---
${sourceContent}`
            }
          ],
          reasoning: { enableThinking: false },
          maxTokens: 4096
        };
        const result = await client.chat(req);
        outputs[format] = result.content.trim();
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ outputs }, null, 2)
          }
        ]
      };
    })
  );
}

// src/tools/video_search_index.ts
import { z as z18 } from "zod";
var InputSchema14 = z18.object({
  path: z18.string().describe("Absolute local path to video file (.mp4, max 600s / 10 min)"),
  chunk_seconds: z18.number().int().min(10).max(120).optional().describe("Seconds per chunk (default: 30). Shorter = more granular, longer = faster."),
  topics: z18.string().optional().describe("Comma-separated topic list to tag against. Example: 'networking,AI,hardware,security'. Leave empty for auto-detection."),
  include_visual: z18.boolean().optional().describe("Include visual descriptions per chunk (default: true). Set false for audio-only indexing.")
});
function registerVideoSearchIndex(server, client, media) {
  server.registerTool(
    "video_search_index",
    {
      title: "Build Searchable Video Index",
      description: "Index a video for semantic search by breaking it into time-based chunks and analyzing each one. Generates per-chunk metadata: transcript excerpt, visual description, topics, speakers, and keywords. Outputs a JSON index with timestamps that can be stored in a vector database for retrieval. This is a multi-call workflow \u2014 one call per chunk plus a synthesis pass. Use for podcast archives, meeting recordings, lecture series, or any video library you want to search.",
      inputSchema: InputSchema14,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    withLogging("video_search_index", async (params) => {
      const chunkSeconds = params.chunk_seconds ?? 30;
      const includeVisual = params.include_visual ?? true;
      const uri = await media.assertVideo(params.path, 600);
      const durationSec = await media.probeDuration(params.path);
      const chunkCount = Math.ceil(durationSec / chunkSeconds);
      const topicList = params.topics ? params.topics.split(",").map((t) => t.trim()).filter(Boolean) : null;
      const overviewReq = {
        parts: [
          { type: "video_url", videoUrl: uri },
          {
            type: "text",
            text: `Analyze this video in detail. This video is ${Math.round(durationSec)}s long.

Provide:
1. A 2-3 sentence overall summary
2. A list of all topics discussed
3. A list of all speakers/people visible or audible
4. Key moments with approximate timestamps

Format as structured text with clear headers.`
          }
        ],
        reasoning: { enableThinking: false },
        useAudioInVideo: true,
        maxTokens: 8192
      };
      const overview = await client.chat(overviewReq);
      const chunkingPrompt = `Based on the following video analysis, create a time-based index.

Video duration: ${Math.round(durationSec)}s. Chunk size: ${chunkSeconds}s. Total chunks: ${chunkCount}.

Video analysis:
${overview.content}

For EACH chunk, output a JSON object with this schema:
{"chunk": N, "start_seconds": S, "end_seconds": E, "timestamp": "MM:SS - MM:SS", "transcript_excerpt": "what's being discussed in this segment", ${includeVisual ? `"visual_description": "what's shown on screen", ` : ""}"topics": ["topic1", "topic2"], "speakers": ["speaker name"], "keywords": ["kw1", "kw2"]}

` + (topicList ? `Tag each chunk against these topics: ${topicList.join(", ")}

` : "") + `Output a JSON array of ${chunkCount} chunk objects. Nothing else.`;
      const indexingReq = {
        parts: [{ type: "text", text: chunkingPrompt }],
        reasoning: { enableThinking: false },
        maxTokens: Math.min(chunkCount * 500, 32768),
        temperature: 0.2
      };
      const indexResult = await client.chat(indexingReq);
      let chunks = [];
      let parseWarning;
      try {
        let cleaned = indexResult.content.trim();
        if (cleaned.startsWith("```")) {
          cleaned = cleaned.split("\n").slice(1).join("\n");
          if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
          cleaned = cleaned.trim();
        }
        chunks = JSON.parse(cleaned);
        if (!Array.isArray(chunks)) {
          parseWarning = "Model returned non-array JSON";
          chunks = [chunks];
        }
      } catch {
        parseWarning = "Model did not return valid JSON \u2014 returning raw text";
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                index: {
                  source: params.path,
                  duration_seconds: Math.round(durationSec),
                  chunk_seconds: chunkSeconds,
                  chunk_count: chunkCount,
                  ...topicList ? { requested_topics: topicList } : {},
                  include_visual: includeVisual
                },
                overview: overview.content,
                chunks: parseWarning ? void 0 : chunks,
                raw_chunks: parseWarning ? indexResult.content : void 0,
                ...parseWarning ? { parse_warning: parseWarning } : {},
                usage_hint: "Store 'chunks' in a vector DB with embeddings of 'transcript_excerpt' + 'keywords' for semantic search. Use 'timestamp' to seek to the relevant segment."
              },
              null,
              2
            )
          }
        ]
      };
    })
  );
}

// src/tools/analyze_chart.ts
import { z as z19 } from "zod";
var InputSchema15 = z19.object({
  path: z19.string().describe("Absolute local path to chart/graph screenshot image"),
  extract_data: z19.boolean().optional().describe("Extract data points as structured JSON (default: true)"),
  critique: z19.boolean().optional().describe("Critique the visualization quality and suggest improvements (default: false)"),
  thinking: z19.boolean().optional().describe("Enable reasoning mode (default: true)"),
  max_tokens: z19.number().int().positive().optional().describe("Max output tokens (default: 8192)")
});
function registerAnalyzeChart(server, client, media) {
  server.registerTool(
    "analyze_chart",
    {
      title: "Analyze Charts, Graphs & Data Visualizations",
      description: "Specialized analysis of scientific/technical charts, graphs, and data visualizations. Reads axes, scales, data series, trends, and outliers. Optionally extracts data points as structured JSON and critiques the visualization quality (misleading scales, hidden data, poor bin sizes, etc.). Use for analyzing benchmark results, monitoring dashboards, research papers, or any data visualization where you need precise reading.",
      inputSchema: InputSchema15,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    withLogging("analyze_chart", async (params) => {
      const uri = await media.assertImage(params.path);
      const extractData = params.extract_data ?? true;
      const doCritique = params.critique ?? false;
      const analysisPrompt = "Analyze this chart/graph/data visualization in detail.\n\nProvide:\n## Chart Type\n(What type of visualization: bar, line, scatter, pie, heatmap, box plot, histogram, etc.)\n\n## Axes & Scales\n- X-axis: label, unit, range, scale type (linear/log)\n- Y-axis: label, unit, range, scale type (linear/log)\n- Any secondary axes\n\n## Data Series\n- Each series: name, color/pattern, number of visible data points\n- Legend information\n\n## Key Observations\n- Trends (increasing, decreasing, cyclical, flat)\n- Notable peaks, valleys, inflection points\n- Outliers or anomalies\n- Any visible thresholds, reference lines, or annotations\n\n## Summary\nOne paragraph describing what this chart shows and the main takeaway.";
      const analysisReq = {
        parts: [
          { type: "image_url", imageUrl: uri },
          { type: "text", text: analysisPrompt }
        ],
        reasoning: {
          enableThinking: params.thinking ?? true,
          ...params.thinking !== false ? { reasoningBudget: 8192 } : {}
        },
        maxTokens: params.max_tokens ?? 8192,
        topP: params.thinking !== false ? 0.95 : void 0
      };
      const analysis = await client.chat(analysisReq);
      let dataExtraction = null;
      let extractionRaw;
      if (extractData) {
        const extractionPrompt = 'Extract all visible data points from this chart as JSON.\n\nOutput schema:\n{\n  "chart_type": "...",\n  "x_axis": {"label": "...", "unit": "...", "values": [...]},\n  "y_axis": {"label": "...", "unit": "..."},\n  "series": [\n    {"name": "...", "data_points": [{"x": ..., "y": ...}, ...]}\n  ]\n}\n\nRules:\n- Estimate values as precisely as you can from the chart\n- Include ALL visible data points\n- If values are approximate, include them anyway\nOutput ONLY valid JSON. No markdown, no explanation.';
        const extractionReq = {
          parts: [
            { type: "image_url", imageUrl: uri },
            { type: "text", text: extractionPrompt }
          ],
          reasoning: { enableThinking: false },
          maxTokens: 4096,
          temperature: 0.1
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
          extractionRaw = void 0;
        } catch {
        }
      }
      let critiqueResult;
      if (doCritique) {
        const critiquePrompt = "Critique this data visualization. Identify problems and suggest improvements.\n\nCheck for:\n1. **Misleading scales** \u2014 truncated axes, non-zero baselines, inconsistent intervals\n2. **Hidden data** \u2014 important data obscured by scale choices, aggregation that hides outliers\n3. **Visual clutter** \u2014 too many series, unclear labels, poor color choices\n4. **Statistical issues** \u2014 inappropriate bin sizes, missing error bars, P99 hidden by averages\n5. **Accessibility** \u2014 color-blind unfriendly, small text, no labels on data points\n6. **Suggested improvements** \u2014 specific actionable fixes\n\nRate the visualization quality: Excellent / Good / Fair / Poor\nBe specific and constructive.";
        const critiqueReq = {
          parts: [
            { type: "image_url", imageUrl: uri },
            { type: "text", text: critiquePrompt }
          ],
          reasoning: { enableThinking: false },
          maxTokens: 2048
        };
        const critiqueResp = await client.chat(critiqueReq);
        critiqueResult = critiqueResp.content;
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                analysis: analysis.content,
                reasoning_content: analysis.reasoningContent,
                ...dataExtraction ? { extracted_data: dataExtraction } : {},
                ...extractionRaw ? { extraction_raw: extractionRaw } : {},
                ...critiqueResult ? { visualization_critique: critiqueResult } : {},
                duration_ms: analysis.durationMs
              },
              null,
              2
            )
          }
        ]
      };
    })
  );
}

// src/tools/voice_intent.ts
import { z as z20 } from "zod";
var InputSchema16 = z20.object({
  path: z20.string().describe("Absolute local path to audio clip containing a voice command"),
  available_actions: z20.string().optional().describe("Comma-separated list of available actions/skills the user can invoke. Example: 'run_script,search_web,send_email,toggle_device,query_database'. If provided, the model will map the voice command to one of these actions."),
  parameters_schema: z20.string().optional().describe(`JSON schema hint for expected parameters. Example: '{"script":"string","target":"string","args":"string[]"}'. If provided, the model will extract parameters matching this schema.`),
  language: z20.string().optional().describe("Language hint (default: auto-detect)")
});
function registerVoiceIntent(server, client, media) {
  server.registerTool(
    "voice_intent",
    {
      title: "Extract Voice Intent as Structured JSON",
      description: `Takes an audio clip of someone speaking a command and extracts the intent as structured JSON. Designed as the input layer for agentic workflows: voice command \u2192 intent JSON \u2192 dispatch to tool/skill. Optionally maps to a predefined list of available actions and extracts parameters matching a schema. Example: 'Hey, can you run the throughput script on the server?' \u2192 {"action": "run_script", "parameters": {"script": "throughput", "target": "server"}}. Handles colloquial language, accents, and indirect requests.`,
      inputSchema: InputSchema16,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    withLogging("voice_intent", async (params) => {
      const uri = await media.assertAudio(params.path, 120);
      let prompt = "You are a voice command parser. Listen to this audio clip and extract the user's intent.\n\nRules:\n1. Transcribe what the user said (handle accents, colloquialisms, and indirect phrasing)\n2. Determine the intent \u2014 what does the user want to happen?\n3. Extract any parameters mentioned (targets, values, names, quantities, etc.)\n4. Rate your confidence from 0.0 to 1.0\n\n";
      if (params.available_actions) {
        const actions = params.available_actions.split(",").map((a) => a.trim()).filter(Boolean);
        prompt += `Available actions (map the user's request to the closest match):
`;
        actions.forEach((a, i) => prompt += `${i + 1}. ${a}
`);
        prompt += `
If the request doesn't match any action, set action to "unknown".

`;
      }
      if (params.parameters_schema) {
        prompt += `Expected parameters schema:
${params.parameters_schema}

`;
        prompt += "Extract parameters matching this schema. If a parameter isn't mentioned, set it to null.\n\n";
      }
      prompt += 'Output ONLY valid JSON with this structure:\n{\n  "transcript": "what was said",\n  "action": "identified_action",\n  "parameters": { ... extracted params ... },\n  "confidence": 0.0,\n  "ambiguities": ["any unclear parts"],\n  "clarification_needed": false\n}\n\nSet clarification_needed to true if the intent is ambiguous and you need to ask the user to clarify.';
      const langSuffix = params.language ? `
Language: ${params.language}.` : "";
      const req = {
        parts: [
          { type: "input_audio", audioUrl: uri },
          { type: "text", text: prompt + langSuffix }
        ],
        reasoning: { enableThinking: false },
        maxTokens: 2048,
        temperature: 0.1
      };
      const result = await client.chat(req);
      let intent = null;
      let parseWarning;
      try {
        let cleaned = result.content.trim();
        if (cleaned.startsWith("```")) {
          cleaned = cleaned.split("\n").slice(1).join("\n");
          if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
          cleaned = cleaned.trim();
        }
        intent = JSON.parse(cleaned);
      } catch {
        parseWarning = "Model did not return valid JSON";
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                intent,
                ...parseWarning ? { raw: result.content, parse_warning: parseWarning } : {},
                duration_ms: result.durationMs
              },
              null,
              2
            )
          }
        ]
      };
    })
  );
}

// src/tools/verify_output.ts
import { z as z21 } from "zod";
var InputSchema17 = z21.object({
  path: z21.string().describe("Absolute local path to the source media (image, audio, video, or PDF)"),
  claim: z21.string().describe("The claim or previous analysis to verify against the media"),
  strict: z21.boolean().optional().describe("Strict mode: flag any approximation, rounding, or inference (default: false)"),
  media_type: z21.enum(["image", "audio", "video", "document"]).optional().describe("Override media type detection. Usually auto-detected from file extension.")
});
function registerVerifyOutput(server, client, media, cfg) {
  const pdfRenderer = new PdfRenderer({ pdfDpi: cfg.pdfDpi, tmpDir: cfg.tmpDir });
  server.registerTool(
    "verify_output",
    {
      title: "Verify Analysis Against Source Media",
      description: "Verify a claim or previous analysis against the actual source media. Acts as the 'output guard' in an agentic pipeline: takes media + a claim about it, re-examines the media independently, and checks every assertion for accuracy. Returns a verification report with: verified facts, corrections, hallucinations found, and an overall confidence score. Use to self-correct OCR, validate extractions, or add a verification step to any multimodal pipeline.",
      inputSchema: InputSchema17,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    withLogging("verify_output", async (params) => {
      const ext = params.path.split(".").pop()?.toLowerCase() ?? "";
      const strict = params.strict ?? false;
      let uri;
      let useAudioInVideo = false;
      let cleanup = null;
      let detectedType;
      if (params.media_type) {
        detectedType = params.media_type;
      } else if (["jpg", "jpeg", "png", "webp"].includes(ext)) {
        detectedType = "image";
      } else if (ext === "mp4") {
        detectedType = "video";
      } else if (["wav", "mp3"].includes(ext)) {
        detectedType = "audio";
      } else if (ext === "pdf") {
        detectedType = "document";
      } else {
        throw new Error(`Unsupported file type: ${ext}`);
      }
      if (detectedType === "image") {
        uri = await media.assertImage(params.path);
      } else if (detectedType === "video") {
        uri = await media.assertVideo(params.path, 120);
        useAudioInVideo = true;
      } else if (detectedType === "audio") {
        uri = await media.assertAudio(params.path);
      } else if (detectedType === "document") {
        const pdfPath = await media.assertPdf(params.path);
        const rendered = await pdfRenderer.render(pdfPath, [1]);
        cleanup = rendered.cleanup;
        uri = toFileUri(rendered.pages[0].pngPath);
        detectedType = "image";
      } else {
        throw new Error(`Unsupported media type: ${detectedType}`);
      }
      try {
        const verifyPrompt = "You are a verification engine. You will be shown media and a claim about it.\nYour job is to independently examine the media and verify EVERY assertion in the claim.\n\nFor each assertion in the claim:\n1. Check it against the media directly\n2. Mark it as: VERIFIED \u2705, CORRECTED \u26A0\uFE0F (with the right value), or HALLUCINATION \u274C\n\n" + (strict ? "STRICT MODE: Flag ANY approximation, rounding, inference, or guess as CORRECTED.\n\n" : "") + `Claim to verify:
---
${params.claim}
---

Output ONLY valid JSON:
{
  "verified_facts": ["fact that was confirmed correct"],
  "corrections": [{"original": "what was claimed", "correct": "what it actually is", "severity": "minor|major"}],
  "hallucinations": ["claims that have no basis in the media"],
  "missing_details": ["important things in the media that the claim missed"],
  "overall_accuracy": 0.0,
  "confidence": 0.0,
  "summary": "one sentence verdict"
}`;
        const parts = [];
        if (detectedType === "image") {
          parts.push({ type: "image_url", imageUrl: uri });
        } else if (detectedType === "video") {
          parts.push({ type: "video_url", videoUrl: uri });
        } else {
          parts.push({ type: "input_audio", audioUrl: uri });
        }
        parts.push({ type: "text", text: verifyPrompt });
        const req = {
          parts,
          reasoning: { enableThinking: true, reasoningBudget: 8192 },
          useAudioInVideo,
          maxTokens: 4096,
          topP: 0.95
        };
        const result = await client.chat(req);
        let verification = null;
        let parseWarning;
        try {
          let cleaned = result.content.trim();
          if (cleaned.startsWith("```")) {
            cleaned = cleaned.split("\n").slice(1).join("\n");
            if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
            cleaned = cleaned.trim();
          }
          verification = JSON.parse(cleaned);
        } catch {
          parseWarning = "Model did not return valid JSON";
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  verification,
                  reasoning_content: result.reasoningContent,
                  ...parseWarning ? { raw: result.content, parse_warning: parseWarning } : {},
                  duration_ms: result.durationMs
                },
                null,
                2
              )
            }
          ]
        };
      } finally {
        await cleanup?.();
      }
    })
  );
}

// src/tools/index.ts
function registerAllTools(server, client, media, cfg) {
  registerHealthTool(server, client);
  registerAnalyzeImage(server, client, media);
  registerAnalyzeAudio(server, client, media);
  registerTranscribeAudio(server, client, media);
  registerAnalyzeVideo(server, client, media);
  registerAnalyzeDocument(server, client, media, cfg);
  registerAnalyzeMultimodal(server, client, media);
  registerCompareImages(server, client, media);
  registerExtractData(server, client, media, cfg);
  registerVideoTimeline(server, client, media);
  registerDescribeMedia(server, client, media);
  registerReadCode(server, client, media);
  registerClassifyMedia(server, client, media, cfg);
  registerMeetingNotes(server, client, media, cfg);
  registerQaDocument(server, client, media, cfg);
  registerRepurposeContent(server, client, media);
  registerVideoSearchIndex(server, client, media);
  registerAnalyzeChart(server, client, media);
  registerVoiceIntent(server, client, media);
  registerVerifyOutput(server, client, media, cfg);
}

// src/index.ts
init_errors();
async function main() {
  const cfg = loadConfig();
  initLogger(cfg);
  if (!process.env.SKIP_DEPENDENCY_CHECK) {
    const { checkDependencies: checkDependencies2 } = await Promise.resolve().then(() => (init_dependencies(), dependencies_exports));
    try {
      await checkDependencies2();
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
  const server = new McpServer({
    name: "omni-perception-mcp-server",
    version: "1.0.0"
  });
  const client = new OmniClient(cfg);
  const media = new MediaHandler(cfg);
  registerAllTools(server, client, media, cfg);
  const health = await client.health();
  if (!health.healthy) {
    logger.warn(
      { baseUrl: cfg.baseUrl, error: health.error },
      "vLLM server unreachable \u2014 starting in degraded mode. Tools will fail until vLLM is available."
    );
  } else {
    logger.info(
      { baseUrl: cfg.baseUrl, model: health.model },
      "vLLM server healthy"
    );
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info(
    { baseUrl: cfg.baseUrl, model: cfg.model },
    "omni-perception-mcp-server started"
  );
}
main().catch((err) => {
  process.stderr.write(
    `Fatal: ${err instanceof Error ? err.message : String(err)}
`
  );
  process.exit(1);
});
//# sourceMappingURL=index.js.map