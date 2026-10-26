/**
 * Native sizes (the creator suite; David, 2026-10-26): a picture drawn in the shape it's posted in, not cut down
 * afterwards. Pure, so the page names them. A model is asked for the format's ratio when it takes it, else the nearest
 * it does, and the picture is then cut to the format (lib/media-tools/image.ts fitRatio), so every provider gives the
 * same shape. Ratios each takes (2026-10-26): Venice's multi-edit 1:1, 3:2, 16:9, 21:9, 9:16, 2:3, 3:4, 4:5 (Seedream
 * all but 4:5); Replicate's Qwen edit 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3.
 */

export const FORMATS = [
  { id: "portrait", label: "Portrait", ratio: "3:4", hint: "as the Studio always made them" },
  { id: "story", label: "Story", ratio: "9:16", hint: "Reels, TikTok, Stories" },
  { id: "feed", label: "Feed", ratio: "4:5", hint: "Instagram's feed" },
  { id: "square", label: "Square", ratio: "1:1", hint: "anywhere" },
  { id: "wide", label: "Wide", ratio: "16:9", hint: "X, YouTube, a desktop" },
] as const;
export type FormatId = (typeof FORMATS)[number]["id"];
export type Ratio = (typeof FORMATS)[number]["ratio"];
export const FORMAT_IDS: FormatId[] = FORMATS.map((f) => f.id);
export const isFormat = (v: unknown): v is FormatId => typeof v === "string" && (FORMAT_IDS as string[]).includes(v);
export const DEFAULT_FORMAT: FormatId = "portrait";

/** A format's ratio ("3:4"); the portrait one for anything else. */
export function ratioOf(format: string | null | undefined): Ratio {
  return (FORMATS.find((f) => f.id === format) ?? FORMATS[0]).ratio;
}

/** A ratio as a number, width over height ("9:16" → 0.5625). */
export function ratioValue(ratio: string): number {
  const [w, h] = ratio.split(":").map(Number);
  return w > 0 && h > 0 ? w / h : 3 / 4;
}

const VENICE_EDIT = ["1:1", "3:2", "16:9", "21:9", "9:16", "2:3", "3:4", "4:5"];
const SEEDREAM_EDIT = ["1:1", "3:2", "16:9", "21:9", "9:16", "2:3", "3:4"];
const REPLICATE_EDIT = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];

/** The ratios a model is asked in, by who runs it and its id. */
export function ratiosFor(provider: "venice" | "replicate", model: string): readonly string[] {
  if (provider === "replicate") return REPLICATE_EDIT;
  return /seedream/i.test(model) ? SEEDREAM_EDIT : VENICE_EDIT;
}

/** What a model is asked for: the ratio itself when it takes it, else the nearest one it does (cut to the ratio after). */
export function askRatio(ratio: string, supported: readonly string[]): string {
  if (supported.includes(ratio)) return ratio;
  const want = Math.log(ratioValue(ratio));
  return [...supported].sort((a, b) => Math.abs(Math.log(ratioValue(a)) - want) - Math.abs(Math.log(ratioValue(b)) - want))[0] ?? "3:4";
}

/** A text-to-image model's width and height for a ratio (multiples of 16, about a megapixel), for the ones sized that way. */
export function sizeFor(ratio: string): { width: number; height: number } {
  const SIZES: Record<string, { width: number; height: number }> = {
    "3:4": { width: 832, height: 1104 },
    "9:16": { width: 720, height: 1280 },
    "4:5": { width: 880, height: 1104 },
    "1:1": { width: 1024, height: 1024 },
    "16:9": { width: 1280, height: 720 },
  };
  return SIZES[ratio] ?? SIZES["3:4"];
}
