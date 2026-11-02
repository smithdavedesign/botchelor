/**
 * Hidden secrets (docs/ideas.md "Bringing viewers back", idea 4; David 2026-11-01: "go with your recommendations").
 * Each member of this season's cast keeps SECRETS_PER_CAST small secrets about themself, and they come out slowly: one
 * for every SECRET_EVERY public dates of theirs that air this season, so a regular has a reason to come back and see
 * what came out. Their page shows "2 of 3 secrets out" with the rest locked; "Since you were here" says when one came out.
 *
 * Where they come from: the show's cheap default model writes them once per season per cast member (the hourly lobby
 * job, ensureCastSecrets), each checked like any show text (PG, adults, no real people) and nothing suggestive; stored,
 * so a page view never calls a model. When the model fails or writes something that doesn't pass, or a secret of theirs
 * already came out from the fixed pool (the hour before the job ran), they get the pool's, dealt by seed. About four
 * short calls a month, well under a cent.
 *
 * Reveals follow the schedule, not the dates' words: the date writer never sees them (David's call kept for later:
 * hinting them on dates means a measured sim first, docs/ideas.md). Pure reads apart from ensureCastSecrets.
 */
import type { Db } from "./db";
import { seedFrom } from "./engine";
import { getModel, type ChatMessage, type Model } from "./model";
import { REPORT_HIDE_THRESHOLD } from "./rules";
import { suggestiveIn } from "./roleplays";
import { checkShowText } from "./safety";
import { seasonCastIds } from "./season-cast";
import { seasonIdOf, seasonWindow } from "./season-window";

export const SECRETS_PER_CAST = 3;
/** One secret comes out for every this many public dates of theirs that aired this season. */
export const SECRET_EVERY = 4;
export const SECRET_MAX = 120;

/**
 * The fixed pool: small, harmless, a little embarrassing or tender, written with no subject ("Has never seen the sea")
 * so they read the same for anyone, whatever their pronouns.
 */
export const SECRET_POOL: readonly string[] = [
  "Has never actually seen the sea",
  "Still sleeps with the childhood teddy, now on its third set of eyes",
  "Cried at a car advert last week, twice",
  "Can't whistle, and has faked it for years",
  "Practises conversations in the shower, including both sides",
  "Once got lost in a supermarket for forty minutes",
  "Owns a houseplant that is plastic and talks to it anyway",
  "Has read the last page of every novel first",
  "Pretends to like olives at dinner parties",
  "Knows every word of one very cheesy musical",
  "Was the back half of a pantomime horse at school, and loved it",
  "Keeps a list of every dog met, with ratings",
  "Has never learned to ride a bike",
  "Writes thank-you notes to delivery drivers",
  "Is terrified of geese",
  "Secretly names every pigeon on the way to work",
  "Has a fake accent saved for ordering coffee",
  "Still has a pen-pal from age nine",
  "Once won a dance-off at a wedding and still thinks about it",
  "Cannot tell left from right without a little trick",
  "Has watched the same comfort film over a hundred times",
  "Folded a thousand paper cranes one long winter",
  "Takes a photo of every sunset, and never looks at them again",
  "Was briefly, at eleven, a champion conker player",
] as const;

/** The pool's secrets for a cast member in a season: SECRETS_PER_CAST different ones, stable by seed. */
export function dealtSecrets(characterId: string, seasonId: string): string[] {
  const out: string[] = [];
  for (let i = 0; out.length < SECRETS_PER_CAST; i++) {
    const s = SECRET_POOL[seedFrom(characterId, "secret", seasonId, String(i)) % SECRET_POOL.length];
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/** A model-written secret that passes: one short line, PG, no real people, nothing suggestive. Null when it doesn't. */
export function cleanSecret(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/\s+/g, " ").trim().replace(/\.$/, "");
  if (s.length < 8 || s.length > SECRET_MAX) return null;
  if (!checkShowText({ secret: s }).ok || suggestiveIn(s)) return null;
  return s;
}

export function secretMessages(c: { name: string; bio: string }): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        `You write small secrets for a character on a light-hearted dating show. Write ${SECRETS_PER_CAST} harmless secrets about the ` +
        "character themself: funny, a little embarrassing or tender, the kind a viewer smiles at when it comes out. PG: nothing " +
        "sexual or romantic-history, no crimes, health, money or family trauma, never about any real person, brand or place, and " +
        "nothing that changes who they are. Each one a short status line with no subject or name, under 100 characters " +
        '("Has never seen the sea"). Reply with JSON only: {"secrets": ["...", "...", "..."]}.',
    },
    { role: "user", content: `${c.name}: ${c.bio}` },
  ];
}

