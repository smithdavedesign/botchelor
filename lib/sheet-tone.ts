/**
 * How a character sounds in a templated line, read off its PUBLIC sheet only (its traits and how it talks): the same
 * reading the engine's baseline uses (lib/temperament.ts sheetSignals), turned into one of four tones. Used where the
 * show writes a short line for a character without a model call: the photo it sends from a date (lib/date-photo.ts)
 * and a gift's note and reply (lib/character-gifts.ts). Never the private soul or what its dates taught it: a line
 * anyone may read must not give either away. Pure.
 */
import { UNREMARKABLE_SIGNALS } from "./engine";
import { sheetSignals } from "./temperament";

export const TONES = ["warm", "wry", "reserved", "plain"] as const;
export type Tone = (typeof TONES)[number];

/** How far a sheet has to lean before it counts (one voice word moves an axis 0.1, one trait 0.2). */
const LEAN = 0.1;

export type ToneSheet = { traits: readonly string[]; voice?: string | null };

/**
 * warm: its words say warm. wry: they say funny. reserved: they say guarded, or cold. plain: none of those. When a
 * sheet leans more than one way the strongest wins, and a tie goes wry, then warm, then reserved.
 */
export function toneOf(sheet: ToneSheet): Tone {
  const s = sheetSignals({ traits: [...sheet.traits], voice: sheet.voice ?? null });
  const humor = s.humor - UNREMARKABLE_SIGNALS.humor;
  const warmth = s.warmth - UNREMARKABLE_SIGNALS.warmth;
  const reserve = Math.max(s.guardedness - UNREMARKABLE_SIGNALS.guardedness, -warmth);
  const best = Math.max(humor, warmth, reserve);
  if (best < LEAN - 1e-9) return "plain";
  return best === humor ? "wry" : best === warmth ? "warm" : "reserved";
}
