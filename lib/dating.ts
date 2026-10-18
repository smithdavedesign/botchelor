/**
 * Searching for love: who a character can be set up with, how to find them, and who the agents are.
 *
 * Shared by the MCP tools (lib/mcp.ts), the web builder's "open to dates" gallery and the /agents page.
 * Only public persona leaves this file: never the dealbreaker (it's the quiz answer), never a soul, never an
 * owner. "Can ask out" means a house character (always available) or an OC whose creator opened it to dates;
 * every other OC can still turn up on a blind date (app/api/episodes/route.ts).
 *
 * Compatibility here is a hint for who to ask. It never touches the date: the engine decides how a date
 * ends from the two characters on the night.
 */
import { contentWords } from "./quality";
import { portraitPathSql } from "./assets";
import { audienceAllows, type Audience } from "./audience";
import { takenSql } from "./partners";
import type { Db } from "./db";
import { extrasText, type CharacterExtras } from "./extras";
import { isOnSeasonCast, seasonCastIds } from "./season-cast";
import { swipeGateOn } from "./swipe-gate";
import { compatibility, loadTraitStats, MIN_EVIDENCE, publicDegrees } from "./compatibility";
import { relationshipsOf, STAGE_LABELS, viewRelationship, type Stage } from "./relationships";

export type MadeBy = "house" | "agent" | "human";

export type DatingProfile = {
  id: string;
  name: string;
  age: number;
  pronouns: string | null;
  bio: string;
  traits: string[];
  want: string;
  appearance: string | null;
  voice: string | null;
  hue: number | null;
  /** Their approved generated portrait's path (/api/assets/<id>), or null. */
  portrait: string | null;
  made_by: MadeBy;
  open_to_dates: boolean;
  /** Who may ask them out when they're open to dates: everyone, only people's characters, or only agents' (lib/audience.ts). */
  open_to: Audience;
  /**
   * True when anyone can name them as a date's partner: this season's house cast (or, with the swipe gate off,
   * a character that's open to dates). Behind the gate (lib/swipe-gate.ts), someone else's character takes a
   * match first, or a date together before.
   */
  can_ask_out: boolean;
  /** Public, aired dates so far. */
  dates: number;
  url: string;
  /** Optional details (lib/extras.ts): occupation, hometown, style, hobbies, quirks, profile prompts. */
  extras: CharacterExtras;
};

export type ProfileRow = {
  id: string;
  name: string;
  age: number;
  pronouns: string | null;
  bio: string;
  traits: string[];
  want: string;
  appearance: string | null;
  voice: string | null;
  avatar_hue: number | null;
  portrait: string | null;
  is_house: boolean;
  created_via: string;
  open_to_dates: boolean;
  open_audience: Audience;
  dates: number;
  extras: CharacterExtras | null;
};

/** The public columns of a character (`c`) as a ProfileRow. */
export const PUBLIC_COLUMNS = `c.id, c.name, c.age, c.pronouns, c.bio, c.traits, c.want, c.appearance, c.voice, c.avatar_hue,
  ${portraitPathSql("c")} as portrait, c.is_house, c.created_via, c.open_to_dates, c.open_audience, c.extras,
  (select count(*)::int from episodes e
     where (e.character_a = c.id or e.character_b = c.id) and e.revealed_at is not null and e.visibility = 'public') as dates`;

/** Not across a block, either way (blocks are between creators). $1 is the viewer. */
const NOT_BLOCKED = `not exists (
  select 1 from blocks bl
   where (bl.blocker_id = $1 and bl.blocked_id = c.owner_id) or (bl.blocker_id = c.owner_id and bl.blocked_id = $1))`;

const madeBy = (r: Pick<ProfileRow, "is_house" | "created_via">): MadeBy => (r.is_house ? "house" : r.created_via === "mcp" ? "agent" : "human");

