/**
 * Who already knew whom before the show (PRD styles-and-storylines phase 4). A season's two newcomers arrive as a pair:
 * rivals, exes, a fake couple or best friends. One of them also knows someone returning. Dates make the rest of the
 * graph (lib/relationships.ts), which keeps only pairs with dates between them. A link is the backstory the dates start
 * from, so it has its own table and never lapses.
 *
 * Both sides of a linked pair's date know the link (lib/simulation.ts), from the first date on. The engine never reads
 * it: like the story state, it's flavour, and the ending stays the engine's.
 */
import type { Db } from "./db";
import { pairKey } from "./relationships";
import { socialHook } from "./social/hook";

/** The kinds of link: the show's roleplay setups (lib/tags.ts), so an arc finds roleplays tagged for its pair. */
export const LINK_KINDS = ["rivals", "second_chance", "fake_dating", "friends_to_more"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/** Each kind in words: the pair ("exes"), one side ("ex"), and what the newcomers' writer is told. */
export const LINK_WORDS: Record<LinkKind, { pair: string; one: string; brief: string }> = {
  rivals: { pair: "rivals", one: "rival", brief: "rivals: they compete at the same thing, and neither has ever let the other win quietly" },
  second_chance: { pair: "exes", one: "ex", brief: "exes: they dated once, it ended, and something was left unsaid" },
  fake_dating: { pair: "a fake couple", one: "fake partner", brief: "a fake couple: they once pretended to date, for a reason that made sense at the time" },
  friends_to_more: { pair: "best friends", one: "best friend", brief: "best friends: years of friendship, and one of them has wondered about more" },
};

export const isLinkKind = (k: unknown): k is LinkKind => (LINK_KINDS as readonly unknown[]).includes(k);

/** A link between two characters, lower id first. `source`: who wrote it ("season_gen", or "admin"). */
export type CharacterLink = { lo: string; hi: string; kind: LinkKind; story: string; source: string };

type Row = { character_a: string; character_b: string; kind: string; story: string; source: string };
const linkOf = (r: Row): CharacterLink | null => (isLinkKind(r.kind) ? { lo: r.character_a, hi: r.character_b, kind: r.kind, story: r.story, source: r.source } : null);

/** Stores the link between two characters (one a pair: a later one replaces it). */
export async function addLink(db: Db, x: string, y: string, kind: LinkKind, story: string, source = "season_gen"): Promise<void> {
  if (x === y) return;
  const [lo, hi] = pairKey(x, y);
  await db.query(
    `insert into character_links (character_a, character_b, kind, story, source) values ($1, $2, $3, $4, $5)
     on conflict (character_a, character_b) do update set kind = excluded.kind, story = excluded.story, source = excluded.source, created_at = now()`,
    [lo, hi, kind, story.trim().slice(0, 240), source],
  );
  // The social network's backstory tie (lib/social/derive.ts LINK_TIES): rivals, exes, a fake couple, best friends.
  await socialHook("link", (d, deadline) => d.deriveLinkPair(db, lo, hi, { deadline }), { key: `link:${lo}|${hi}` });
}

/** The link between two characters, or null. */
export async function linkBetween(db: Db, x: string, y: string): Promise<CharacterLink | null> {
  const [lo, hi] = pairKey(x, y);
  const r = (await db.query<Row>(`select character_a, character_b, kind, story, source from character_links where character_a = $1 and character_b = $2`, [lo, hi])).rows[0];
  return r ? linkOf(r) : null;
}

/** Every link that touches any of these characters. */
export async function linksOf(db: Db, ids: readonly string[]): Promise<CharacterLink[]> {
  if (!ids.length) return [];
  const { rows } = await db.query<Row>(
    `select character_a, character_b, kind, story, source from character_links where character_a = any($1) or character_b = any($1) order by created_at, character_a, character_b`,
    [[...ids]],
  );
  return rows.flatMap((r) => linkOf(r) ?? []);
}

/**
 * The best friends (friends_to_more) among these characters, both of them in the list: a mixer's wingman duos
 * (lib/mixer-room.ts). Lower id first, each person in one duo at most.
 */
export async function bestFriendsAmong(db: Db, ids: readonly string[]): Promise<[string, string][]> {
  const set = new Set(ids);
  const seen = new Set<string>();
  const out: [string, string][] = [];
  for (const l of await linksOf(db, ids)) {
    if (l.kind !== "friends_to_more" || !set.has(l.lo) || !set.has(l.hi) || seen.has(l.lo) || seen.has(l.hi)) continue;
    out.push([l.lo, l.hi]);
    seen.add(l.lo).add(l.hi);
  }
  return out;
}

/** What the two of them are, after "X and Y": the words every line about a link uses. */
export const LINK_SAID: Record<LinkKind, string> = {
  rivals: "are old rivals",
  second_chance: "are exes",
  fake_dating: "once pretended to be a couple",
  friends_to_more: "are best friends",
};

const first = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

/** The link as one side of their date hears it: who they were to each other before the show, and the story. */
export function linkContext(link: CharacterLink | null, otherName: string): { before_the_show: string } | null {
  if (!link) return null;
  return { before_the_show: `You and ${first(otherName)} ${LINK_SAID[link.kind]}: ${link.story}` };
}

/** What happened between them, after "Long before the show, X and Y": the arcs' first Previously line. */
export const LINK_PAST: Record<LinkKind, string> = {
  rivals: "became rivals",
  second_chance: "were a couple, until it ended",
  fake_dating: "pretended to be a couple",
  friends_to_more: "became best friends",
};

/** The link in the third person, for the date's director and narrator: "Juniper and Rafe knew each other before the show: …". */
export function linkLine(link: CharacterLink | null, aName: string, bName: string): string | null {
  if (!link) return null;
  return `${first(aName)} and ${first(bName)} knew each other before the show: they ${LINK_SAID[link.kind]}. ${link.story}`;
}
