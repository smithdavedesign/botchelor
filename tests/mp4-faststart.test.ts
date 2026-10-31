import { describe, expect, it } from "vitest";
import { markAiVideo, readMp4Xmp } from "@/lib/ai-mark";
import { faststart, isFaststart } from "@/lib/mp4-faststart";

// Kept clips go in faststart (lib/mp4-faststart.ts; 2026-10-30: every one had its index last, and the reels waited).

const box = (type: string, ...body: Buffer[]) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.reduce((n, b) => n + b.length, 0), 0);
  head.write(type, 4, "latin1");
  return Buffer.concat([head, ...body]);
};
const offsets = (wide: boolean, offs: number[]) => {
  const b = Buffer.alloc(8 + offs.length * (wide ? 8 : 4));
  b.writeUInt32BE(offs.length, 4);
  offs.forEach((o, i) => (wide ? b.writeBigUInt64BE(BigInt(o), 8 + i * 8) : b.writeUInt32BE(o, 8 + i * 4)));
  return box(wide ? "co64" : "stco", b);
};
/** Where each track's chunk offsets point, as written in the file. */
const chunks = (b: Buffer): number[] => {
  const out: number[] = [];
  for (const type of ["stco", "co64"]) {
    let at = b.indexOf(type, 0, "latin1");
    while (at > 0) {
      const n = b.readUInt32BE(at + 8);
      for (let i = 0; i < n; i++) out.push(type === "co64" ? Number(b.readBigUInt64BE(at + 12 + i * 8)) : b.readUInt32BE(at + 12 + i * 4));
      at = b.indexOf(type, at + 4, "latin1");
    }
  }
  return out;
};

/** ftyp, mdat with two tracks' chunks ("AAAA", "BBBB", "CCCC"), then the moov: as the clips were kept. */
function clip() {
  const ftyp = box("ftyp", Buffer.from("isom\0\0\0\0isom", "latin1"));
  const mdat = box("mdat", Buffer.from("AAAABBBBCCCC", "latin1"));
  const at = ftyp.length + 8;
  const trak = (o: Buffer) => box("trak", box("tkhd", Buffer.alloc(12)), box("mdia", box("minf", box("stbl", box("stsd", Buffer.alloc(8)), o))));
  const moov = box("moov", box("mvhd", Buffer.alloc(20)), trak(offsets(false, [at, at + 8])), trak(offsets(true, [at + 4])));
  return Buffer.concat([ftyp, mdat, moov]);
}

describe("faststart", () => {
  it("moves the index before the media, and every chunk offset with it", () => {
    const before = clip();
    expect(isFaststart(before)).toBe(false);
    const after = faststart(before);
    expect(after.length).toBe(before.length);
    expect(isFaststart(after)).toBe(true);
    const read = (b: Buffer) => chunks(b).map((o) => b.subarray(o, o + 4).toString("latin1"));
    expect(read(before)).toEqual(["AAAA", "CCCC", "BBBB"]);
    expect(read(after)).toEqual(read(before));
    // Once is enough: faststart again changes nothing, and the AI mark still goes on the end.
    expect(faststart(after).equals(after)).toBe(true);
    const marked = markAiVideo(after);
    expect(readMp4Xmp(marked)).toContain("trainedAlgorithmicMedia");
    expect(isFaststart(marked)).toBe(true);
  });

  it("leaves what it can't or needn't move as it was", () => {
    const junk = Buffer.from("not a video at all");
    expect(faststart(junk)).toBe(junk);
    const torn = clip().subarray(0, clip().length - 5);
    expect(faststart(torn).equals(torn)).toBe(true);
    const fragmented = Buffer.concat([clip(), box("moof", Buffer.alloc(8))]);
    expect(faststart(fragmented).equals(fragmented)).toBe(true);
  });
});
