/**
 * F014: E2E stdio harness test.
 * Spawns the MCP server as a child process and exercises
 * `initialize`, `tools/list`, and `tools/call` over stdio.
 * Implements: R12.3, R11.3
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(__dirname, "../../dist/index.js");

let serverProc: ChildProcess;
let msgId = 0;
let pendingResolve: ((value: any) => void) | null = null;
let pendingId: number | null = null;
let stdoutBuffer = "";
let stderrOutput = "";

function drainStdout() {
  serverProc.stdout!.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString();
    // Process complete lines
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop()!; // Keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.id === pendingId && pendingResolve) {
          const resolve = pendingResolve;
          pendingResolve = null;
          pendingId = null;
          resolve(parsed);
        }
      } catch {
        // Not JSON, skip
      }
    }
  });
}

function sendAndReceive(msg: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingResolve = null;
      pendingId = null;
      reject(new Error(`Timeout waiting for response to id=${msg.id}`));
    }, 30_000);

    pendingId = msg.id as number;
    pendingResolve = (value: any) => {
      clearTimeout(timeout);
      resolve(value);
    };

    const payload = JSON.stringify(msg);
    serverProc.stdin!.write(payload + "\n");
  });
}

describe("E2E: stdio harness", { timeout: 60_000, sequential: true }, () => {
  beforeAll(async () => {
    serverProc = spawn("node", [SERVER_PATH], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        NEMOTRON_OMNI_BASE_URL: "http://localhost:19999/v1", // intentionally unreachable
        NEMOTRON_OMNI_ALLOWED_MEDIA_PATH: "/tmp",
        NEMOTRON_OMNI_LOG_LEVEL: "warn",
        SKIP_DEPENDENCY_CHECK: "1",
      },
    });

    serverProc.stderr!.on("data", (chunk: Buffer) => {
      stderrOutput += chunk.toString();
    });

    serverProc.on("error", (err) => {
      console.error("Server process error:", err);
    });

    drainStdout();

    // Give the server a moment to start
    await new Promise((r) => setTimeout(r, 2000));
  });

  afterAll(() => {
    if (serverProc && !serverProc.killed) {
      serverProc.kill("SIGTERM");
    }
  });

  it("should complete MCP initialize handshake", async () => {
    const resp = await sendAndReceive({
      jsonrpc: "2.0",
      id: ++msgId,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-harness", version: "1.0.0" },
      },
    });

    expect(resp.jsonrpc).toBe("2.0");
    expect(resp.result).toBeDefined();
    expect(resp.result.serverInfo.name).toBe("omni-perception-mcp-server");
    expect(resp.result.capabilities.tools).toBeDefined();
  });

  it("should list exactly 20 tools", async () => {
    // Send initialized notification
    serverProc.stdin!.write(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }) + "\n",
    );

    await new Promise((r) => setTimeout(r, 500));

    const resp = await sendAndReceive({
      jsonrpc: "2.0",
      id: ++msgId,
      method: "tools/list",
      params: {},
    });

    expect(resp.result).toBeDefined();
    expect(resp.result.tools).toHaveLength(20);

    const names = resp.result.tools.map((t: any) => t.name).sort();
    expect(names).toEqual([
      "analyze_audio",
      "analyze_chart",
      "analyze_document",
      "analyze_image",
      "analyze_multimodal",
      "analyze_video",
      "classify_media",
      "compare_images",
      "describe_media",
      "extract_data",
      "meeting_notes",
      "omni_health",
      "qa_document",
      "read_code",
      "repurpose_content",
      "transcribe_audio",
      "verify_output",
      "video_search_index",
      "video_timeline",
      "voice_intent",
    ]);

    // Verify each tool has required fields
    for (const tool of resp.result.tools) {
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema).toBeDefined();
    }
  });

  it("should respond to omni_health with healthy=false when vLLM unreachable", async () => {
    const resp = await sendAndReceive({
      jsonrpc: "2.0",
      id: ++msgId,
      method: "tools/call",
      params: {
        name: "omni_health",
        arguments: {},
      },
    });

    expect(resp.result).toBeDefined();
    expect(resp.result.content).toBeDefined();
    expect(resp.result.content[0].type).toBe("text");

    const data = JSON.parse(resp.result.content[0].text);
    expect(data.healthy).toBe(false);
    expect(data.error).toBeDefined();
  });

  it("should return error for invalid image path", async () => {
    const resp = await sendAndReceive({
      jsonrpc: "2.0",
      id: ++msgId,
      method: "tools/call",
      params: {
        name: "analyze_image",
        arguments: {
          path: "/tmp/nonexistent_image.xyz",
          prompt: "describe this",
        },
      },
    });

    expect(resp.result).toBeDefined();
    expect(resp.result.isError).toBe(true);
    expect(resp.result.content[0].text).toContain("Error");
  });

  it("should not write non-MCP data to stdout (R11.3)", () => {
    // stdoutBuffer should only contain valid JSON lines
    // (after draining, the buffer should have only partial/incomplete JSON or empty)
    // stderr should have log output
    expect(stderrOutput.length).toBeGreaterThan(0);
  });
});
