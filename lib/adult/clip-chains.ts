/**
 * Clips as the videos list shows them (app/after-dark/[a]/[b]/Reels.tsx): a clip and the ones kept going from it are one
 * chain, played as one film. Pure, for the page (lib/adult/clips.ts makes them).
 */
import type { Reel } from "./reels";

/** Shots a clip can be kept going to, in all (about 30 s): Keep going stops being offered there. */
export const CHAIN_MAX = 6;

/**
 * The pair's clips as chains, each from its first clip on, newest chain first. A clip carries on with the first clip
 * kept going from it that came through (or is still being made); one that failed shows at the chain's end only while
 * nothing has been kept going from there since, and is dropped once it's been tried again. A second clip kept going
 * from the same one (two tabs, say) starts a chain of its own.
 */
export function clipChains(clips: readonly Reel[]): Reel[][] {
  const oldest = [...clips].sort((p, q) => p.created_at.localeCompare(q.created_at));
  const ids = new Set(oldest.map((c) => c.id));
  const children = new Map<string, Reel[]>();
  for (const c of oldest) {
    const from = c.clip?.from;
    if (from && ids.has(from)) children.set(from, [...(children.get(from) ?? []), c]);
  }
  const next = new Map<string, Reel>();
  const dropped = new Set<string>();
  for (const [from, kids] of children) {
    const alive = kids.filter((k) => k.status !== "failed");
    const failed = kids.filter((k) => k.status === "failed");
    if (alive.length) {
      next.set(from, alive[0]);
      failed.forEach((k) => dropped.add(k.id));
    } else {
      // Only failures: the newest one shows (why it didn't come through), the older tries go.
      next.set(from, failed[failed.length - 1]);
      failed.slice(0, -1).forEach((k) => dropped.add(k.id));
    }
  }
  const carried = new Set([...next.values()].map((c) => c.id));
  const chains = oldest
    .filter((c) => !carried.has(c.id) && !dropped.has(c.id))
    .map((root) => {
      const chain = [root];
      for (let cur = next.get(root.id); cur && chain.length < 50; cur = next.get(cur.id)) chain.push(cur);
      return chain;
    });
  return chains.sort((p, q) => q[q.length - 1].created_at.localeCompare(p[p.length - 1].created_at));
}

/**
 * The clip a chain keeps going from: its last one that's in with a keyframe (past one at the end that failed, so it can
 * be tried again), while the chain has room. Null otherwise, or while its last is still being made.
 */
export function keepGoingFrom(chain: readonly Reel[]): Reel | null {
  const done = chain.filter((c) => c.status !== "failed");
  const last = done[done.length - 1];
  if (!last || last.status !== "ready" || done.length >= CHAIN_MAX) return null;
  if (chain[chain.length - 1].status === "making") return null;
  return last.shots.some((s) => s.status === "ready" && s.frame_id) ? last : null;
}
