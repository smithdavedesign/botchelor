/**
 * An MP4 made "faststart": its index (`moov`) moved before its media (`mdat`), so a browser can start playing it from the
 * first bytes instead of fetching the file's end first (2026-10-30: every kept clip had its moov last, and the reels on a
 * phone waited on each one). The chunk offsets in the index (`stco`, `co64`) move by the index's size. What qt-faststart
 * and ffmpeg's `-movflags +faststart` do, without a binary (an ffmpeg one traced into every route broke a deploy, #927).
 *
 * Never throws: bytes that aren't an MP4, are faststart already, are fragmented, or don't parse come back as they were.
 */

type Box = { start: number; type: string; body: number; end: number };

/** The boxes in b[from, to): where each starts, its type, where its body starts and where it ends. Null when they don't parse. */
function boxes(b: Buffer, from: number, to: number): Box[] | null {
  const out: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    let size = b.readUInt32BE(at);
    let body = at + 8;
    if (size === 1) {
      if (at + 16 > to) return null;
      size = Number(b.readBigUInt64BE(at + 8));
      body = at + 16;
    } else if (size === 0) size = to - at;
    if (size < body - at || at + size > to) return null;
    out.push({ start: at, type: b.subarray(at + 4, at + 8).toString("latin1"), body, end: at + size });
    at += size;
  }
  return at === to ? out : null;
}

/** The boxes on the way to a track's sample tables: the only ones with chunk offsets inside. */
const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl"]);

/** Moves each chunk offset in this (copied) moov that `shift` says to; false when one won't fit or a box doesn't parse. */
function patch(m: Buffer, from: number, to: number, shift: (off: number) => number): boolean {
  const kids = boxes(m, from, to);
  if (!kids) return false;
  for (const k of kids) {
    if (CONTAINERS.has(k.type)) {
      if (!patch(m, k.body, k.end, shift)) return false;
    } else if (k.type === "stco" || k.type === "co64") {
      const wide = k.type === "co64";
      if (k.body + 8 > k.end) return false;
      const n = m.readUInt32BE(k.body + 4);
      if (k.body + 8 + n * (wide ? 8 : 4) > k.end) return false;
      for (let i = 0; i < n; i++) {
        const at = k.body + 8 + i * (wide ? 8 : 4);
        const off = shift(wide ? Number(m.readBigUInt64BE(at)) : m.readUInt32BE(at));
        if (wide) m.writeBigUInt64BE(BigInt(off), at);
        else if (off > 0xffffffff) return false;
        else m.writeUInt32BE(off, at);
      }
    }
  }
  return true;
}

export function faststart(input: Buffer | Uint8Array): Buffer {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  try {
    if (b.length < 12 || b.subarray(4, 8).toString("latin1") !== "ftyp") return b;
    const top = boxes(b, 0, b.length);
    if (!top || top.some((x) => x.type === "moof")) return b;
    const moov = top.find((x) => x.type === "moov");
    const mdat = top.find((x) => x.type === "mdat");
    if (!moov || !mdat || moov.start < mdat.start) return b;
    // [head][mdat…][moov][tail] → [head][moov][mdat…][tail]: only what was between the first mdat and the moov moves.
    const size = moov.end - moov.start;
    const index = Buffer.from(b.subarray(moov.start, moov.end));
    if (!patch(index, moov.body - moov.start, size, (off) => (off >= mdat.start && off < moov.start ? off + size : off))) return b;
    return Buffer.concat([b.subarray(0, mdat.start), index, b.subarray(mdat.start, moov.start), b.subarray(moov.end)]);
  } catch {
    return b;
  }
}

/** Whether an MP4's index comes before its media (or there's nothing to move). For tests and the backfill. */
export function isFaststart(input: Buffer | Uint8Array): boolean {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const top = b.length >= 12 ? boxes(b, 0, b.length) : null;
  const moov = top?.find((x) => x.type === "moov");
  const mdat = top?.find((x) => x.type === "mdat");
  return !moov || !mdat || moov.start < mdat.start;
}
