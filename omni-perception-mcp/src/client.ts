import OpenAI from "openai";
import type { Config } from "./config.js";
import { logger } from "./logger.js";
import {
  TimeoutError,
  UpstreamError,
} from "./errors.js";
import type { ReasoningParams } from "./reasoning.js";
import { parseResponse } from "./reasoning.js";

// ─── Types ────────────────────────────────────────────────────────────────

export type ContentPart =
  | TextPart
  | ImagePart
  | AudioPart
  | VideoPart;

export interface TextPart {
  type: "text";
  text: string;
}

export interface ImagePart {
  type: "image_url";
  imageUrl: string; // file:// URI
}

export interface AudioPart {
  type: "input_audio"; // vLLM uses this for audio
  audioUrl: string; // file:// URI
}

export interface VideoPart {
  type: "video_url";
  videoUrl: string; // file:// URI
}

export interface ChatRequest {
  parts: ContentPart[];
  reasoning: ReasoningParams;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  useAudioInVideo?: boolean;
  /** Additional text appended to system prompt */
  systemPromptSuffix?: string;
}

export interface ChatResult {
  reasoningContent: string;
  content: string;
  warning?: string;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
}

export interface HealthResult {
  healthy: boolean;
  baseUrl: string;
  model?: string;
  responseTimeMs?: number;
  error?: string;
}

// ─── OmniClient ───────────────────────────────────────────────────────────

/**
 * OpenAI-compatible HTTP client to vLLM; handles reasoning, retries, budget control.
 * Implements: R7.1, R7.3, R9.1, R9.2, R10.2, R10.3
 */
export class OmniClient {
  private readonly client: OpenAI;
  private readonly config: Config;

  constructor(cfg: Config) {
    this.config = cfg;
    this.client = new OpenAI({
      baseURL: cfg.baseUrl,
      apiKey: "EMPTY",
      timeout: cfg.requestTimeoutMs,
      maxRetries: 0, // We handle retries ourselves
    });
  }

  /**
   * Health check: GET /models with 2s timeout.
   * Implements: R9.1, R9.2
   */
  async health(): Promise<HealthResult> {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2_000);
      const resp = await fetch(`${this.config.baseUrl}/models`, {
        signal: controller.signal,
      });
      clearTimeout(timer);

