/**
 * How the Constellation colours a star (ConstellationApp's "Colour by"): by the character's own avatar hue, by what they
 * are (lib/kinds.ts), or by the cluster they date in (lib/graph.ts communities). Pure, shared by the canvas and the key.
 */
import { KIND_IDS, type KindId } from "@/lib/kinds";

export type ColorBy = "character" | "kind" | "community";

/** One hue per kind, spread evenly round the wheel so neighbours on the legend never blur together. */
export const kindHue = (kind: KindId): number => (KIND_IDS.indexOf(kind) * 30 + 12) % 360;

/**
 * The clusters' colours, biggest cluster first: the dataviz skill's validated categorical palette, in its dark-surface
 * steps (the sky is dark in both themes) and its fixed order. On the sky (#1b0f20 light theme, #0e0712 dark) every
 * slot clears 3:1 contrast and the lightness and chroma bands, adjacent slots stay apart under protan and deutan
 * simulation (worst ΔE 8.4) and for full colour vision (worst 19.3). Never generated past the eighth: a smaller cluster
 * folds into the neutral grey and the key counts it ("+3 smaller"), and the panel names a star's cluster in words.
 */
export const CLUSTER_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"] as const;

/** A cluster's colour, or null (the neutral grey) for one past the palette. */
export const communityColor = (community: number): string | null => CLUSTER_COLORS[community] ?? null;

/** A darker step of a #rrggbb colour, for the lower end of a star's gradient. */
export function shade(hex: string, by = 0.28): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) * (1 - by));
  return `#${[ch(16), ch(8), ch(0)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** A star's fill under `by`: "own" (its avatar palette), a hue (a kind), a fixed colour (a cluster), or null for the grey. */
export type StarColor = "own" | { hue: number } | { color: string } | null;

/** What colours a star under `by`; null for the neutral grey (not said, in orbit, a small cluster, or private). */
export function starColor(n: { kind: KindId | null; community: number | null; private: boolean }, by: ColorBy): StarColor {
  if (n.private) return null;
  if (by === "kind") return n.kind ? { hue: kindHue(n.kind) } : null;
  if (by === "community") {
    const color = n.community === null ? null : communityColor(n.community);
    return color ? { color } : null;
  }
  return "own";
}