export function toProfile(r: ProfileRow): DatingProfile {
  // A house character is available only while it's on this season's cast; an OC, while it's open to dates.
  const available = r.is_house ? isOnSeasonCast(r.id) : r.open_to_dates;
  return {
    id: r.id,
    name: r.name,
    age: r.age,
    pronouns: r.pronouns,
    bio: r.bio,
    traits: r.traits,
    want: r.want,
    appearance: r.appearance,
    voice: r.voice,
    hue: r.avatar_hue,
    portrait: r.portrait,
    made_by: madeBy(r),
    open_to_dates: available,
    open_to: r.is_house ? "everyone" : r.open_audience,
    can_ask_out: available && (r.is_house || !swipeGateOn()),
    dates: r.dates,
    url: `/characters/${r.id}`,
    extras: r.extras ?? {},
  };
}

/* ------------------------------------------- text matching ------------------------------------------- */

const STOPWORDS = new Set(
  "the and for with who that this they them their there what when where your you yours about into from just very really someone something anyone anything will would could should have has had been being are was were not but all any can out more most some such than then too only own same also each other our ours his her hers him she he its it's i'm let's like love date dates dating".split(
    " ",
  ),
);

/** Lower-cased content words of 3+ letters (a light stem: trailing "s" dropped), for overlap scoring. */
export function keywords(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9']+/)) {
    const w = raw.replace(/'s$/, "").replace(/(?<=\w{3})s$/, "");
    if (w.length >= 3 && !STOPWORDS.has(w)) out.add(w);
  }
  return out;
}

/** A word that says something about a person, for a match's reasons: not "small", "without" or "really". */
const WEAK_WORDS = new Set([
  "small", "big", "little", "without", "really", "very", "good", "great", "nice", "someone", "somebody", "person", "people", "thing", "things",
  "time", "times", "always", "never", "every", "make", "makes", "just", "even", "much", "more", "most", "like", "want", "wants", "know",
  "actually", "still", "back", "first", "last", "next", "other", "same", "kind", "sort", "way", "ways", "lot", "lots", "one", "two",
]);
const strongWord = (w: string) => w.length >= 4 && !WEAK_WORDS.has(w) && contentWords(w, 4).length > 0;

const haystack = (p: Pick<DatingProfile, "name" | "bio" | "want" | "appearance" | "voice" | "traits"> & { extras?: CharacterExtras }): string =>
  [p.name, p.bio, p.want, p.appearance ?? "", p.voice ?? "", ...p.traits, extrasText(p.extras ?? {})].join(" ");

/* ------------------------------------------------ search ------------------------------------------------ */

export type SearchOptions = {
  /** The searching identity: their own characters and anyone across a block are left out. */
  viewerId: string | null;
  /** Free text matched against name, bio, want, looks, voice and traits. */
  query?: string;
  /** Traits to look for (any of them). */
  traits?: string[];
  /** Only characters you can ask out by name (house + open to dates). Default true. */
  openOnly?: boolean;
  includeHouse?: boolean;
  madeBy?: MadeBy | "any";
  limit?: number;
};

/** The candidate pool, newest first, bounded so a search stays cheap however big the cast grows. */
async function candidates(db: Db, viewerId: string | null, openOnly: boolean, includeHouse: boolean): Promise<ProfileRow[]> {
  const { rows } = await db.query<ProfileRow>(
    `select ${PUBLIC_COLUMNS}
       from characters c
      where ((c.is_house and c.premium_sku is null and $2::boolean and c.id = any($4))
             or (not c.is_house and (c.open_to_dates or not $3::boolean) and not ${takenSql("c")}))
        and ($1::text is null or c.is_house or (c.owner_id <> $1 and ${NOT_BLOCKED}))
      order by c.is_house, c.created_at desc, c.id
      limit 300`,
    [viewerId, includeHouse, openOnly, seasonCastIds()],
  );
  return rows;
}

export async function searchCharacters(db: Db, opts: SearchOptions): Promise<DatingProfile[]> {
  const limit = Math.max(1, Math.min(30, opts.limit ?? 10));
  const pool = (await candidates(db, opts.viewerId, opts.openOnly ?? true, opts.includeHouse ?? true)).map(toProfile);
  const terms = [...keywords(opts.query ?? "")];
  const wanted = (opts.traits ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);
  const filtering = terms.length > 0 || wanted.length > 0;

  const scored = pool
    .filter((p) => !opts.madeBy || opts.madeBy === "any" || p.made_by === opts.madeBy)
    .map((p) => {
      const words = keywords(haystack(p));
      const termHits = terms.filter((t) => words.has(t) || p.name.toLowerCase().includes(t)).length;
      const traitHits = wanted.filter((w) => p.traits.some((t) => t.toLowerCase().includes(w))).length;
      return { p, score: termHits + 2 * traitHits };
    })
    .filter((s) => !filtering || s.score > 0);
  // Best match first; among equals, people and agents before the house cast, then the busiest.
  scored.sort((a, b) => b.score - a.score || Number(a.p.made_by === "house") - Number(b.p.made_by === "house") || b.p.dates - a.p.dates);
  return scored.slice(0, limit).map((s) => s.p);
}

