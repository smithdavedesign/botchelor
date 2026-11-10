/**
 * Studio animations kept going (lib/adult/studio-keep-going.ts; David, 2026-11-09): each link animates the frame the one
 * before ended on, and a chain of them plays as one film in the Studio, up to CHAIN_MAX links, like a clip's chain
 * (lib/adult/clip-chains.ts). Pure, for the page; the server holds to the same rules from the shoots themselves.
 */
import { CHAIN_MAX, SEAMLESS_RUN_MAX } from "./clip-chains";

/** How one of their Studio animations came to be (StudioState.animation_links, by video id). */
export type AnimationLink = {
  /** The video it carries on from, the one before it in its chain; null for an animation of a picture. */
  from: string | null;
  /** Started straight from the frame the one before ended on (otherwise from that frame with their faces made fresh). */
  seamless: boolean;
  /** What the owner asked to happen next, when they said. */
  words: string | null;
};
export type AnimationLinks = Record<string, AnimationLink>;

/**
 * The chain up to a video, oldest first: the animation it began with, each link kept going from it, then this one. One
 * that's no longer there (deleted) ends the walk back: the chain starts after it.
 */
export function chainTo(id: string, links: AnimationLinks): string[] {
  const out = [id];
  for (let cur = links[id]?.from ?? null; cur && cur in links && !out.includes(cur) && out.length < CHAIN_MAX * 2; cur = links[cur].from) out.unshift(cur);
  return out;
}

/** How many links in a row, up to and including this video, started straight from the one before (seamless). */
export function seamlessRunTo(id: string, links: AnimationLinks): number {
  let n = 0;
  for (let cur: string | null = id; cur && links[cur]?.seamless && n < CHAIN_MAX; cur = links[cur].from) n++;
  return n;
}

/** Whether a video can be kept going: one of their Studio animations, with room left in its chain. */
export const canKeepGoing = (id: string, links: AnimationLinks): boolean => id in links && chainTo(id, links).length < CHAIN_MAX;

/** Whether the next link from this video starts from fresh faces whatever's picked: it would be the third seamless one in a row. */
export const nextStartsFresh = (id: string, links: AnimationLinks): boolean => seamlessRunTo(id, links) >= SEAMLESS_RUN_MAX;
