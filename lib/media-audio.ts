/**
 * Whether a clip has a sound track, read from its MP4 boxes (no ffmpeg): moov → trak → mdia → hdlr, whose handler type
 * is "soun" for sound and "vide" for picture. The showcase's 🔇 is shown only on a clip with sound (David, 2026-11-09:
 * the living portraits have none, so the switch did nothing on them).
 *
 * true: a sound track. false: an MP4 whose tracks are all something else. null: not an MP4 this can read (WebM, cut
 * short, not a clip): unknown, so a caller treats it as maybe having sound.
 */
export function hasAudioTrack(bytes: Uint8Array): boolean | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);

  /** Each box in [start, end): its type, where its body starts, where it ends. Stops at the first box that doesn't fit. */
  function* boxes(start: number, end: number): Generator<{ type: string; body: number; end: number }> {
    let at = start;
    while (at + 8 <= end) {
      let size = view.getUint32(at);
      let header = 8;
      if (size === 1) {
        if (at + 16 > end) return;
        const big = view.getBigUint64(at + 8);
        if (big > BigInt(end - at)) return;
        size = Number(big);
        header = 16;
      } else if (size === 0) {
        size = end - at;
      }
      if (size < header || at + size > end) return;
      yield { type: type(at + 4), body: at + header, end: at + size };
      at += size;
    }
  }
  const child = (start: number, end: number, want: string) => {
    for (const b of boxes(start, end)) if (b.type === want) return b;
    return null;
  };

  let moov = null;
  for (const b of boxes(0, bytes.byteLength)) if (b.type === "moov") moov = b;
  if (!moov) return null;
  let tracks = 0;
  for (const trak of boxes(moov.body, moov.end)) {
    if (trak.type !== "trak") continue;
    const mdia = child(trak.body, trak.end, "mdia");
    const hdlr = mdia && child(mdia.body, mdia.end, "hdlr");
    // hdlr: version and flags (4), pre_defined (4), then the handler type.
    if (!hdlr || hdlr.body + 12 > hdlr.end) continue;
    tracks++;
    if (type(hdlr.body + 8) === "soun") return true;
  }
  return tracks > 0 ? false : null;
}