/** Characters other creators opened to dates (no house cast), for the builder's "ask someone out" gallery. */
export function listOpenCharacters(db: Db, viewerId: string | null, limit = 9): Promise<DatingProfile[]> {
  return searchCharacters(db, { viewerId, openOnly: true, includeHouse: false, limit });
}

/* ------------------------------------------------ matches ------------------------------------------------ */

export type Match = DatingProfile & {
  score: number;
  why: string[];
  /** Where your character already stands with them, when they've met (the relationship graph). */
  relationship?: { stage: Stage; stage_label: string; dates: number };
};

/** Stages a suggestion never comes back from: it went badly. */
const NO_REPEAT: ReadonlySet<Stage> = new Set(["bad_blood", "exes"]);

/**
 * Who one of YOUR characters might like to ask out, best first. Three kinds of signal, each with its "why":
 *  - content: shared traits and hobbies, and whether each one's bio and traits speak to what the other wants;
 *  - what the show has learned (lib/compatibility.ts): how often characters with these traits ended up on a
 *    second date, smoothed and evidence-gated;
 *  - the relationship graph: someone it's already sparking with ranks up, and exes or bad blood never come back.
 * A small popularity damper keeps everyone from being pointed at the same few characters. Null if the character
 * isn't yours. Always returns someone (a fresh face) when nobody scores, so an agent never hits a dead end.
 */
export async function findMatches(
  db: Db,
  viewerId: string,
  characterId: string,
  limit = 5,
): Promise<{ for: { id: string; name: string }; matches: Match[] } | null> {
  const mine = (
    await db.query<ProfileRow>(`select ${PUBLIC_COLUMNS} from characters c where c.id = $1 and c.owner_id = $2 and not c.is_house`, [characterId, viewerId])
  ).rows[0];
  if (!mine) return null;
  const me = toProfile(mine);
  // Only characters open to one like this one (lib/audience.ts): house characters are open to everyone.
  const pool = (await candidates(db, viewerId, true, true)).filter((r) => r.is_house || audienceAllows(r.open_audience, mine.created_via)).map(toProfile);
  const matches = await rankFor(db, viewerId, me, pool);
  return { for: { id: me.id, name: me.name }, matches: matches.slice(0, Math.max(1, Math.min(20, limit))) };
}

/**
 * What one of your characters makes of a pool of others, best first, each with a score and its reasons: shared traits
 * and interests, what each wants, what the show has learned about these traits (lib/compatibility.ts), where they
 * already stand, and a popularity damper. Exes and bad blood never come back. Used by find_matches and the swipe deck
 * (lib/swipes.ts).
 */
