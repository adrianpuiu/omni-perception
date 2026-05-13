/**
 * ReasoningHelper: manages thinking mode defaults, budget control, and
 * response parsing for the Nemotron model's <think/> delimiter.
 * Implements: R2.2, R2.3, R3.2, R4.4, R6.3, R7.1, R7.2, R7.3
 */

export interface ReasoningParams {
  enableThinking: boolean;
  reasoningBudget?: number;
  /** Grace period tokens when using budget-controlled mode (default 1024 per NVIDIA) */
  gracePeriod?: number;
}

export interface ReasoningOutput {
  reasoningContent: string;
  content: string;
  warning?: string;
}

export type Modality =
  | "image"
  | "audio"
  | "video"
  | "document"
  | "omni"
  | "transcribe";

/**
 * Return default reasoning params per modality.
 * Implements: R2.2, R3.2, R4.4, R6.3
 */
export function defaultsFor(modality: Modality): ReasoningParams {
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

/**
 * Infer thinking mode for "auto" based on present modalities.
 * Implements: R6.3
 * Precedence: video present → off; image-only → on; audio-only → off; mixed → off.
 */
export function autoResolveThinking(
  hasImage: boolean,
  hasAudio: boolean,
  hasVideo: boolean,
): ReasoningParams {
  if (hasVideo) return { enableThinking: false };
  if (hasImage && !hasAudio) return { enableThinking: true, reasoningBudget: 16384 };
  return { enableThinking: false };
}

/**
 * Parse model response, splitting on </think&gt; delimiter.
 * Implements: R2.3, R7.2
 */
export function parseResponse(raw: string): ReasoningOutput {
  const CLOSE_TAG = "</think";
  const idx = raw.indexOf(CLOSE_TAG);
  if (idx === -1) {
    return {
      reasoningContent: "",
      content: raw.trim(),
      warning: "no_think_delimiter",
    };
  }

  // Find the > after </think
  const closeEnd = raw.indexOf(">", idx);
  const tagEnd = closeEnd === -1 ? idx + CLOSE_TAG.length + 1 : closeEnd + 1;

  // Extract reasoning: everything between <think...> and </think...>
  let reasoning = raw.slice(0, idx);

  // Remove <think...> open tag if present
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
    content: raw.slice(tagEnd).trim(),
  };
}

/**
 * Merge user overrides into default reasoning params.
 */
export function mergeReasoning(
  defaults: ReasoningParams,
  override?: boolean,
  budget?: number,
): ReasoningParams {
  const enableThinking = override ?? defaults.enableThinking;
  const reasoningBudget = budget ?? defaults.reasoningBudget;
  return {
    enableThinking,
    ...(reasoningBudget !== undefined ? { reasoningBudget } : {}),
  };
}
