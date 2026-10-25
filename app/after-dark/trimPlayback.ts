import type { Trim } from "@/lib/adult/trim";

/**
 * What a player does with a trimmed video at time `t` (lib/adult/trim.ts): jump to the start, jump over a part cut out,
 * or stop at the end; null to carry on. Pure, for every player (the reel's, the Studio's, the gallery's).
 */
export function trimStep(trim: Trim | null | undefined, t: number): { seek: number } | { done: true } | null {
  if (!trim) return null;
  if (t < trim.start - 0.05) return { seek: trim.start };
  if (trim.end !== null && t >= trim.end) return { done: true };
  const cut = trim.cuts.find(([a, b]) => t >= a && t < b);
  return cut ? { seek: cut[1] } : null;
}

/** How long a trimmed video plays, of `duration`. */
export function keptLength(trim: Trim | null | undefined, duration: number): number {
  if (!trim || !Number.isFinite(duration)) return duration;
  const end = Math.min(trim.end ?? duration, duration);
  return Math.max(0, end - trim.start - trim.cuts.reduce((t, [a, b]) => t + Math.max(0, Math.min(b, end) - a), 0));
}