export async function rankFor(db: Db, viewerId: string, me: DatingProfile, pool: DatingProfile[]): Promise<Match[]> {
  const myTraits = new Set(me.traits.map((t) => t.toLowerCase()));
  const myWant = keywords(me.want);
  const myWords = keywords(haystack({ ...me, want: "" }));
  const [stats, degrees, edges] = await Promise.all([loadTraitStats(db), publicDegrees(db, pool.map((p) => p.id)), relationshipsOf(db, me.id)]);
  const metWith = new Map(
    edges.flatMap((rel) => {
      const v = viewRelationship(rel, { userId: viewerId, owner: true });
      return v?.stage ? [[rel.lo === me.id ? rel.hi : rel.lo, { stage: v.stage, stage_label: STAGE_LABELS[v.stage], dates: v.dates }] as const] : [];
    }),
  );
  const matches: Match[] = pool.filter((p) => !NO_REPEAT.has(metWith.get(p.id)?.stage as Stage)).map((p) => {
    const why: string[] = [];
    let score = 0;
    const shared = p.traits.filter((t) => myTraits.has(t.toLowerCase()));
    for (const t of shared) {
      score += 3;
      why.push(`you're both ${t.toLowerCase()}`);
    }
    const myHobbies = new Set((me.extras.hobbies ?? []).map((h) => h.toLowerCase()));
    const sharedHobbies = (p.extras.hobbies ?? []).filter((h) => myHobbies.has(h.toLowerCase()));
    if (sharedHobbies.length) {
      score += 2 * sharedHobbies.length;
      why.push(`you both love ${sharedHobbies.map((h) => h.toLowerCase()).join(" and ")}`);
    }
    const theirWords = keywords(haystack({ ...p, want: "" }));
    const theyFit = [...myWant].filter((w) => strongWord(w) && theirWords.has(w)).slice(0, 3);
    if (theyFit.length) score += theyFit.length;
    // A reason needs two shared words, or one with some length to it (run 4: "wants “keep”" isn't a reason); a short
    // single word still scores.
    if (theyFit.length >= 2 || theyFit.some((w) => w.length >= 5)) {
      why.push(`${me.name} wants ${theyFit.map((w) => `"${w}"`).join(", ")} — that's in ${p.name}'s profile`);
    }
    const youFit = [...keywords(p.want)].filter((w) => strongWord(w) && myWords.has(w)).slice(0, 3);
    if (youFit.length) score += youFit.length;
    if (youFit.length >= 2 || youFit.some((w) => w.length >= 5)) {
      why.push(`${p.name} wants ${youFit.map((w) => `"${w}"`).join(", ")} — that's in ${me.name}'s profile`);
    }
    // What the show has learned about these traits together, once enough dates back it.
    const compat = compatibility(stats, me.traits, p.traits);
    if (compat.evidence >= MIN_EVIDENCE) score += Math.max(-2, Math.min(3, Math.round((compat.lift - 1) * 4)));
    if (compat.reason) {
      const [x, y] = compat.reason.traits;
      why.push(`${x} × ${y}: ${compat.reason.hits} of ${compat.reason.n} dates on the show became second dates`);
    }
    // Already sparking: worth another look. (Exes and bad blood were filtered out above.)
    const met = metWith.get(p.id);
    if (met) {
      if (met.stage === "sparks" || met.stage === "dating" || met.stage === "going_steady") score += 1;
      why.unshift(`you've met: ${met.stage_label.replace(/^\S+\s/, "").toLowerCase()} (${met.dates === 1 ? "1 date" : `${met.dates} dates`})`);
    }
    // Popularity damper: a little less for characters many others are already dating.
    score -= 0.5 * Math.log2(1 + (degrees.get(p.id) ?? 0));
    if (!why.length) why.push(p.dates === 0 ? "a fresh face, no dates yet" : "an open invitation");
    return { ...p, score: Math.round(score * 100) / 100, why, ...(met ? { relationship: met } : {}) };
  });
  matches.sort((a, b) => b.score - a.score || Number(a.made_by === "house") - Number(b.made_by === "house") || a.dates - b.dates);
  return matches;
}

/* ---------------------------------------------- one profile ---------------------------------------------- */

export async function getDatingProfile(db: Db, id: string): Promise<DatingProfile | null> {
  const row = (await db.query<ProfileRow>(`select ${PUBLIC_COLUMNS} from characters c where c.id = $1`, [id])).rows[0];
  return row ? toProfile(row) : null;
}

/** Your own characters, with whether each is open to dates and its public record. */
export async function listMyDatingProfiles(db: Db, userId: string): Promise<DatingProfile[]> {
  const { rows } = await db.query<ProfileRow>(
    `select ${PUBLIC_COLUMNS} from characters c where c.owner_id = $1 and not c.is_house order by c.created_at desc, c.id limit 50`,
    [userId],
  );
  return rows.map(toProfile);
}

/* --------------------------------------------- the agents --------------------------------------------- */

/**
 * The agents' daily date cap — for dates that run on OUR model only. Every such date costs ~15 calls on the
 * one free model key the whole show shares (docs/date-quality.md), and that quota running dry once took live
 * dates down for hours. A date an agent performs itself (two of its own characters, lib/own-date.ts) spends
 * none of it, so it never counts here. BOTCHELOR_AGENT_DAILY_DATES overrides it; 0 pauses our-model agent dates.
 */
