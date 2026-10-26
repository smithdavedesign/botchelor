import { beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { AI_DESCRIPTION } from "@/lib/ai-mark";
import { boomerang, frameAt, keptParts, runFfmpeg, seamlessLoop, videoDuration } from "@/lib/media-tools/ffmpeg";

// The real binary (ffmpeg-static) on a clip it makes itself: a moving test pattern, 3 s at 24 fps.
let clip: Buffer;
beforeAll(async () => {
  const { files } = await runFfmpeg({
    args: ["-f", "lavfi", "-i", "testsrc2=duration=3:size=320x240:rate=24", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-y", "clip.mp4"],
    inputs: {},
    outputs: ["clip.mp4"],
  });
  clip = files["clip.mp4"];
}, 60_000);

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
/** How far apart two pictures are: the mean difference per channel, 0–255. */
async function distance(a: Buffer, b: Buffer): Promise<number> {
  const [x, y] = await Promise.all([a, b].map((p) => sharp(p).resize(64, 48).removeAlpha().raw().toBuffer()));
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += Math.abs(x[i] - y[i]);
  return sum / x.length;
}

describe("what a trim keeps", () => {
  it("is the whole clip untrimmed, and the stretches between its start, cuts and end otherwise", () => {
    expect(keptParts(5)).toEqual([[0, 5]]);
    expect(keptParts(5, { start: 1, end: 4, cuts: [] })).toEqual([[1, 4]]);
    expect(keptParts(5, { start: 0, end: null, cuts: [[1, 2], [3, 3.5]] })).toEqual([[0, 1], [2, 3], [3.5, 5]]);
    // An end past the clip is the clip's end; a sliver left between cuts isn't a stretch.
    expect(keptParts(3, { start: 0, end: 9, cuts: [[1, 2.95]] })).toEqual([[0, 1]]);
  });
});

describe("ffmpeg on a clip", () => {
  it("reads its length", async () => {
    expect(await videoDuration(clip)).toBeCloseTo(3, 1);
  });

  it("cuts a frame at a time, and at the end of what's kept", async () => {
    const mid = await frameAt(clip, 1.5);
    expect(mid.png.subarray(0, 4)).toEqual(PNG);
    expect(mid.at).toBe(1.5);
    const end = await frameAt(clip, "end", { start: 0, end: 2, cuts: [] });
    expect(end.at).toBeCloseTo(1.92, 2);
    // A different moment of the moving pattern: a different picture.
    expect(await distance(mid.png, end.png)).toBeGreaterThan(2);
    // Past the end is held to the clip.
    expect((await frameAt(clip, 99)).at).toBeLessThan(3);
  });

  it("makes a boomerang twice as long as what's kept, marked AI-generated", async () => {
    const out = await boomerang(clip, { start: 0.5, end: 2.5, cuts: [] });
    expect(await videoDuration(out)).toBeCloseTo(4, 0);
    const { stderr } = await runFfmpeg({ args: ["-i", "in.mp4"], inputs: { "in.mp4": out }, outputs: [], quiet: false, allowFail: true });
    expect(stderr).toContain(AI_DESCRIPTION);
    // It ends where it began: played forward, then back.
    const [first, last] = await Promise.all([frameAt(out, 0), frameAt(out, "end")]);
    expect(await distance(first.png, last.png)).toBeLessThan(6);
  }, 60_000);

  it("makes a loop that ends on the frame it starts on", async () => {
    const out = await seamlessLoop(clip, null, 0.6);
    expect(await videoDuration(out)).toBeCloseTo(2.4, 0);
    const [first, last] = await Promise.all([frameAt(out, 0), frameAt(out, "end")]);
    const [start, middle] = await Promise.all([distance(first.png, last.png), distance(first.png, (await frameAt(out, 1.2)).png)]);
    // The seam is far closer than the clip's own middle is to its start.
    expect(start).toBeLessThan(middle / 2);
  }, 60_000);

  it("refuses a clip too short to loop", async () => {
    await expect(seamlessLoop(clip, { start: 0, end: 0.6, cuts: [] })).rejects.toThrow(/too short/);
  });
});
