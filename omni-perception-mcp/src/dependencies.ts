import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DependencyError } from "./errors.js";
import { logger } from "./logger.js";

const execFileAsync = promisify(execFile);

/**
 * Verify system dependencies at startup.
 * Implements: R10.4
 */
export async function checkDependencies(): Promise<void> {
  const deps = [
    { cmd: "pdftoppm", args: ["-v"], label: "poppler-utils (pdftoppm)" },
    { cmd: "ffprobe", args: ["-version"], label: "ffmpeg (ffprobe)" },
  ];

  for (const dep of deps) {
    try {
      await execFileAsync(dep.cmd, dep.args, { timeout: 5_000 });
    } catch {
      const hint =
        dep.cmd === "pdftoppm"
          ? "Install with: sudo apt-get install poppler-utils"
          : "Install with: sudo apt-get install ffmpeg";
      throw new DependencyError(
        `Missing required dependency: ${dep.label}. ${hint}`,
      );
    }
  }

  logger.info("All system dependencies satisfied");
}
