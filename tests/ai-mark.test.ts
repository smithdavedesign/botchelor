import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getAsset } from "@/app/api/assets/[id]/route";
import { AI_CREDIT, AI_HEADERS, DIGITAL_SOURCE_TYPE, hasAiMark, imageKind, markAiDataUrl, markAiImage, markedImageResponse, readXmp } from "@/lib/ai-mark";
import { recordAsset, reviewAsset } from "@/lib/assets";
import { keepBytes } from "@/lib/object-store";
import { startTestDb } from "./helpers";

// EU AI Act Art. 50 (docs/after-dark.md "AI marking, crisis notice and profile consent"): every generated picture
// carries IPTC's trainedAlgorithmicMedia in XMP. Read back two ways: our own reader, and sharp (libvips), which reads
// XMP as any other tool does.

const base = () => sharp({ create: { width: 40, height: 30, channels: 4, background: { r: 200, g: 50, b: 90, alpha: 0.5 } } });

async function samples(): Promise<Record<string, Buffer>> {
  return {
    jpeg: await base().jpeg().toBuffer(),
    "jpeg with exif": await base().jpeg().withExif({ IFD0: { Copyright: "test" } }).toBuffer(),
    png: await base().png().toBuffer(),
    "webp lossy (simple VP8)": await base().webp({ quality: 70 }).toBuffer(),
    "webp lossless (simple VP8L)": await base().webp({ lossless: true }).toBuffer(),
    "webp extended (VP8X with exif)": await base().webp().withExif({ IFD0: { Copyright: "test" } }).toBuffer(),
  };
}

describe("markAiImage", () => {
  it("writes the mark into JPEG, PNG and WebP, readable by sharp, without touching a pixel", async () => {
    for (const [name, bytes] of Object.entries(await samples())) {
      const marked = markAiImage(bytes);
      expect(marked.length, name).toBeGreaterThan(bytes.length);
      const xmp = readXmp(marked);
      expect(xmp, name).toContain(`Iptc4xmpExt:DigitalSourceType="${DIGITAL_SOURCE_TYPE}"`);
      expect(xmp, name).toContain(AI_CREDIT);
      const meta = await sharp(marked).metadata();
      expect(meta.xmp?.toString("utf8"), name).toContain("trainedAlgorithmicMedia");
      expect([meta.width, meta.height], name).toEqual([40, 30]);
      // Same picture: decoded pixels are identical (nothing was re-encoded).
      expect((await sharp(marked).raw().toBuffer()).equals(await sharp(bytes).raw().toBuffer()), name).toBe(true);
      expect(imageKind(marked), name).toBe(imageKind(bytes));
    }
  });

  it("keeps the Exif it found and is a no-op on bytes already marked", async () => {
    const s = await samples();
    for (const name of ["jpeg with exif", "webp extended (VP8X with exif)"]) {
      const marked = markAiImage(s[name]);
      expect((await sharp(marked).metadata()).exif, name).toBeDefined();
      expect(markAiImage(marked), name).toBe(marked);
    }
  });

  it("replaces an older XMP packet instead of adding a second one", async () => {
    const withXmp = await base().jpeg().withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta>').toBuffer();
    const marked = markAiImage(withXmp);
    expect(marked.toString("latin1").split("http://ns.adobe.com/xap/1.0/\0").length - 1).toBe(1);
    expect((await sharp(marked).metadata()).xmp?.toString()).toContain("trainedAlgorithmicMedia");
  });

  it("leaves anything else as it was, and never throws", () => {
    const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
    expect(markAiImage(gif)).toBe(gif);
    const junk = Buffer.from("not really a png");
    expect(markAiImage(junk)).toBe(junk);
    const truncated = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x40]), Buffer.alloc(4)]);
    expect(markAiImage(truncated)).toBe(truncated);
    expect(hasAiMark(junk)).toBe(false);
  });

  it("marks a data URL's picture and leaves other URLs alone", async () => {
    const png = (await samples()).png;
    const url = markAiDataUrl(`data:image/png;base64,${png.toString("base64")}`);
    expect(readXmp(Buffer.from(url.split(",")[1], "base64"))).toContain("trainedAlgorithmicMedia");
    expect(markAiDataUrl("/cast/house-nell-v3.webp")).toBe("/cast/house-nell-v3.webp");
    expect(markAiDataUrl("data:video/mp4;base64,AAAA")).toBe("data:video/mp4;base64,AAAA");
  });

  it("a share card keeps its headers and gains the mark and the AI headers", async () => {
    const png = (await samples()).png;
    const res = await markedImageResponse(new Response(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "public, max-age=60" } }));
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(res.headers.get("x-ai-generated")).toBe(AI_HEADERS["x-ai-generated"]);
    expect(readXmp(Buffer.from(await res.arrayBuffer()))).toContain(AI_CREDIT);
  });
});

describe("where generated pictures are stored and served", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
  });
  const serve = (id: string, query = "") => getAsset(new Request(`http://localhost:3000/api/assets/${id}${query}`), { params: Promise.resolve({ id }) });

  it("a generated portrait is stored with the mark (the ledger, lib/assets.ts)", async () => {
    const png = (await samples()).png;
    const id = await recordAsset(t.db, { character_id: "house-nell", kind: "portrait", source_type: "generated", source_model: "test-1", url: `data:image/png;base64,${png.toString("base64")}` });
    const url = (await t.db.query<{ url: string }>(`select url from character_assets where id = $1`, [id])).rows[0].url;
    expect(readXmp(Buffer.from(url.split(",")[1], "base64"))).toContain("trainedAlgorithmicMedia");
  });

  it("one stored before the mark is marked as it's served, small copies too, with the AI headers", async () => {
    const jpeg = (await samples()).jpeg;
    const id = await recordAsset(t.db, { character_id: "house-nell", kind: "portrait", source_type: "drawn", url: `data:image/jpeg;base64,${jpeg.toString("base64")}` });
    await reviewAsset(t.db, id, "approved");
    for (const q of ["", "?w=64"]) {
      const res = await serve(id, q);
      expect(res.status, q).toBe(200);
      expect(res.headers.get("x-ai-generated"), q).toBe("true");
      expect(res.headers.get("link"), q).toContain("/content-policy");
      expect((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).xmp?.toString(), q).toContain("trainedAlgorithmicMedia");
    }
  });

  it("After Dark's and the looks tiles' files are marked before they're kept (keepBytes); videos and voices are left as they are", async () => {
    const webp = (await samples())["webp lossy (simple VP8)"];
    const kept = await keepBytes("looks", "tile-1", webp, "image/webp");
    expect(readXmp(kept.data!)).toContain(AI_CREDIT);
    const video = Buffer.from("not really an mp4");
    expect((await keepBytes("after-dark", "clip-1", video, "video/mp4")).data).toBe(video);
  });
});

describe("the house cast and venue backdrops shipped in public/cast", () => {
  it("every file carries the mark (scripts/stamp-ai-marks.mjs), and still decodes", async () => {
    const dir = join(process.cwd(), "public", "cast");
    const files = readdirSync(dir).filter((f) => /\.(webp|png|jpe?g)$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const bytes = readFileSync(join(dir, f));
      expect(readXmp(bytes), f).toContain("trainedAlgorithmicMedia");
      expect((await sharp(bytes).metadata()).width, f).toBeGreaterThan(0);
    }
  });
});
