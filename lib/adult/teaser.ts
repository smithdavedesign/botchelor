/**
 * After Dark's teaser in the show (David, 2026-10-18: "blur it: it makes people want to pay"). A pair with After Dark
 * scenes gets a card on its couple page and on its house characters' pages: the scene's length, under a blur, and the
 * way to unlock it. The real lines NEVER leave the server for someone After Dark isn't open to: the blurred text is
 * neutral filler, because a CSS blur hides nothing from view-source. Only the season's own scenes count (ones an admin
 * wrote): one person's private scenes are never even hinted at to anyone else.
 */
import type { Db } from "../db";
import { pairKey } from "../relationships";

export type Teaser = { a: { id: string; name: string }; b: { id: string; name: string }; lines: number; path: string };

/** The season's After Dark scenes involving these characters (one pair's, or anyone with this one), longest first. */
export async function teasersFor(db: Db, opts: { pair?: [string, string]; character?: string }, limit = 3): Promise<Teaser[]> {
  const pair = opts.pair ? pairKey(...opts.pair) : null;
  const { rows } = await db.query<{ a: string; b: string; an: string; bn: string; lines: number }>(
    `select s.character_a as a, s.character_b as b, ca.name as an, cb.name as bn, max(jsonb_array_length(s.lines))::int as lines
       from adult_scenes s
       join admins ad on ad.user_id = s.owner_id
       join characters ca on ca.id = s.character_a
       join characters cb on cb.id = s.character_b
      where jsonb_array_length(s.lines) > 0
        and ($1::text is null or (s.character_a = $1 and s.character_b = $2))
        and ($3::text is null or $3 in (s.character_a, s.character_b))
      group by s.character_a, s.character_b, ca.name, cb.name
      order by lines desc
      limit $4`,
    [pair?.[0] ?? null, pair?.[1] ?? null, opts.character ?? null, limit],
  );
  return rows.map((r) => ({ a: { id: r.a, name: r.an }, b: { id: r.b, name: r.bn }, lines: r.lines, path: `/after-dark/${r.a}/${r.b}` }));
}

const FILLER = [
  "The night kept going long after the cameras stopped rolling.",
  "Neither of them was in any hurry to say goodnight.",
  "What happened next stays between the two of them.",
  "One look was all it took to change the plan.",
  "The door closed, and the conversation got a lot quieter.",
  "By morning, neither of them could stop smiling.",
];

/** Neutral filler for the blur: never the scene's real words. */
export function fillerLines(n: number, seed: string): string[] {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return Array.from({ length: n }, (_, i) => FILLER[(h + i * 7) % FILLER.length]);
}
