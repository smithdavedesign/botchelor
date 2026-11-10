/**
 * Just enough WAV to give a voice line the length of its shot (lib/adult/reels.ts, 2026-11-09): a speech-to-video model
 * (Wan 2.2 S2V) makes a video exactly as long as the audio it's given, so a two-second line is padded with silence to
 * the shot's length. PCM or float WAV only (Kokoro's); anything else is read as not a WAV.
 */

type WavLayout = { rate: number; blockAlign: number; dataStart: number; dataSize: number };

function layout(bytes: Buffer): WavLayout | null {
  if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") return null;
  let rate = 0;
  let blockAlign = 0;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = bytes.toString("ascii", at, at + 4);
    const size = bytes.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === "fmt " && body + 16 <= bytes.length) {
      const format = bytes.readUInt16LE(body);
      // 1 PCM, 3 float, 0xFFFE extensible (still PCM or float underneath).
      if (format !== 1 && format !== 3 && format !== 0xfffe) return null;
      rate = bytes.readUInt32LE(body + 4);
      blockAlign = bytes.readUInt16LE(body + 12);
    } else if (id === "data") {
      if (!rate || !blockAlign) return null;
      // A streamed WAV can say 0 or 0xFFFFFFFF: its data runs to the end.
      const dataSize = size === 0 || size === 0xffffffff || body + size > bytes.length ? bytes.length - body : size;
      return { rate, blockAlign, dataStart: body, dataSize };
    }
    at = body + size + (size % 2);
  }
  return null;
}

/** How long a WAV plays, in seconds; null when it isn't one this can read. */
export function wavSeconds(bytes: Buffer): number | null {
  const w = layout(bytes);
  return w ? w.dataSize / w.blockAlign / w.rate : null;
}

/** The WAV with silence after its sound up to `seconds` (as it is when it's already that long, or isn't a WAV). */
export function padWav(bytes: Buffer, seconds: number): Buffer {
  const w = layout(bytes);
  if (!w) return bytes;
  const want = Math.ceil(seconds * w.rate) * w.blockAlign;
  const add = want - w.dataSize;
  if (add <= 0) return bytes;
  const end = w.dataStart + w.dataSize;
  const out = Buffer.concat([bytes.subarray(0, end), Buffer.alloc(add), bytes.subarray(end)]);
  out.writeUInt32LE(w.dataSize + add, w.dataStart - 4);
  out.writeUInt32LE(out.length - 8, 4);
  return out;
}
