import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * The last frame of a finished shot, as a JPEG, so the same character's next shot can start where this one ended
 * (David, 2026-10-21: the video "uses the baseline in between the video switch… make it feel more like a continuous
 * movie"). ffmpeg-static's binary, run on the bytes the reel already holds. Null when it can't: the next shot then
 * starts from its own picture, as every shot did before.
 */
export async function lastFrame(video: Buffer): Promise<Buffer | null> {
  if (testExtractor) return testExtractor(video);
  let dir: string | null = null;
  try {
    const bin = (await import("ffmpeg-static")).default as unknown as string | null;
    if (!bin) return null;
    dir = await mkdtemp(join(tmpdir(), "reel-frame-"));
    const input = join(dir, "shot.mp4");
    const output = join(dir, "last.jpg");
    await writeFile(input, video);
    // A quarter-second from the end: the last full frame, past any fade the model adds.
    await run(bin, ["-hide_banner", "-loglevel", "error", "-sseof", "-0.25", "-i", input, "-frames:v", "1", "-q:v", "2", "-y", output], { timeout: 20_000 });
    const frame = await readFile(output);
    return frame.length ? frame : null;
  } catch {
    return null;
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

let testExtractor: ((video: Buffer) => Promise<Buffer | null>) | null = null;
export function setFrameExtractorForTests(fn: ((video: Buffer) => Promise<Buffer | null>) | null): void {
  testExtractor = fn;
}
