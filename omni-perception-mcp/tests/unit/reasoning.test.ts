import { describe, it, expect } from "vitest";
import {
  parseResponse,
  defaultsFor,
  autoResolveThinking,
  mergeReasoning,
} from "../../src/reasoning.js";

describe("parseResponse", () => {
  it("should parse well-formed think tags", () => {
    const result = parseResponse("<think\n>reasoning here</think\n>final answer");
    expect(result.reasoningContent).toBe("reasoning here");
    expect(result.content).toBe("final answer");
    expect(result.warning).toBeUndefined();
  });

  it("should return full content with warning when no delimiter", () => {
    const result = parseResponse("no delimiter here");
    expect(result.reasoningContent).toBe("");
    expect(result.content).toBe("no delimiter here");
    expect(result.warning).toBe("no_think_delimiter");
  });

  it("should handle content before <think", () => {
    const result = parseResponse("preamble<think\n>reasoning</think\n>answer");
    expect(result.reasoningContent).toBe("reasoning");
    expect(result.content).toBe("answer");
  });

  it("should handle only delimiter with no reasoning content", () => {
    const result = parseResponse("<think\n></think\n>just the answer");
    expect(result.reasoningContent).toBe("");
    expect(result.content).toBe("just the answer");
  });

  it("should handle multi-line reasoning", () => {
    const result = parseResponse(
      "<think\n>Line 1\nLine 2\nLine 3</think\n>\nFinal output",
    );
    expect(result.reasoningContent).toBe("Line 1\nLine 2\nLine 3");
    expect(result.content).toBe("Final output");
  });
});

describe("defaultsFor", () => {
  it("should return thinking ON for image", () => {
    const d = defaultsFor("image");
    expect(d.enableThinking).toBe(true);
    expect(d.reasoningBudget).toBe(16384);
  });

  it("should return thinking ON for document", () => {
    const d = defaultsFor("document");
    expect(d.enableThinking).toBe(true);
    expect(d.reasoningBudget).toBe(16384);
  });

  it("should return thinking OFF for audio", () => {
    expect(defaultsFor("audio").enableThinking).toBe(false);
  });

  it("should return thinking OFF for video", () => {
    expect(defaultsFor("video").enableThinking).toBe(false);
  });

  it("should return thinking OFF for omni", () => {
    expect(defaultsFor("omni").enableThinking).toBe(false);
  });

  it("should return thinking OFF for transcribe", () => {
    expect(defaultsFor("transcribe").enableThinking).toBe(false);
  });
});

describe("autoResolveThinking", () => {
  it("should return OFF when video present", () => {
    expect(autoResolveThinking(false, false, true).enableThinking).toBe(false);
  });

  it("should return ON for image-only", () => {
    const r = autoResolveThinking(true, false, false);
    expect(r.enableThinking).toBe(true);
    expect(r.reasoningBudget).toBe(16384);
  });

  it("should return OFF for audio-only", () => {
    expect(autoResolveThinking(false, true, false).enableThinking).toBe(false);
  });

  it("should return OFF for mixed image+audio", () => {
    expect(autoResolveThinking(true, true, false).enableThinking).toBe(false);
  });

  it("should return OFF for image+video", () => {
    expect(autoResolveThinking(true, false, true).enableThinking).toBe(false);
  });
});

describe("mergeReasoning", () => {
  it("should use defaults when no override", () => {
    const merged = mergeReasoning(defaultsFor("image"));
    expect(merged.enableThinking).toBe(true);
    expect(merged.reasoningBudget).toBe(16384);
  });

  it("should apply boolean override", () => {
    const merged = mergeReasoning(defaultsFor("image"), false);
    expect(merged.enableThinking).toBe(false);
  });

  it("should apply budget override", () => {
    const merged = mergeReasoning(defaultsFor("image"), true, 8192);
    expect(merged.reasoningBudget).toBe(8192);
  });
});
