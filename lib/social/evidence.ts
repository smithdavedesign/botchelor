/**
 * Where a tie's evidence is on the site (lib/social/types.ts EvidenceRef, `<what>:<id>`): the aired date, the house
 * scene, the group night, the backstory, the season's cast. Pure and browser-safe, so "X's world" and the pair panel
 * link what made a tie the same way. A story beat has no page of its own (home and /watch showed it that day), so it's
 * words without a link; so is anything this doesn't know.
 */
import { seasonPath } from "../season-ref";
import type { Evidence } from "./types";

export type EvidenceLink = { href: string | null; label: string; at: string };

const SAFE = /^[A-Za-z0-9_.-]{1,64}$/;

/** One ref as a link and its words; null for a ref that isn't evidence of anything a page shows. */
export function evidenceLink(ref: string, at: string, o: { closedSeasons?: ReadonlySet<string> } = {}): EvidenceLink | null {
  const i = ref.indexOf(":");
  if (i <= 0) return null;
  const what = ref.slice(0, i);
  const rest = ref.slice(i + 1);
  switch (what) {
    case "episode":
      return SAFE.test(rest) ? { href: `/episodes/${rest}`, label: "the date", at } : null;
    case "scene": {
      // A told line's ref names its line too (scene:<id>#<n>): the scene is the page.
      const id = rest.split("#")[0];
      return SAFE.test(id) ? { href: `/house?scene=${id}#scene-${id}`, label: "the scene", at } : null;
    }
    case "night":
      return SAFE.test(rest) ? { href: `/mixers/${rest}`, label: "the night", at } : null;
    case "season":
      // A season has its page once it's closed (app/seasons/[slug]); before then, the words only. "The season's cast",
      // not "the season": what made them housemates is being cast together (2026-11-22 audit: "the season" said nothing).
      return { href: o.closedSeasons?.has(rest) ? seasonPath(rest) : null, label: "the season's cast", at };
    case "link": {
      const [lo, hi] = rest.split(":");
      return SAFE.test(lo ?? "") && SAFE.test(hi ?? "") ? { href: `/characters/${lo}`, label: "their backstory", at } : null;
    }
    case "beat":
      return { href: null, label: "the show's story", at };
    default:
      return null;
  }
}

/**
 * A tie's evidence as links, newest first, one a page (a scene's many told lines are one scene) and at most `limit`.
 */
export function evidenceLinks(evidence: readonly Evidence[], o: { limit?: number; closedSeasons?: ReadonlySet<string> } = {}): EvidenceLink[] {
  const limit = o.limit ?? 3;
  const out: EvidenceLink[] = [];
  const seen = new Set<string>();
  for (const e of [...evidence].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))) {
    const link = evidenceLink(e.ref, e.at, o);
    if (!link) continue;
    const key = link.href ?? `${link.label}:${e.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(link);
    if (out.length >= limit) break;
  }
  return out;
}