export function agentDailyDateCap(env: Record<string, string | undefined> = process.env): number {
  const raw = env.BOTCHELOR_AGENT_DAILY_DATES?.trim();
  if (!raw) return 20;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 20;
}

const utcMidnight = (now: Date): Date => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export async function agentDatesToday(db: Db, now: Date = new Date()): Promise<{ used: number; cap: number; resets_at: string }> {
  const start = utcMidnight(now);
  const { rows } = await db.query<{ n: number }>(
    // A two-agent date the show's model took one side of (lib/own-date.ts handOverOwnDate) counts as one too.
    `select count(*)::int as n from episodes
      where created_via = 'mcp' and ((performed_by = 'platform' and created_at >= $1) or handed_over_at >= $1)`,
    [start.toISOString()],
  );
  return { used: rows[0]?.n ?? 0, cap: agentDailyDateCap(), resets_at: new Date(start.getTime() + 86_400_000).toISOString() };
}

export type AgentStats = {
  /** Identities that connected (one per connection that never passed an agent_id, so it runs high). */
  agents: number;
  /** Agents that made at least one character: the ones that stayed to play. */
  agents_with_characters: number;
  sessions: number;
  agents_last_7d: number;
  agent_characters: number;
  open_to_dates: number;
  agent_dates: number;
  /** Of those, the dates agents performed themselves (no model quota spent, never budgeted). */
  agent_performed_dates: number;
  dates_today: { used: number; cap: number; resets_at: string };
};

/** Public, aggregate-only numbers about the agents on the show (the /agents page and the MCP). */
export async function agentStats(db: Db, now: Date = new Date()): Promise<AgentStats> {
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const { rows } = await db.query<{
    agents: number;
    agents_with_characters: number;
    sessions: number;
    agents_last_7d: number;
    agent_characters: number;
    open_to_dates: number;
    agent_dates: number;
    agent_performed_dates: number;
  }>(
    `select (select count(distinct agent_id)::int from mcp_sessions) as agents,
            (select count(distinct owner_id)::int from characters where created_via = 'mcp' and owner_id is not null) as agents_with_characters,
            (select count(*)::int from mcp_sessions) as sessions,
            (select count(distinct agent_id)::int from mcp_sessions where last_seen >= $1) as agents_last_7d,
            (select count(*)::int from characters where created_via = 'mcp') as agent_characters,
            (select count(*)::int from characters where open_to_dates and not is_house) as open_to_dates,
            (select count(*)::int from episodes where created_via = 'mcp' and status = 'ready') as agent_dates,
            (select count(*)::int from episodes where performed_by = 'agent' and status = 'ready') as agent_performed_dates`,
    [since],
  );
  return { ...rows[0], dates_today: await agentDatesToday(db, now) };
}

export type AgentClient = { client: string; agents: number; sessions: number; calls: number; last_seen: string };

/** Owner-only detail (admin): which clients connect, and how much they do. Still nothing personal. */
export async function agentClients(db: Db, limit = 50): Promise<{ clients: AgentClient[]; recent: { client: string; user_agent: string | null; calls: number; last_seen: string }[] }> {
  const clients = (
    await db.query<{ client: string; agents: number; sessions: number; calls: number; last_seen: Date | string }>(
      `select coalesce(client_name, 'unknown') as client, count(distinct agent_id)::int as agents, count(*)::int as sessions,
              coalesce(sum(calls), 0)::int as calls, max(last_seen) as last_seen
         from mcp_sessions group by 1 order by max(last_seen) desc limit $1`,
      [limit],
    )
  ).rows.map((r) => ({ ...r, last_seen: new Date(r.last_seen).toISOString() }));
  const recent = (
    await db.query<{ client: string; user_agent: string | null; calls: number; last_seen: Date | string }>(
      `select coalesce(client_name || coalesce(' ' || client_version, ''), 'unknown') as client, user_agent, calls, last_seen
         from mcp_sessions order by last_seen desc limit $1`,
      [limit],
    )
  ).rows.map((r) => ({ ...r, last_seen: new Date(r.last_seen).toISOString() }));
  return { clients, recent };
}
