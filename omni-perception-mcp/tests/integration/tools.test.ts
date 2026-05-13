/**
 * Integration tests for each tool against a running vLLM server.
 * Skipped unless INTEGRATION=1 env var is set.
 * Implements: R12.2
 */
import { describe, it, expect, beforeAll } from "vitest";

const SKIP = !process.env.INTEGRATION;

describe.skipIf(SKIP)("Integration: client", { timeout: 120_000 }, () => {
  let client: any;
  let config: any;

  beforeAll(async () => {
    const { loadConfig } = await import("../../src/config.js");
    const { OmniClient } = await import("../../src/client.js");
    config = loadConfig();
    client = new OmniClient(config);
  });

  it("should return healthy from vLLM", async () => {
    const result = await client.health();
    expect(result.healthy).toBe(true);
    expect(result.model).toBeDefined();
  });
});

describe.skipIf(SKIP)("Integration: analyze_image", { timeout: 120_000 }, () => {
  it("should analyze a test image", async () => {
    const { loadConfig } = await import("../../src/config.js");
    const { OmniClient } = await import("../../src/client.js");
    const { MediaHandler } = await import("../../src/media.js");
    const { defaultsFor, mergeReasoning } = await import("../../src/reasoning.js");

    const config = loadConfig();
    const client = new OmniClient(config);
    const media = new MediaHandler(config);

    // Use the fixture image
    const uri = await media.assertImage(
      process.env.TEST_IMAGE_PATH ?? "tests/fixtures/sample-image.png",
    );

    const result = await client.chat({
      parts: [
        { type: "image_url", imageUrl: uri },
        { type: "text", text: "Describe what you see in this image." },
      ],
      reasoning: mergeReasoning(defaultsFor("image"), false), // Disable thinking for speed
    });

    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
  });
});

describe.skipIf(SKIP)("Integration: transcribe_audio", { timeout: 120_000 }, () => {
  it("should transcribe a test audio file", async () => {
    const { loadConfig } = await import("../../src/config.js");
    const { OmniClient } = await import("../../src/client.js");
    const { MediaHandler } = await import("../../src/media.js");

    const config = loadConfig();
    const client = new OmniClient(config);
    const media = new MediaHandler(config);

    const uri = await media.assertAudio(
      process.env.TEST_AUDIO_PATH ?? "tests/fixtures/sample-audio-10s.wav",
    );

    const result = await client.chat({
      parts: [
        { type: "input_audio", audioUrl: uri },
        { type: "text", text: "Transcribe this audio." },
      ],
      reasoning: { enableThinking: false },
      temperature: 0.2,
      topK: 1,
    });

    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
  });
});

describe.skipIf(SKIP)("Integration: analyze_video", { timeout: 120_000 }, () => {
  it("should analyze a test video", async () => {
    const { loadConfig } = await import("../../src/config.js");
    const { OmniClient } = await import("../../src/client.js");
    const { MediaHandler } = await import("../../src/media.js");

    const config = loadConfig();
    const client = new OmniClient(config);
    const media = new MediaHandler(config);

    const uri = await media.assertVideo(
      process.env.TEST_VIDEO_PATH ?? "tests/fixtures/sample-video-30s.mp4",
    );

    const result = await client.chat({
      parts: [
        { type: "video_url", videoUrl: uri },
        { type: "text", text: "Describe what happens in this video." },
      ],
      reasoning: { enableThinking: false },
      useAudioInVideo: true,
    });

    expect(result.content).toBeDefined();
  });
});

describe.skipIf(SKIP)("Integration: analyze_document", { timeout: 180_000 }, () => {
  it("should analyze a test PDF", async () => {
    const { loadConfig } = await import("../../src/config.js");
    const { OmniClient } = await import("../../src/client.js");
    const { MediaHandler } = await import("../../src/media.js");
    const { PdfRenderer } = await import("../../src/pdf.js");
    const { toFileUri } = await import("../../src/media.js");
    const { defaultsFor, mergeReasoning } = await import("../../src/reasoning.js");

    const config = loadConfig();
    const client = new OmniClient(config);
    const media = new MediaHandler(config);
    const pdfRenderer = new PdfRenderer(config);

    const pdfPath = await media.assertPdf(
      process.env.TEST_PDF_PATH ?? "tests/fixtures/sample-doc-5p.pdf",
    );
    const rendered = await pdfRenderer.render(pdfPath, "all");

    try {
      const defaults = defaultsFor("document");
      const reasoning = mergeReasoning(defaults, false); // Off for speed

      const perPage = [];
      for (const page of rendered.pages.slice(0, 2)) {
        // Test first 2 pages only
        const uri = toFileUri(page.pngPath);
        const result = await client.chat({
          parts: [
            { type: "image_url", imageUrl: uri },
            { type: "text", text: `Page ${page.pageNumber}. Summarize this page.` },
          ],
          reasoning,
        });
        perPage.push({ page: page.pageNumber, content: result.content });
      }

      expect(perPage).toHaveLength(2);
      expect(perPage[0].content.length).toBeGreaterThan(0);
    } finally {
      await rendered.cleanup();
    }
  });
});
