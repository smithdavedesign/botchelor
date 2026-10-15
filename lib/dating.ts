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
import type { Db } from "./db";

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
  made_by: MadeBy;
  open_to_dates: boolean;
  /** True when you can name them as your date's partner (house, or open to dates). */
  can_ask_out: boolean;
  /** Public, aired dates so far. */
  dates: number;
  url: string;
};

type Row = {
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
  is_house: boolean;
  created_via: string;
  open_to_dates: boolean;
  dates: number;
};

const PUBLIC_COLUMNS = `c.id, c.name, c.age, c.pronouns, c.bio, c.traits, c.want, c.appearance, c.voice, c.avatar_hue,
  c.is_house, c.created_via, c.open_to_dates,
  (select count(*)::int from episodes e
     where (e.character_a = c.id or e.character_b = c.id) and e.revealed_at is not null and e.visibility = 'public') as dates`;

/** Not across a block, either way (blocks are between creators). $1 is the viewer. */
const NOT_BLOCKED = `not exists (
  select 1 from blocks bl
   where (bl.blocker_id = $1 and bl.blocked_id = c.owner_id) or (bl.blocker_id = c.owner_id and bl.blocked_id = $1))`;

const madeBy = (r: Pick<Row, "is_house" | "created_via">): MadeBy => (r.is_house ? "house" : r.created_via === "mcp" ? "agent" : "human");

function toProfile(r: Row): DatingProfile {
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
    made_by: madeBy(r),
    open_to_dates: r.is_house || r.open_to_dates,
    can_ask_out: r.is_house || r.open_to_dates,
    dates: r.dates,
    url: `/characters/${r.id}`,
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

const haystack = (p: Pick<DatingProfile, "name" | "bio" | "want" | "appearance" | "voice" | "traits">): string =>
  [p.name, p.bio, p.want, p.appearance ?? "", p.voice ?? "", ...p.traits].join(" ");

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
async function candidates(db: Db, viewerId: string | null, openOnly: boolean, includeHouse: boolean): Promise<Row[]> {
  const { rows } = await db.query<Row>(
    `select ${PUBLIC_COLUMNS}
       from characters c
      where ((c.is_house and c.premium_sku is null and $2::boolean)
             or (not c.is_house and (c.open_to_dates or not $3::boolean)))
        and ($1::text is null or c.is_house or (c.owner_id <> $1 and ${NOT_BLOCKED}))
      order by c.is_house, c.created_at desc, c.id
      limit 300`,
    [viewerId, includeHouse, openOnly],
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

export type Match = DatingProfile & { score: number; why: string[] };

/**
 * Who one of YOUR characters might like to ask out, best first: shared traits, and whether each one's bio
 * and traits speak to what the other wants. Null if the character isn't yours. Always returns someone
 * (a fresh face) when nobody scores, so an agent never hits a dead end.
 */
export async function findMatches(
  db: Db,
  viewerId: string,
  characterId: string,
  limit = 5,
): Promise<{ for: { id: string; name: string }; matches: Match[] } | null> {
  const mine = (
    await db.query<Row>(`select ${PUBLIC_COLUMNS} from characters c where c.id = $1 and c.owner_id = $2 and not c.is_house`, [characterId, viewerId])
  ).rows[0];
  if (!mine) return null;
  const me = toProfile(mine);
  const myTraits = new Set(me.traits.map((t) => t.toLowerCase()));
  const myWant = keywords(me.want);
  const myWords = keywords(haystack({ ...me, want: "" }));

  const pool = (await candidates(db, viewerId, true, true)).map(toProfile);
  const matches: Match[] = pool.map((p) => {
    const why: string[] = [];
    let score = 0;
    const shared = p.traits.filter((t) => myTraits.has(t.toLowerCase()));
    for (const t of shared) {
      score += 3;
      why.push(`you're both ${t.toLowerCase()}`);
    }
    const theirWords = keywords(haystack({ ...p, want: "" }));
    const theyFit = [...myWant].filter((w) => theirWords.has(w)).slice(0, 3);
    if (theyFit.length) {
      score += theyFit.length;
      why.push(`${me.name} wants ${theyFit.map((w) => `"${w}"`).join(", ")} — that's in ${p.name}'s profile`);
    }
    const youFit = [...keywords(p.want)].filter((w) => myWords.has(w)).slice(0, 3);
    if (youFit.length) {
      score += youFit.length;
      why.push(`${p.name} wants ${youFit.map((w) => `"${w}"`).join(", ")} — that's in ${me.name}'s profile`);
    }
    if (!why.length) why.push(p.dates === 0 ? "a fresh face, no dates yet" : "an open invitation");
    return { ...p, score, why };
  });
  matches.sort((a, b) => b.score - a.score || Number(a.made_by === "house") - Number(b.made_by === "house") || a.dates - b.dates);
  return { for: { id: me.id, name: me.name }, matches: matches.slice(0, Math.max(1, Math.min(20, limit))) };
}

/* ---------------------------------------------- one profile ---------------------------------------------- */

export async function getDatingProfile(db: Db, id: string): Promise<DatingProfile | null> {
  const row = (await db.query<Row>(`select ${PUBLIC_COLUMNS} from characters c where c.id = $1`, [id])).rows[0];
  return row ? toProfile(row) : null;
}

/** Your own characters, with whether each is open to dates and its public record. */
export async function listMyDatingProfiles(db: Db, userId: string): Promise<DatingProfile[]> {
  const { rows } = await db.query<Row>(
    `select ${PUBLIC_COLUMNS} from characters c where c.owner_id = $1 and not c.is_house order by c.created_at desc, c.id limit 50`,
    [userId],
  );
  return rows.map(toProfile);
}

/* --------------------------------------------- the agents --------------------------------------------- */

/**
 * The agents' daily date cap. Every date costs ~15 calls on the one free model key the whole show shares
 * (docs/date-quality.md), and that quota running dry once took live dates down for hours. So agents get
 * everything else without limit, and their dates a shared daily budget that leaves room for people.
 * BOTCHELOR_AGENT_DAILY_DATES overrides it; 0 turns agent dates off.
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
    `select count(*)::int as n from episodes where created_via = 'mcp' and created_at >= $1`,
    [start.toISOString()],
  );
  return { used: rows[0]?.n ?? 0, cap: agentDailyDateCap(), resets_at: new Date(start.getTime() + 86_400_000).toISOString() };
}

export type AgentStats = {
  agents: number;
  sessions: number;
  agents_last_7d: number;
  agent_characters: number;
  open_to_dates: number;
  agent_dates: number;
  dates_today: { used: number; cap: number; resets_at: string };
};

/** Public, aggregate-only numbers about the agents on the show (the /agents page and the MCP). */
export async function agentStats(db: Db, now: Date = new Date()): Promise<AgentStats> {
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const { rows } = await db.query<{
    agents: number;
    sessions: number;
    agents_last_7d: number;
    agent_characters: number;
    open_to_dates: number;
    agent_dates: number;
  }>(
    `select (select count(distinct agent_id)::int from mcp_sessions) as agents,
            (select count(*)::int from mcp_sessions) as sessions,
            (select count(distinct agent_id)::int from mcp_sessions where last_seen >= $1) as agents_last_7d,
            (select count(*)::int from characters where created_via = 'mcp') as agent_characters,
            (select count(*)::int from characters where open_to_dates and not is_house) as open_to_dates,
            (select count(*)::int from episodes where created_via = 'mcp') as agent_dates`,
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
