import { describe, it, expect, vi, beforeEach } from "vitest";
import { PdfRenderer } from "../../src/pdf.js";
import type { Config } from "../../src/config.js";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  mkdtemp: vi.fn(),
  readdir: vi.fn(),
  rm: vi.fn(),
}));

import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";

const renderer = new PdfRenderer({
  pdfDpi: 150,
  tmpDir: "/tmp",
} as Pick<Config, "pdfDpi" | "tmpDir">);

/** Helper: get the callback from promisified execFile call (last arg) */
function getCallback(args: unknown[]): (err: Error | null, result: { stdout: string }) => void {
  return args[args.length - 1] as (err: Error | null, result: { stdout: string }) => void;
}

describe("PdfRenderer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mkdtemp).mockResolvedValue("/tmp/omni-mcp-pdf-test");
  });

  it("should render all pages and return page info", async () => {
    let callCount = 0;
    const mockImpl = (...args: unknown[]) => {
      callCount++;
      const cb = getCallback(args);
      if (callCount === 1) {
        // pdfinfo call
        cb(null, { stdout: "Pages:        3\nTitle:  Test\n" });
      } else {
        // pdftoppm call
        cb(null, { stdout: "" });
      }
    };
    vi.mocked(execFile).mockImplementation(mockImpl as any);

    vi.mocked(readdir).mockResolvedValue([
      "page-1.png",
      "page-2.png",
      "page-3.png",
    ] as never);

    vi.mocked(rm).mockResolvedValue(undefined);

    const result = await renderer.render("/home/user/doc.pdf", "all");

    expect(result.pageCount).toBe(3);
    expect(result.pages).toHaveLength(3);
    expect(result.pages[0]!.pageNumber).toBe(1);
    expect(result.pages[2]!.pageNumber).toBe(3);

    await result.cleanup();
    expect(rm).toHaveBeenCalled();
  });

  it("should render specific pages only", async () => {
    let callCount = 0;
    const mockImpl = (...args: unknown[]) => {
      callCount++;
      const cb = getCallback(args);
      if (callCount === 1) {
        cb(null, { stdout: "Pages:        5\n" });
      } else {
        cb(null, { stdout: "" });
      }
    };
    vi.mocked(execFile).mockImplementation(mockImpl as any);

    vi.mocked(readdir).mockResolvedValue([
      "page-2.png",
      "page-3.png",
      "page-4.png",
    ] as never);

    vi.mocked(rm).mockResolvedValue(undefined);

    const result = await renderer.render("/home/user/doc.pdf", [2, 4]);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]!.pageNumber).toBe(2);
    expect(result.pages[1]!.pageNumber).toBe(4);
  });

  it("should cleanup on render failure", async () => {
    const mockImpl = (...args: unknown[]) => {
      const cb = getCallback(args);
      cb(new Error("pdftoppm failed"), { stdout: "" });
    };
    vi.mocked(execFile).mockImplementation(mockImpl as any);

    vi.mocked(rm).mockResolvedValue(undefined);

    await expect(
      renderer.render("/home/user/bad.pdf", "all"),
    ).rejects.toThrow("pdftoppm failed");

    expect(rm).toHaveBeenCalled();
  });
});
