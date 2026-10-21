import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ffmpeg from "ffmpeg-static";
import { lastFrame } from "@/lib/adult/frames";

// The real ffmpeg on a real clip (lib/adult/frames.ts). Skipped where the binary didn't install.
const bin = ffmpeg as unknown as string | null;
describe.skipIf(!bin || !existsSync(bin))("a shot's last frame", () => {
  it("is a JPEG of the clip's end, and null for bytes that aren't a video", async () => {
    const dir = mkdtempSync(join(tmpdir(), "reel-test-"));
    try {
      const clip = join(dir, "clip.mp4");
      // Two seconds: red, then blue for the last half.
      execFileSync(bin!, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=64x64:d=1", "-f", "lavfi", "-i", "color=c=blue:s=64x64:d=1", "-filter_complex", "[0][1]concat=n=2:v=1", "-pix_fmt", "yuv420p", "-y", clip]);
      const frame = await lastFrame(readFileSync(clip));
      expect(frame?.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
      // Blue at the end, not red: decode one pixel back out of the JPEG.
      const px = execFileSync(bin!, ["-hide_banner", "-loglevel", "error", "-f", "mjpeg", "-i", "pipe:0", "-vf", "scale=1:1,format=rgb24", "-f", "rawvideo", "pipe:1"], { input: frame! });
      expect(px[2]).toBeGreaterThan(200);
      expect(px[0]).toBeLessThan(60);
      expect(await lastFrame(Buffer.from([0, 0, 0, 24]))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
