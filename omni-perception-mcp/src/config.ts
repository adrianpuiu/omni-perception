import { z } from "zod";

/**
 * Server configuration schema and loader.
 * Implements: R8.1
 */

export const ConfigSchema = z.object({
  baseUrl: z.string().url(),
  model: z.string().min(1),
  allowedMediaPath: z.string().min(1),
  defaultMaxTokens: z.number().int().positive(),
  requestTimeoutMs: z.number().int().positive(),
  pdfDpi: z.number().int().min(72).max(300),
  logLevel: z.enum(["trace", "debug", "info", "warn", "error"]),
  tmpDir: z.string().min(1),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const homeDir = process.env.HOME || `/home/${process.env.USER || "user"}`;
  const raw = {
    baseUrl: process.env.NEMOTRON_OMNI_BASE_URL ?? "http://localhost:8000/v1",
    model: process.env.NEMOTRON_OMNI_MODEL ?? "nemotron_3_nano_omni",
    allowedMediaPath:
      process.env.NEMOTRON_OMNI_ALLOWED_MEDIA_PATH ?? homeDir,
    defaultMaxTokens: intOr(
      process.env.NEMOTRON_OMNI_DEFAULT_MAX_TOKENS,
      20480,
    ),
    requestTimeoutMs: intOr(
      process.env.NEMOTRON_OMNI_REQUEST_TIMEOUT_MS,
      600_000,
    ),
    pdfDpi: intOr(process.env.NEMOTRON_OMNI_PDF_DPI, 150),
    logLevel:
      (process.env.NEMOTRON_OMNI_LOG_LEVEL as Config["logLevel"]) ?? "info",
    tmpDir: process.env.NEMOTRON_OMNI_TMP_DIR ?? "/tmp",
  };

  return ConfigSchema.parse(raw);
}

function intOr(val: string | undefined, fallback: number): number {
  if (val === undefined) return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}
