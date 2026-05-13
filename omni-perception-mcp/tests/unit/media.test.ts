import { describe, it, expect, vi, beforeEach } from "vitest";
import { MediaHandler, toFileUri } from "../../src/media.js";
import { MediaValidationError, PathSecurityError } from "../../src/errors.js";
import type { Config } from "../../src/config.js";

vi.mock("node:fs/promises", () => ({
  realpath: vi.fn(),
  stat: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { realpath, stat } from "node:fs/promises";

const media = new MediaHandler({ allowedMediaPath: "/home/user" } as Pick<Config, "allowedMediaPath">);

describe("toFileUri", () => {
  it("should encode spaces", () => {
    expect(toFileUri("/home/user/My Docs/x.pdf")).toBe(
      "file:///home/user/My%20Docs/x.pdf",
    );
  });

  it("should preserve forward slashes", () => {
    expect(toFileUri("/home/user/test.jpg")).toBe(
      "file:///home/user/test.jpg",
    );
  });
});

describe("MediaHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("assertImage", () => {
    it("should reject unsupported extension", async () => {
      vi.mocked(realpath).mockResolvedValue("/home/user/foo.gif");
      vi.mocked(stat).mockResolvedValue({ size: 1024 } as never);

      await expect(media.assertImage("/home/user/foo.gif")).rejects.toThrow(
        MediaValidationError,
      );
    });

    it("should reject path outside allowed directory", async () => {
      vi.mocked(realpath).mockResolvedValue("/etc/passwd");

      await expect(media.assertImage("/etc/passwd")).rejects.toThrow(
        PathSecurityError,
      );
    });

    it("should reject non-existent file", async () => {
      vi.mocked(realpath).mockRejectedValue(new Error("ENOENT"));

      await expect(media.assertImage("/home/user/missing.jpg")).rejects.toThrow(
        MediaValidationError,
      );
    });

    it("should return file URI for valid image", async () => {
      vi.mocked(realpath).mockResolvedValue("/home/user/photo.jpg");
      vi.mocked(stat).mockResolvedValue({ size: 1024 } as never);

      const uri = await media.assertImage("/home/user/photo.jpg");
      expect(uri).toBe("file:///home/user/photo.jpg");
    });

    it("should handle symlink pointing outside allowed dir", async () => {
      vi.mocked(realpath).mockResolvedValue("/tmp/sensitive/data.jpg");

      await expect(
        media.assertImage("/home/user/link.jpg"),
      ).rejects.toThrow(PathSecurityError);
    });

    it("should reject empty file", async () => {
      vi.mocked(realpath).mockResolvedValue("/home/user/empty.png");
      vi.mocked(stat).mockResolvedValue({ size: 0 } as never);

      await expect(media.assertImage("/home/user/empty.png")).rejects.toThrow(
        MediaValidationError,
      );
    });
  });

  describe("assertVideo", () => {
    it("should reject non-mp4 extension", async () => {
      vi.mocked(realpath).mockResolvedValue("/home/user/clip.avi");
      vi.mocked(stat).mockResolvedValue({ size: 1024 } as never);

      await expect(media.assertVideo("/home/user/clip.avi")).rejects.toThrow(
        MediaValidationError,
      );
    });

    it("should reject video exceeding max duration", async () => {
      vi.mocked(realpath).mockResolvedValue("/home/user/long.mp4");
      vi.mocked(stat).mockResolvedValue({ size: 1024 } as never);

      const { execFile } = await import("node:child_process");
      vi.mocked(execFile).mockImplementation(
        (_cmd: unknown, _args: unknown, cb: unknown) => {
          (cb as (err: null, result: { stdout: string }) => void)(null, { stdout: "180.5\n" });
        },
      );

      await expect(media.assertVideo("/home/user/long.mp4", 120)).rejects.toThrow(
        MediaValidationError,
      );
    });

    it("should accept valid video within duration", async () => {
      vi.mocked(realpath).mockResolvedValue("/home/user/clip.mp4");
      vi.mocked(stat).mockResolvedValue({ size: 1024 } as never);

      const { execFile } = await import("node:child_process");
      vi.mocked(execFile).mockImplementation(
        (_cmd: unknown, _args: unknown, cb: unknown) => {
          (cb as (err: null, result: { stdout: string }) => void)(null, { stdout: "30.0\n" });
        },
      );

      const uri = await media.assertVideo("/home/user/clip.mp4", 120);
      expect(uri).toBe("file:///home/user/clip.mp4");
    });
  });
});