/** The model's reply turned into SECRETS_PER_CAST secrets, or null when it didn't write enough that pass. */
export function parseSecrets(raw: string): string[] | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let list: unknown;
  try {
    list = (JSON.parse(raw.slice(start, end + 1)) as { secrets?: unknown }).secrets;
  } catch {
    return null;
  }
  if (!Array.isArray(list)) return null;
  const out: string[] = [];
  for (const item of list) {
    const s = cleanSecret(item);
    if (s && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  return out.length >= SECRETS_PER_CAST ? out.slice(0, SECRETS_PER_CAST) : null;
}

/** Public dates of theirs that aired this season and weren't reported away, oldest first: when each came out. */
async function airedThisSeason(db: Db, characterId: string, now: Date): Promise<Date[]> {
  const w = seasonWindow(now);
  const r = await db.query<{ revealed_at: string | Date }>(
    `select e.revealed_at from episodes e
      where (e.character_a = $1 or e.character_b = $1) and e.visibility = 'public' and e.revealed_at is not null
        and e.revealed_at >= $2 and e.revealed_at < $3 and e.revealed_at <= $4
        and (select count(*) from reports r where r.episode_id = e.id) < $5
      order by e.revealed_at`,
    [characterId, w.start.toISOString(), w.end.toISOString(), now.toISOString(), REPORT_HIDE_THRESHOLD],
  );
  return r.rows.map((x) => new Date(x.revealed_at));
}

/** The stored secrets for a cast member this season, or the pool's when none are stored yet. */
async function secretsFor(db: Db, characterId: string, seasonId: string): Promise<string[]> {
  const r = await db.query<{ secret: string }>(
    `select secret from cast_secrets where character_id = $1 and season_id = $2 order by idx`,
    [characterId, seasonId],
  );
  return r.rows.length >= SECRETS_PER_CAST ? r.rows.map((x) => x.secret) : dealtSecrets(characterId, seasonId);
}

export type CastSecrets = {
  total: number;
  /** The secrets out so far, in the order they came out, with when. */
  out: { secret: string; at: string }[];
  /** Public dates still to air before the next one comes out (null once they're all out). */
  next_in: number | null;
};

/** A cast member's secrets this season, or null for anyone not on this season's cast. */
export async function castSecrets(db: Db, characterId: string, now: Date = new Date()): Promise<CastSecrets | null> {
  if (!seasonCastIds(now).includes(characterId)) return null;
  const season = seasonIdOf(now);
  const [secrets, aired] = await Promise.all([secretsFor(db, characterId, season), airedThisSeason(db, characterId, now)]);
  const n = Math.min(SECRETS_PER_CAST, Math.floor(aired.length / SECRET_EVERY));
  return {
    total: SECRETS_PER_CAST,
    out: secrets.slice(0, n).map((secret, i) => ({ secret, at: aired[(i + 1) * SECRET_EVERY - 1].toISOString() })),
    next_in: n >= SECRETS_PER_CAST ? null : (n + 1) * SECRET_EVERY - aired.length,
  };
}

export type SecretOut = { character_id: string; name: string; secret: string; index: number; total: number; at: string };

/** The newest secret that came out after `since` across this season's cast, or null. For "Since you were here". */
export async function newestSecretOut(db: Db, since: Date, now: Date = new Date()): Promise<SecretOut | null> {
  const ids = seasonCastIds(now);
  if (!ids.length) return null;
  const names = await db.query<{ id: string; name: string }>(
    `select id, name from characters where id = any($1) and visibility = 'public'`,
    [ids],
  );
  let best: SecretOut | null = null;
  for (const c of names.rows) {
    const s = await castSecrets(db, c.id, now);
    const last = s?.out.length ? s.out[s.out.length - 1] : null;
    if (!s || !last || new Date(last.at) <= since) continue;
    if (!best || last.at > best.at) best = { character_id: c.id, name: c.name, secret: last.secret, index: s.out.length, total: s.total, at: last.at };
  }
  return best;
}

/**
 * Writes this season's secrets for any cast member who has none stored yet (the hourly lobby job): the model's when
 * they pass, the pool's otherwise, or when one of theirs already came out from the pool. Returns how many it stored
 * from each.
 */
export async function ensureCastSecrets(db: Db, now: Date = new Date(), model: Model = getModel(undefined, false)): Promise<{ model: number; pool: number }> {
  const season = seasonIdOf(now);
  const ids = seasonCastIds(now);
  const have = await db.query<{ character_id: string }>(
    `select distinct character_id from cast_secrets where season_id = $1 and character_id = any($2)`,
    [season, ids],
  );
  const done = new Set(have.rows.map((r) => r.character_id));
  const made = { model: 0, pool: 0 };
  for (const id of ids) {
    if (done.has(id)) continue;
    const c = (await db.query<{ name: string; bio: string }>(`select name, bio from characters where id = $1`, [id])).rows[0];
    if (!c) continue;
    let secrets: string[] | null = null;
    if ((await airedThisSeason(db, id, now)).length < SECRET_EVERY) {
      const raw = await model
        .complete(secretMessages(c), { temperature: 1, maxTokens: 400 })
        .catch(() => "");
      secrets = parseSecrets(raw);
    }
    const source = secrets ? "model" : "pool";
    const list = secrets ?? dealtSecrets(id, season);
    for (const [idx, secret] of list.entries()) {
      await db.query(
        `insert into cast_secrets (character_id, season_id, idx, secret, source) values ($1, $2, $3, $4, $5) on conflict do nothing`,
        [id, season, idx, secret, source],
      );
    }
    made[source]++;
  }
  return made;
}
