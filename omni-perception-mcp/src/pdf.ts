import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { logger } from "./logger.js";
import type { Config } from "./config.js";

const execFileAsync = promisify(execFile);

/**
 * PdfRenderer: renders PDF pages to PNG via pdftoppm.
 * Implements: R5.1, R5.5, R5.6, R10.4
 */
export class PdfRenderer {
  private readonly dpi: number;
  private readonly tmpDir: string;

  constructor(cfg: Pick<Config, "pdfDpi" | "tmpDir">) {
    this.dpi = cfg.pdfDpi;
    this.tmpDir = cfg.tmpDir;
  }

  /**
   * Render specified pages of a PDF to PNG images.
   * @param pdfPath - Absolute path to the PDF file
   * @param pages - "all" or array of 1-indexed page numbers
   * @returns RenderedPdf with cleanup function
   */
  async render(
    pdfPath: string,
    pages: "all" | number[],
  ): Promise<RenderedPdf> {
    const workDir = await mkdtemp(join(this.tmpDir, "omni-mcp-pdf-"));

    try {
      const pageCount = await this.getPageCount(pdfPath);

      // Warn if > 50 pages (R5.5)
      if (pageCount > 50) {
        logger.warn(
          { pageCount, pdfPath },
          "Large PDF: %d pages, proceeding anyway",
        );
      }

      // Determine page range for pdftoppm
      const firstPage =
        pages === "all" ? undefined : Math.min(...pages);
      const lastPage = pages === "all" ? undefined : Math.max(...pages);

      // Build pdftoppm args
      const args: string[] = ["-r", String(this.dpi), "-png"];
      if (firstPage !== undefined) args.push("-f", String(firstPage));
      if (lastPage !== undefined) args.push("-l", String(lastPage));
      args.push(pdfPath, join(workDir, "page"));

      await execFileAsync("pdftoppm", args, { timeout: 120_000 });

      // List generated PNGs
      const files = await readdir(workDir);
      const pngFiles = files
        .filter((f) => f.endsWith(".png"))
        .sort()
        .map((f) => join(workDir, f));

      // Map to page numbers
      const pageResults: RenderedPage[] = [];
      const startIdx = firstPage ?? 1;

      for (let i = 0; i < pngFiles.length; i++) {
        const pageNum = startIdx + i;
        // If specific pages requested, only include those
        if (pages === "all" || pages.includes(pageNum)) {
          pageResults.push({ pageNumber: pageNum, pngPath: pngFiles[i]! });
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
        },
      };
    } catch (err) {
      // Cleanup on failure (R5.6)
      try {
        await rm(workDir, { recursive: true, force: true });
      } catch {
        // best effort
      }
      throw err;
    }
  }

  /**
   * Get total page count via pdfinfo.
   */
  private async getPageCount(pdfPath: string): Promise<number> {
    const { stdout } = await execFileAsync("pdfinfo", [
      "-box",
      "-enc",
      "UTF-8",
      pdfPath,
    ]);
    const match = stdout.match(/Pages:\s+(\d+)/);
    if (!match) {
      throw new Error(`Could not determine page count for: ${pdfPath}`);
    }
    return parseInt(match[1]!, 10);
  }
}

export interface RenderedPdf {
  tempDir: string;
  pageCount: number;
  pages: RenderedPage[];
  cleanup: () => Promise<void>;
}

export interface RenderedPage {
  pageNumber: number;
  pngPath: string;
}