      const data = (await resp.json()) as { data?: Array<{ id: string }> };
      const model =
        data.data?.[0]?.id ?? this.config.model;
      return {
        healthy: true,
        baseUrl: this.config.baseUrl,
        model,
        responseTimeMs: Date.now() - start,
      };
    } catch (err) {
      return {
        healthy: false,
        baseUrl: this.config.baseUrl,
        error:
          err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Send a chat completion request with retry-on-5xx.
   * Implements: R7.1, R7.3, R10.2, R10.3
   */
  async chat(req: ChatRequest): Promise<ChatResult> {
    const start = Date.now();

    const messages = this.buildMessages(req);
    const extraBody = this.buildExtraBody(req);

    // Budget-controlled two-step pattern (R7.1)
    if (
      req.reasoning.enableThinking &&
      req.reasoning.reasoningBudget &&
      req.reasoning.reasoningBudget > 0
    ) {
      return this.budgetControlledChat(req, messages, extraBody, start);
    }

    // Standard single-call pattern
    const chatParams = {
      model: this.config.model,
      messages,
      max_tokens: req.maxTokens ?? this.config.defaultMaxTokens,
      temperature: req.temperature ?? this.getDefaultTemp(req.reasoning.enableThinking),
      ...(req.topP !== undefined ? { top_p: req.topP } : {}),
      ...extraBody,
    };

    // R11.2: Debug log request body (no media content, only paths)
    logger.debug({ request: this.sanitizeForLog(chatParams) }, "chat request");

    const result = await this.doChatWithRetry(chatParams);

    const parsed = parseResponse(result.content);
    const response = {
      ...parsed,
      durationMs: Date.now() - start,
      promptTokens: result.usage?.prompt_tokens ?? 0,
      completionTokens: result.usage?.completion_tokens ?? 0,
    };

    // R11.2: Debug log response (no media)
    logger.debug(
      { response: { durationMs: response.durationMs, promptTokens: response.promptTokens, completionTokens: response.completionTokens, contentLength: response.content.length } },
      "chat response",
    );

    return response;
  }

  // ─── Private ──────────────────────────────────────────────────────────

  private buildMessages(
    req: ChatRequest,
  ): OpenAI.ChatCompletionMessageParam[] {
    const content: OpenAI.ChatCompletionContentPart[] = [];

    for (const part of req.parts) {
      switch (part.type) {
        case "text":
          content.push({ type: "text", text: part.text });
          break;
        case "image_url":
          content.push({
            type: "image_url",
            image_url: { url: part.imageUrl },
          });
          break;
        case "input_audio":
          content.push({
            type: "input_audio",
            input_audio: { data: part.audioUrl, format: "url" },
          });
          break;
        case "video_url":
          content.push({
            type: "video_url" as "text", // Cast for vLLM compatibility
            video_url: { url: part.videoUrl },
          } as unknown as OpenAI.ChatCompletionContentPart);
          break;
      }
    }

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "user", content },
    ];

    return messages;
  }

  private buildExtraBody(req: ChatRequest): Record<string, unknown> {
    const extra: Record<string, unknown> = {};

    // Reasoning / thinking control (R7.3)
    const chatTemplateKwargs: Record<string, unknown> = {};
    if (req.reasoning.enableThinking) {
      chatTemplateKwargs.enable_thinking = true;
      if (req.reasoning.reasoningBudget) {
        const grace = req.reasoning.gracePeriod ?? 1024;
        extra.thinking_token_budget =
          req.reasoning.reasoningBudget + grace;
        chatTemplateKwargs.reasoning_budget = req.reasoning.reasoningBudget;
      }
    } else {
      chatTemplateKwargs.enable_thinking = false;
    }
    extra.chat_template_kwargs = chatTemplateKwargs;

    // top_k
    if (req.topK !== undefined) {
      extra.top_k = req.topK;
    }

    // mm_processor_kwargs for audio-in-video (R4.2)
    if (req.useAudioInVideo) {
      extra.mm_processor_kwargs = { use_audio_in_video: true };
    }

    return extra;
  }

  private getDefaultTemp(enableThinking: boolean): number {
    return enableThinking ? 0.6 : 0.2;
  }

  /**
   * R11.2: Sanitize request for debug logging.
   * Logs everything except media content (only paths/URLs are kept).
   */
  private sanitizeForLog(params: Record<string, unknown>): Record<string, unknown> {
    const sanitized = { ...params };
    if (Array.isArray(sanitized.messages)) {
      sanitized.messages = (sanitized.messages as Array<Record<string, unknown>>).map(
        (msg) => {
          if (Array.isArray(msg.content)) {
            return {
              ...msg,
              content: (msg.content as Array<Record<string, unknown>>).map(
                (part) => {
                  // Keep type and URL/path info, but don't log actual content bytes
                  if (part.type === "image_url" || part.type === "video_url" || part.type === "input_audio") {
                    const urlKey = part.type === "image_url" ? "image_url" : part.type === "video_url" ? "video_url" : "input_audio";
                    const nested = part[urlKey] as Record<string, unknown> | undefined;
                    return { type: part.type, [urlKey]: nested ? { url: nested.url ?? "[path]" } : "[media]" };
                  }
                  return part;
                },
              ),
            };
          }
          return msg;
        },
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
  private async budgetControlledChat(
    req: ChatRequest,
    messages: OpenAI.ChatCompletionMessageParam[],
    extraBody: Record<string, unknown>,
    start: number,
  ): Promise<ChatResult> {
    const budget = req.reasoning.reasoningBudget!;
    const grace = req.reasoning.gracePeriod ?? 1024;

    // Step 1: Generate thinking tokens up to budget + grace
    const thinkingResult = await this.doChatWithRetry({
      model: this.config.model,
      messages,
      max_tokens: budget + grace,
      temperature: req.temperature ?? 0.6,
      top_p: req.topP ?? 0.95,
      ...extraBody,
    });

    const thinkingContent = thinkingResult.content;
    const thinkEnd = thinkingContent.includes("</think");

    if (thinkEnd) {
      // Model naturally closed thinking — just parse normally
      const parsed = parseResponse(thinkingContent);
      return {
        ...parsed,
        durationMs: Date.now() - start,
        promptTokens: thinkingResult.usage?.prompt_tokens ?? 0,
        completionTokens: thinkingResult.usage?.completion_tokens ?? 0,
      };
    }

    // Step 2: Force-close thinking and generate final answer
    const forceClosePrompt = `${thinkingContent}\n</think\n>`;
    const continuationMessages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: "user",
        content: "Continue and provide your final answer based on your reasoning above.",
      },
      {
        role: "assistant",
        content: forceClosePrompt,
      },
    ];

    // Use /v1/completions for continuation (R7.1)
    const finalResult = await this.doCompletionWithRetry({
      model: this.config.model,
      prompt: `<|user|>\nContinue and provide your final answer.\n<|assistant|\n>${forceClosePrompt}`,
      max_tokens: req.maxTokens ?? this.config.defaultMaxTokens,
      temperature: req.temperature ?? 0.6,
      ...extraBody,
    });

    const fullContent = `${thinkingContent}\n</think\n>${finalContent(finalResult)}`;
    const parsed = parseResponse(fullContent);

    return {
      ...parsed,
      durationMs: Date.now() - start,
      promptTokens:
        (thinkingResult.usage?.prompt_tokens ?? 0) +
        (finalResult.usage?.prompt_tokens ?? 0),
      completionTokens:
        (thinkingResult.usage?.completion_tokens ?? 0) +
        (finalResult.usage?.completion_tokens ?? 0),
    };
  }

  /**
   * Execute chat completion with retry-on-5xx (R10.2).
   */
  private async doChatWithRetry(
    params: OpenAI.ChatCompletionCreateParamsNonStreaming & Record<string, unknown>,
  ): Promise<OpenAI.ChatCompletion> {
    try {
      return (await this.client.chat.completions.create({
        ...params,
        stream: false,
      } as OpenAI.ChatCompletionCreateParamsNonStreaming)) as OpenAI.ChatCompletion;
    } catch (err) {
      if (is5xx(err)) {
        logger.warn({ err }, "5xx from vLLM, retrying after 1s");
        await sleep(1_000);
        try {
          return (await this.client.chat.completions.create({
            ...params,
            stream: false,
          } as OpenAI.ChatCompletionCreateParamsNonStreaming)) as OpenAI.ChatCompletion;
        } catch (retryErr) {
          throw new UpstreamError(
            `vLLM returned 5xx after retry: ${errorMessage(retryErr)}`,
          );
        }
      }
      if (isTimeout(err)) {
        throw new TimeoutError(
          `Request exceeded timeout of ${this.config.requestTimeoutMs}ms`,
        );
      }
      throw new UpstreamError(`vLLM error: ${errorMessage(err)}`);
    }
  }

  /**
   * Execute completion with retry-on-5xx (for budget-controlled step 2).
   */
  private async doCompletionWithRetry(
    params: Record<string, unknown>,
  ): Promise<{ content: string; usage?: { prompt_tokens: number; completion_tokens: number } }> {
    // Use chat completions API for consistency
    try {
      const resp = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...params,
          stream: false,
        }),
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });

      if (!resp.ok) {
        if (resp.status >= 500) {
          logger.warn({ status: resp.status }, "5xx on completion, retrying");
          await sleep(1_000);
          const retryResp = await fetch(
            `${this.config.baseUrl}/chat/completions`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...params, stream: false }),
              signal: AbortSignal.timeout(this.config.requestTimeoutMs),
            },
          );
          if (!retryResp.ok) {
            throw new UpstreamError(
              `vLLM completion returned ${retryResp.status} after retry`,
            );
          }
          const retryData = await retryResp.json();
          return extractCompletion(retryData);
        }
        throw new UpstreamError(
          `vLLM completion returned ${resp.status}`,
        );
      }

      const data = await resp.json();
      return extractCompletion(data);
    } catch (err) {
      if (err instanceof UpstreamError || err instanceof TimeoutError) throw err;
      if (isTimeout(err)) {
        throw new TimeoutError(
          `Completion request exceeded timeout of ${this.config.requestTimeoutMs}ms`,
        );
      }
      throw new UpstreamError(`vLLM completion error: ${errorMessage(err)}`);
    }
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function extractCompletion(data: unknown): {
  content: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
} {
  const d = data as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };
  return {
    content: d.choices?.[0]?.message?.content ?? "",
    usage: d.usage,
  };
}

function finalContent(
  result: { content: string },
): string {
  return result.content;
}

function is5xx(err: unknown): boolean {
  if (err && typeof err === "object" && "status" in err) {
    const status = (err as { status: number }).status;
    return status >= 500 && status < 600;
  }
  return false;
}

function isTimeout(err: unknown): boolean {
  if (err instanceof Error) {
    return (
      err.name === "TimeoutError" ||
      err.name === "AbortError" ||
      err.message.includes("timeout") ||
      err.message.includes("ETIMEDOUT")
    );
  }
  return false;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
