/**
 * Small copies of pictures, made a few at a time. A browser opening /graph asked for 56 portrait thumbs at once, each
 * decoded from a multi-MB PNG on the request, and the show's one replica stalled for minutes (the audit, 2026-10-31);
 * the assets route and After Dark's media route both resize through here and keep what they made.
 */
const RESIZES_AT_ONCE = 3;
let resizing = 0;
const waiting: (() => void)[] = [];
export async function withResizeSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (resizing >= RESIZES_AT_ONCE) await new Promise<void>((resolve) => waiting.push(resolve));
  resizing++;
  try {
    return await fn();
  } finally {
    resizing--;
    waiting.shift()?.();
  }
}

/**
 * A WebP copy at `width` (a square crop with `square`, else the picture's own shape), or null: sharp (installed with
 * Next) unavailable or failing. A failure never breaks the picture, it just sends the full one.
 */
export async function resizedWebp(bytes: Buffer, width: number, opts: { square?: boolean } = {}): Promise<Buffer | null> {
  try {
    const { default: sharp } = await import("sharp");
    const size = opts.square ? { width, height: width, fit: "cover" as const, withoutEnlargement: true } : { width, withoutEnlargement: true };
    return await withResizeSlot(() => sharp(bytes).resize(size).webp({ quality: 80 }).toBuffer());
  } catch {
    return null;
  }
}

/** The widths a route hands out (anything asked for rounds up to the next; more than the last gets the last). */
export const THUMB_WIDTHS = [320, 640, 960] as const;
export function thumbWidth(asked: string | null): number | null {
  const n = Number(asked);
  if (!asked || !Number.isFinite(n) || n <= 0) return null;
  return THUMB_WIDTHS.find((w) => w >= n) ?? THUMB_WIDTHS[THUMB_WIDTHS.length - 1];
}
