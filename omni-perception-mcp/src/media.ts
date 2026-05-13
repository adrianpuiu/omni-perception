import { realpath, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { MediaValidationError, PathSecurityError } from "./errors.js";
import type { Config } from "./config.js";

const execFileAsync = promisify(execFile);

const IMAGE_EXT = [".jpg", ".jpeg", ".png", ".webp"];
const AUDIO_EXT = [".wav", ".mp3"];
const VIDEO_EXT = [".mp4"];
const PDF_EXT = [".pdf"];

/**
 * MediaHandler: validates media paths, resolves symlinks, checks extensions,
 * enforces allowed-path guard, and probes durations.
 * Implements: R2.1, R2.4, R3.1, R4.1, R5.1, R8.2
 */
export class MediaHandler {
  private readonly allowedPath: string;

  constructor(cfg: Pick<Config, "allowedMediaPath">) {
    this.allowedPath = cfg.allowedMediaPath;
  }

  /**
   * Validate an image path and return a file:// URI.
   * Implements: R2.1, R2.4
   */
  async assertImage(filePath: string): Promise<string> {
    const resolved = await this.validate(
      filePath,
      IMAGE_EXT,
      "image",
      IMAGE_EXT.join(", "),
    );
    return toFileUri(resolved);
  }

  /**
   * Validate an audio path and return a file:// URI.
   * Duration must be ≤ maxDurationSec (default 3600).
   * Implements: R3.1
   */
  async assertAudio(
    filePath: string,
    maxDurationSec = 3600,
  ): Promise<string> {
    const resolved = await this.validate(
      filePath,
      AUDIO_EXT,
      "audio",
      AUDIO_EXT.join(", "),
    );
    const dur = await probeDurationSec(resolved);
    if (dur > maxDurationSec) {
      throw new MediaValidationError(
        `Audio duration ${dur.toFixed(1)}s exceeds maximum ${maxDurationSec}s`,
      );
    }
    return toFileUri(resolved);
  }

  /**
   * Validate a video path and return a file:// URI.
   * Duration must be ≤ maxDurationSec (default 120).
   * Implements: R4.1
   */
  async assertVideo(
    filePath: string,
    maxDurationSec = 120,
  ): Promise<string> {
    const resolved = await this.validate(
      filePath,
      VIDEO_EXT,
      "video",
      VIDEO_EXT.join(", "),
    );
    const dur = await probeDurationSec(resolved);
    if (dur > maxDurationSec) {
      throw new MediaValidationError(
        `Video duration ${dur.toFixed(1)}s exceeds maximum ${maxDurationSec}s`,
      );
    }
    return toFileUri(resolved);
  }

  /**
   * Validate a PDF path and return the absolute resolved path (not URI).
   * Implements: R5.1
   */
  async assertPdf(filePath: string): Promise<string> {
    return this.validate(filePath, PDF_EXT, "PDF", PDF_EXT.join(", "));
  }

  /**
   * Convert absolute path to file:// URI, encoding spaces and special chars.
   * Uses encodeURI (not encodeURIComponent) so / separators are preserved.
   */
  toFileUri(absPath: string): string {
    return toFileUri(absPath);
  }

  // ─── Internal ─────────────────────────────────────────────────────────

  private async validate(
    filePath: string,
    allowedExt: string[],
    label: string,
    extList: string,
  ): Promise<string> {
    // 1. Resolve symlinks
    let resolved: string;
    try {
      resolved = await realpath(filePath);
    } catch {
      throw new MediaValidationError(
        `${label} file not found: ${filePath}`,
      );
    }

    // 2. Path security: must be under allowed path
    if (!resolved.startsWith(this.allowedPath)) {
      throw new PathSecurityError(
        `Path '${filePath}' is outside allowed media directory '${this.allowedPath}'. ` +
          `Set NEMOTRON_OMNI_ALLOWED_MEDIA_PATH to allow access.`,
      );
    }

    // 3. Extension check
    const ext = getExt(resolved).toLowerCase();
    if (!allowedExt.includes(ext)) {
      throw new MediaValidationError(
        `Unsupported ${label} extension '${ext}'. Allowed: ${extList}`,
      );
    }

    // 4. File exists and has size > 0
    const info = await stat(resolved);
    if (info.size === 0) {
      throw new MediaValidationError(
        `${label} file is empty: ${filePath}`,
      );
    }

    return resolved;
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function getExt(p: string): string {
  const idx = p.lastIndexOf(".");
  return idx === -1 ? "" : p.slice(idx);
}

export function toFileUri(absPath: string): string {
  // encodeURI preserves / while encoding spaces etc.
  return `file://${encodeURI(absPath)}`;
}

/**
 * Probe media duration via ffprobe.
 * Returns duration in seconds.
 */
export async function probeDurationSec(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  const dur = parseFloat(stdout.trim());
  if (!Number.isFinite(dur)) {
    throw new MediaValidationError(
      `Could not determine duration for: ${filePath}`,
    );
  }
  return dur;
}
