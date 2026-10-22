/**
 * How the Constellation colours a star (ConstellationApp's "Colour by"): by the character's own avatar hue, by what they
 * are (lib/kinds.ts), or by the cluster they date in (lib/graph.ts communities). Pure, shared by the canvas and the legend.
 */
import { KIND_IDS, type KindId } from "@/lib/kinds";

export type ColorBy = "character" | "kind" | "community";

/** One hue per kind, spread evenly round the wheel so neighbours on the legend never blur together. */
export const kindHue = (kind: KindId): number => (KIND_IDS.indexOf(kind) * 30 + 12) % 360;

/** Clusters by the golden angle: each new one lands far from the ones before it. */
export const communityHue = (community: number): number => Math.round((community * 137.508 + 300) % 360) || 360;

/** The hue a star takes under `by`, or null for the neutral grey (not said, in orbit, or private). */
export function starHue(n: { hue: number | null; kind: KindId | null; community: number | null; private: boolean }, by: ColorBy): number | null | "own" {
  if (n.private) return null;
  if (by === "kind") return n.kind ? kindHue(n.kind) : null;
  if (by === "community") return n.community === null ? null : communityHue(n.community);
  return "own";
}
