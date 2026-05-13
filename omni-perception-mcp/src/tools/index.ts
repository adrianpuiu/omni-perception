/**
 * Register all MCP tools on the server.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OmniClient } from "../client.js";
import type { MediaHandler } from "../media.js";
import type { Config } from "../config.js";

// Core analysis (7)
import { registerHealthTool } from "./omni_health.js";
import { registerAnalyzeImage } from "./analyze_image.js";
import {
  registerAnalyzeAudio,
  registerTranscribeAudio,
} from "./analyze_audio.js";
import { registerAnalyzeVideo } from "./analyze_video.js";
import { registerAnalyzeDocument } from "./analyze_document.js";
import { registerAnalyzeMultimodal } from "./analyze_multimodal.js";

// Advanced workflows (6)
import { registerCompareImages } from "./compare_images.js";
import { registerExtractData } from "./extract_data.js";
import { registerVideoTimeline } from "./video_timeline.js";
import { registerDescribeMedia } from "./describe_media.js";
import { registerReadCode } from "./read_code.js";
import { registerClassifyMedia } from "./classify_media.js";

// Multi-call workflows (3)
import { registerMeetingNotes } from "./meeting_notes.js";
import { registerQaDocument } from "./qa_document.js";
import { registerRepurposeContent } from "./repurpose_content.js";

// Agent building blocks (4)
import { registerVideoSearchIndex } from "./video_search_index.js";
import { registerAnalyzeChart } from "./analyze_chart.js";
import { registerVoiceIntent } from "./voice_intent.js";
import { registerVerifyOutput } from "./verify_output.js";

export function registerAllTools(
  server: McpServer,
  client: OmniClient,
  media: MediaHandler,
  cfg: Config,
): void {
  // Core analysis (7)
  registerHealthTool(server, client);
  registerAnalyzeImage(server, client, media);
  registerAnalyzeAudio(server, client, media);
  registerTranscribeAudio(server, client, media);
  registerAnalyzeVideo(server, client, media);
  registerAnalyzeDocument(server, client, media, cfg);
  registerAnalyzeMultimodal(server, client, media);

  // Advanced workflows (6)
  registerCompareImages(server, client, media);
  registerExtractData(server, client, media, cfg);
  registerVideoTimeline(server, client, media);
  registerDescribeMedia(server, client, media);
  registerReadCode(server, client, media);
  registerClassifyMedia(server, client, media, cfg);

  // Multi-call workflows (3)
  registerMeetingNotes(server, client, media, cfg);
  registerQaDocument(server, client, media, cfg);
  registerRepurposeContent(server, client, media);

  // Agent building blocks (4)
  registerVideoSearchIndex(server, client, media);
  registerAnalyzeChart(server, client, media);
  registerVoiceIntent(server, client, media);
  registerVerifyOutput(server, client, media, cfg);
}
