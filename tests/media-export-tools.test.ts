import { unzipSync } from "fflate";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { DIGITAL_SOURCE_TYPE, imageKind, markAiVideo, readMp4Xmp, readXmp } from "@/lib/ai-mark";
import { exportVideo, runFfmpeg, videoInfo } from "@/lib/media-tools/ffmpeg";
import { badgeSvg, contactSheet, cropBox, renderImage } from "@/lib/media-tools/image";
import { zipFiles } from "@/lib/media-tools/zip";

// The export pack's tools (lib/media-tools): sharp for pictures, the real ffmpeg for clips, fflate for the zip.
let png: Buffer;
let clip: Buffer;
beforeAll(async () => {
  // A 600×800 picture: plain, with a lighter band at the bottom right where the badge goes.
  png = await sharp({ create: { width: 600, height: 800, channels: 3, background: "#884488" } }).png().toBuffer();
  // 2 s of a test pattern with a tone: a clip with sound, as Wan 3.0's are.
  const { files } = await runFfmpeg({
    args: ["-f", "lavfi", "-i", "testsrc2=duration=2:size=240x320:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-shortest", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-c:a", "aac", "-y", "clip.mp4"],
    inputs: {},
    outputs: ["clip.mp4"],
  });
  clip = files["clip.mp4"];
}, 60_000);

const sizeOf = async (b: Buffer) => {
  const m = await sharp(b).metadata();
  return [m.width, m.height];
};

describe("a picture at a social size", () => {
  it("keeps all of one side and cuts the other, a quarter of the way down when the height is cut", () => {
    expect(cropBox(600, 800, 9, 16)).toEqual({ left: 75, top: 0, width: 450, height: 800 });
    expect(cropBox(600, 800, 4, 5)).toEqual({ left: 0, top: 13, width: 600, height: 750 });
    expect(cropBox(600, 800, 1, 1)).toEqual({ left: 0, top: 50, width: 600, height: 600 });
    expect(cropBox(1600, 900, 1, 1)).toEqual({ left: 350, top: 0, width: 900, height: 900 });
  });

  it("comes out at that shape, never enlarged, as JPEG or PNG, marked AI-generated", async () => {
    const story = await renderImage(png, { size: "story", format: "jpg" });
    expect(imageKind(story)).toBe("jpeg");
    expect(await sizeOf(story)).toEqual([450, 800]);
    expect(readXmp(story)).toContain(DIGITAL_SOURCE_TYPE);
    expect(await sizeOf(await renderImage(png, { size: "feed", format: "png" }))).toEqual([600, 750]);
    expect(await sizeOf(await renderImage(png, { size: "square", format: "jpg" }))).toEqual([600, 600]);
    // Its own size, in its own format, isn't re-encoded: only marked.
    const same = await renderImage(png, { size: "original", format: "png" });
    expect(await sizeOf(same)).toEqual([600, 800]);
    expect(readXmp(same)).toContain(DIGITAL_SOURCE_TYPE);
  });

  it("can carry the small AI badge in its corner, drawn without any font", async () => {
    expect(badgeSvg(600, 800)).not.toContain("<text");
    const raw = async (b: Buffer) => sharp(b).extract({ left: 480, top: 720, width: 100, height: 60 }).raw().toBuffer();
    const [plain, badged] = await Promise.all([renderImage(png, { size: "original", format: "png", badge: false }), renderImage(png, { size: "original", format: "png", badge: true })]);
    const [a, b] = await Promise.all([raw(plain), raw(badged)]);
    expect(a.equals(b)).toBe(false);
  });

  it("makes a contact sheet of several, marked", async () => {
    const sheet = await contactSheet([png, png, png], { columns: 3 });
    expect(await sizeOf(sheet)).toEqual([3 * 360 + 4 * 12, 450 + 2 * 12]);
    expect(readXmp(sheet)).toContain(DIGITAL_SOURCE_TYPE);
  });
});

describe("a clip, exported", () => {
  it("carries the XMP mark in its own box, once, and still plays", async () => {
    const marked = markAiVideo(clip);
    expect(readMp4Xmp(clip)).toBeNull();
    expect(readMp4Xmp(marked)).toContain(DIGITAL_SOURCE_TYPE);
    expect(markAiVideo(marked).length).toBe(marked.length);
    expect((await videoInfo(marked)).duration).toBeCloseTo(2, 0);
    // Anything that isn't an MP4 comes back as it was.
    const notMp4 = Buffer.from([0, 0, 0, 24, 1, 2, 3]);
    expect(markAiVideo(notMp4)).toBe(notMp4);
  });

  it("as made is only marked; at a size it's cut to that shape with its sound; a trim is honoured", async () => {
    const asMade = await exportVideo(clip, { size: "original" });
    expect(asMade.length).toBe(markAiVideo(clip).length);
    const story = await exportVideo(clip, { size: "story" });
    expect(await videoInfo(story)).toMatchObject({ w: 180, h: 320, audio: true });
    expect(readMp4Xmp(story)).toContain(DIGITAL_SOURCE_TYPE);
    const trimmed = await exportVideo(clip, { size: "original", trim: { start: 0.5, end: 1.5, cuts: [] } });
    expect((await videoInfo(trimmed)).duration).toBeCloseTo(1, 0);
    const badged = await exportVideo(clip, { size: "square", badge: true });
    expect(await videoInfo(badged)).toMatchObject({ w: 240, h: 240 });
  }, 60_000);
});

describe("the zip", () => {
  it("holds every file under its own name, and gives them back as they went in", () => {
    const zip = zipFiles([
      { name: "zoë-01-original.png", bytes: png },
      { name: "about.txt", bytes: Buffer.from("made with AI", "utf8") },
    ]);
    const back = unzipSync(new Uint8Array(zip));
    expect(Object.keys(back).sort()).toEqual(["about.txt", "zoë-01-original.png"]);
    expect(Buffer.from(back["zoë-01-original.png"]).equals(png)).toBe(true);
    expect(Buffer.from(back["about.txt"]).toString()).toBe("made with AI");
  });
});
