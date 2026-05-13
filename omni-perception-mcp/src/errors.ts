/**
 * Typed error hierarchy mapped to MCP error codes.
 * Implements: R10.1–R10.4
 */

export class OmniError extends Error {
  override readonly name = "OmniError";
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

/** Invalid file extension, missing file, etc. → MCP InvalidParams (-32602) */
export class MediaValidationError extends OmniError {
  override readonly name = "MediaValidationError";
  constructor(message: string) {
    super(message, "MEDIA_VALIDATION");
  }
}

/** Path traversal / outside allowed directory → MCP InvalidParams (-32602) */
export class PathSecurityError extends OmniError {
  override readonly name = "PathSecurityError";
  constructor(message: string) {
    super(message, "PATH_SECURITY");
  }
}

/** General validation (e.g., too many modalities) → MCP InvalidParams (-32602) */
export class ValidationError extends OmniError {
  override readonly name = "ValidationError";
  constructor(message: string) {
    super(message, "VALIDATION");
  }
}

/** Request timeout → MCP InternalError (-32603) */
export class TimeoutError extends OmniError {
  override readonly name = "TimeoutError";
  constructor(message: string) {
    super(message, "TIMEOUT");
  }
}

/** Upstream 5xx / network → MCP InternalError (-32603) */
export class UpstreamError extends OmniError {
  override readonly name = "UpstreamError";
  constructor(message: string) {
    super(message, "UPSTREAM");
  }
}

/** Missing system dependency (pdftoppm, ffprobe) → startup exit */
export class DependencyError extends OmniError {
  override readonly name = "DependencyError";
  constructor(message: string) {
    super(message, "DEPENDENCY");
  }
}

/**
 * Map OmniError to MCP error code numbers.
 * See JSON-RPC 2.0 spec + MCP additions.
 */
export function toMcpErrorCode(e: unknown): number {
  if (e instanceof PathSecurityError) return -32602; // InvalidParams
  if (e instanceof MediaValidationError) return -32602;
  if (e instanceof ValidationError) return -32602;
  if (e instanceof TimeoutError) return -32603; // InternalError
  if (e instanceof UpstreamError) return -32603;
  return -32603; // default: InternalError
}

export function toMcpErrorMessage(e: unknown): string {
  if (e instanceof OmniError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
