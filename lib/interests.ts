/**
 * One spelling per interest (data plan Tier 2): "Rock climbing", "bouldering" and "Bouldering" are the same hobby when
 * two characters' interests are compared (lib/dating.ts rankFor). Stored hobbies keep their owner's own spelling; this
 * only decides what counts as shared. Pure; no stemming (it would merge "dancing" and "dance" but also wreck names).
 */

/** Different words for the same pastime, mapped to one. Small on purpose: only clear synonyms, never "related" ones. */
const SYNONYMS: Record<string, string> = {
  bouldering: "climbing",
  "rock climbing": "climbing",
  boardgames: "board games",
  "tabletop games": "board games",
  tabletop: "board games",
  astronomy: "stargazing",
  "star gazing": "stargazing",
  "thrift shopping": "thrifting",
  "vintage shopping": "thrifting",
  rollerskating: "roller skating",
  movies: "films",
  cinema: "films",
  "going to the movies": "films",
  jogging: "running",
  gaming: "video games",
  videogames: "video games",
  "video gaming": "video games",
  "bread baking": "baking",
  "hiking trails": "hiking",
  "hill walking": "hiking",
  "playing guitar": "guitar",
};

/** The canonical form of an interest for comparing: lowercase, accents and hyphens folded, synonyms merged. */
export function canonInterest(raw: string): string {
  const s = raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return SYNONYMS[s] ?? SYNONYMS[s.replace(/ /g, "")] ?? s;
}

/**
 * The pastimes two characters share, once each: `theirs` that `mine` also has in any spelling, deduped by canonical
 * form and kept in their first spelling. "Bouldering" and "Rock climbing" on one side and "climbing" on the other are
 * one shared hobby, not two (lib/dating.ts rankFor scores and words each one once).
 */
export function sharedInterests(mine: readonly string[], theirs: readonly string[]): string[] {
  const have = new Set(mine.map(canonInterest));
  const seen = new Set<string>();
  return theirs.filter((h) => {
    const c = canonInterest(h);
    if (!have.has(c) || seen.has(c)) return false;
    seen.add(c);
    return true;
  });
}
