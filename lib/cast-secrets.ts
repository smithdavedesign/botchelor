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
 * Reveals follow the schedule, and since living dates (2026-11-01, measured in the blind sim, docs/date-quality.md) the
 * dates' words too: a cast member's side of a date carries its own secrets still hidden (secretsForDate), as private
 * context to guard, hint at or let slip. When a line clearly gives one away (the actor says which, and the line shares its
 * words: slipped), the date records it (recordSlips: cast_secrets.revealed_episode), and it counts as out once that date
 * airs publicly, the date's air time as when. The schedule then deals the next ones from the rest. Pure reads apart
 * from ensureCastSecrets and recordSlips.
 */
import { z } from "zod";
import type { Db } from "./db";
import { HIDING_CHARS, MAX_HIDING } from "./extras";
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

/**
 * The stored secrets for a cast member this season, or the pool's when none are stored yet; `slipped_at` when one came
 * out on a date (living dates) that has since aired publicly.
 */
async function secretsFor(db: Db, characterId: string, seasonId: string, now: Date): Promise<{ secret: string; slipped_at: string | null }[]> {
  const r = await db.query<{ secret: string; slipped_at: string | Date | null }>(
    `select s.secret,
            case when e.revealed_at is not null and e.revealed_at <= $3 and e.visibility = 'public' then e.revealed_at end as slipped_at
       from cast_secrets s left join episodes e on e.id = s.revealed_episode
      where s.character_id = $1 and s.season_id = $2 order by s.idx`,
    [characterId, seasonId, now.toISOString()],
  );
  return r.rows.length >= SECRETS_PER_CAST
    ? r.rows.map((x) => ({ secret: x.secret, slipped_at: x.slipped_at ? new Date(x.slipped_at).toISOString() : null }))
    : dealtSecrets(characterId, seasonId).map((secret) => ({ secret, slipped_at: null }));
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
  const [secrets, aired] = await Promise.all([secretsFor(db, characterId, season, now), airedThisSeason(db, characterId, now)]);
  // Those that slipped out on an aired date are out; the schedule deals the rest, in order, one per SECRET_EVERY dates.
  const slipped = secrets.filter((s) => s.slipped_at).map((s) => ({ secret: s.secret, at: s.slipped_at! }));
  const rest = secrets.filter((s) => !s.slipped_at);
  const n = Math.min(rest.length, Math.floor(aired.length / SECRET_EVERY));
  const scheduled = rest.slice(0, n).map((s, i) => ({ secret: s.secret, at: aired[(i + 1) * SECRET_EVERY - 1].toISOString() }));
  const out = [...slipped, ...scheduled].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
  return {
    total: SECRETS_PER_CAST,
    out,
    next_in: out.length >= SECRETS_PER_CAST ? null : (n + 1) * SECRET_EVERY - aired.length,
  };
}

/**
 * A cast member's secrets this season that are NOT out yet (stored, or the pool's when none are stored): what anything
 * the show writes about them in public (the cast group chat, lib/cast-chat.ts) must never give away.
 */
export async function hiddenCastSecrets(db: Db, characterId: string, now: Date = new Date()): Promise<string[]> {
  if (!seasonCastIds(now).includes(characterId)) return [];
  const [all, status] = await Promise.all([secretsFor(db, characterId, seasonIdOf(now), now), castSecrets(db, characterId, now)]);
  const out = new Set((status?.out ?? []).map((o) => o.secret));
  return all.map((s) => s.secret).filter((s) => !out.has(s));
}

/** One secret a side carries onto a date: which it is (to record a slip) and its words. */
export type DateSecret = { season_id: string; idx: number; secret: string };

/**
 * A character's own secrets still hidden, for its side of a date (living dates): what its creator says it's hiding (any
 * character's, OWN_SEASON), and a cast member's this season. Stored ones only (a slip has to be recorded against a row),
 * not yet slipped on any date, and not yet out by the schedule. Private: only that side's own prompt ever carries them.
 */
export async function secretsForDate(db: Db, characterId: string, now: Date = new Date()): Promise<DateSecret[]> {
  // What its creator says it's hiding (OWN_SEASON), still not slipped on any date: carried by anyone's character.
  const own = (await ownSecrets(db, characterId, now)).filter((s) => !s.slipped).map((s) => ({ season_id: OWN_SEASON, idx: s.idx, secret: s.secret }));
  return [...own, ...(await castSecretsForDate(db, characterId, now))];
}

async function castSecretsForDate(db: Db, characterId: string, now: Date): Promise<DateSecret[]> {
  if (!seasonCastIds(now).includes(characterId)) return [];
  const season = seasonIdOf(now);
  const r = await db.query<{ idx: number; secret: string }>(
    `select idx, secret from cast_secrets where character_id = $1 and season_id = $2 and revealed_episode is null order by idx`,
    [characterId, season],
  );
  if (!r.rows.length) return [];
  const status = await castSecrets(db, characterId, now);
  const out = new Set((status?.out ?? []).map((o) => o.secret));
  return r.rows.filter((x) => !out.has(x.secret)).map((x) => ({ season_id: season, idx: x.idx, secret: x.secret }));
}

const SLIP_STOP = new Set(["has", "have", "had", "the", "and", "for", "with", "that", "this", "was", "are", "every", "never", "still", "once", "now", "them", "their", "they", "who", "can", "cannot", "can't", "its", "it's", "not", "but", "one", "all"]);
const slipWords = (t: string) => new Set(t.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !SLIP_STOP.has(w)).map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w)));

/**
 * Whether a line clearly gives a secret away: the actor said it let this one slip, and the line (in English) shares
 * enough of the secret's own words (two, or every one when it has fewer). A hint or a dodge never counts.
 */
export function slipped(line: string, secret: string): boolean {
  const want = slipWords(secret);
  if (!want.size) return false;
  const have = slipWords(line);
  const shared = [...want].filter((w) => have.has(w)).length;
  return shared >= Math.min(2, want.size);
}

/** A secret that came out on a date: whose, which, and on which line. */
export type SecretSlip = { character_id: string; season_id: string; idx: number; line: number };

/** Records the secrets a finished date let slip (once each: a secret already slipped elsewhere keeps its first date). */
export async function recordSlips(db: Db, episodeId: string, slips: readonly SecretSlip[]): Promise<void> {
  for (const s of slips) {
    await db.query(
      `update cast_secrets set revealed_episode = $4, revealed_line = $5
        where character_id = $1 and season_id = $2 and idx = $3 and revealed_episode is null`,
      [s.character_id, s.season_id, s.idx, episodeId, s.line],
    );
  }
}

/* ------------------------------- a creator's own: what they're hiding ------------------------------- */

/**
 * "What they're hiding" (Go deeper, David 2026-11-01): up to OWN_SECRETS_MAX secrets a creator writes for their own
 * character, in this same table under the season id OWN_SEASON (source 'owner'), so a date carries, guards and records
 * them exactly like a cast member's (secretsForDate, slipped, recordSlips): no second store. They never come out on a
 * schedule, only when one slips on a date, counted out once that date airs publicly (its air time as when). Unlike the
 * cast's they don't end with the month. Written through create/update (web and MCP's `hiding`), checked like the sheet.
 */
export const OWN_SEASON = "own";
export const OWN_SECRETS_MAX = MAX_HIDING;
/** The create/update field (web and MCP): up to OWN_SECRETS_MAX short lines. */
export const HidingInput = z
  .array(z.string().trim().max(HIDING_CHARS, `At most ${HIDING_CHARS} characters each.`))
  .max(OWN_SECRETS_MAX, `At most ${OWN_SECRETS_MAX}.`);

/** A creator's list, cleaned: one line each, at most SECRET_MAX characters, no blanks or repeats, at most OWN_SECRETS_MAX. */
export function cleanOwnSecrets(list: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const v of list) {
    if (typeof v !== "string") continue;
    const s = v.replace(/\s+/g, " ").trim();
    if (!s || s.length > HIDING_CHARS || out.some((o) => o.toLowerCase() === s.toLowerCase())) continue;
    out.push(s);
    if (out.length >= OWN_SECRETS_MAX) break;
  }
  return out;
}

export type OwnSecret = { idx: number; secret: string; slipped_at: string | null; slipped: boolean };

/** A character's own secrets as stored, in order: whether each slipped on a date, and when that date aired publicly. */
export async function ownSecrets(db: Db, characterId: string, now: Date = new Date()): Promise<OwnSecret[]> {
  const r = await db.query<{ idx: number; secret: string; revealed_episode: string | null; slipped_at: string | Date | null }>(
    `select s.idx, s.secret, s.revealed_episode,
            case when e.revealed_at is not null and e.revealed_at <= $3 and e.visibility = 'public' then e.revealed_at end as slipped_at
       from cast_secrets s left join episodes e on e.id = s.revealed_episode
      where s.character_id = $1 and s.season_id = $2 order by s.idx`,
    [characterId, OWN_SEASON, now.toISOString()],
  );
  return r.rows.map((x) => ({ idx: x.idx, secret: x.secret, slipped: x.revealed_episode !== null, slipped_at: x.slipped_at ? new Date(x.slipped_at).toISOString() : null }));
}

/** The "N of M out" card for a character's own secrets (the same shape as a cast member's), or null when it has none. */
export async function ownSecretsCard(db: Db, characterId: string, now: Date = new Date()): Promise<CastSecrets | null> {
  const list = await ownSecrets(db, characterId, now);
  if (!list.length) return null;
  const out = list.filter((s) => s.slipped_at).map((s) => ({ secret: s.secret, at: s.slipped_at! })).sort((x, y) => (x.at < y.at ? -1 : 1));
  return { total: list.length, out, next_in: null };
}

/**
 * Replaces a character's own secrets with this list. One that already slipped on a date stays (it's out, or will be when
 * that date airs), whatever the list says; the rest are rewritten to match it, after those. An empty list clears them.
 */
export async function setOwnSecrets(db: Db, characterId: string, list: readonly string[]): Promise<void> {
  const want = cleanOwnSecrets(list);
  const kept = (await ownSecrets(db, characterId)).filter((s) => s.slipped);
  await db.query(`delete from cast_secrets where character_id = $1 and season_id = $2 and revealed_episode is null`, [characterId, OWN_SEASON]);
  const keptWords = new Set(kept.map((k) => k.secret.toLowerCase()));
  let idx = kept.reduce((m, k) => Math.max(m, k.idx + 1), 0);
  let total = kept.length;
  for (const secret of want) {
    if (keptWords.has(secret.toLowerCase())) continue;
    if (total++ >= OWN_SECRETS_MAX) break;
    await db.query(
      `insert into cast_secrets (character_id, season_id, idx, secret, source) values ($1, $2, $3, $4, 'owner') on conflict do nothing`,
      [characterId, OWN_SEASON, idx++, secret],
    );
  }
}

export type SecretOut = {
  character_id: string;
  name: string;
  secret: string;
  index: number;
  total: number;
  at: string;
  /** A creator's own secret ("what they're hiding") that slipped on a date: the date it came out on. */
  own?: { episode_path: string };
};

/**
 * The newest of a creator's own secrets (OWN_SEASON) to slip on a date that aired after `since`, for "Since you were
 * here", or null. Only where this viewer may see that date: a public one (its character public, and not reported away)
 * for anyone, and an unlisted or private one only for the person who made it (episodes.visibility: private is the
 * creator's alone, unlisted is link-only and stays out of everything public). `index` counts this character's secrets
 * out by then on dates this viewer may see.
 */
export async function newestOwnSlip(db: Db, since: Date, viewerId: string | null, now: Date = new Date()): Promise<SecretOut | null> {
  const r = await db.query<{ character_id: string; name: string; secret: string; episode_id: string; at: string | Date; total: number; index: number }>(
    `with seen as (
       select s.character_id, s.secret, e.id as episode_id, e.revealed_at
         from cast_secrets s
         join episodes e on e.id = s.revealed_episode
         join characters c on c.id = s.character_id
        where s.season_id = $5 and e.revealed_at is not null and e.revealed_at <= $2
          and ((e.visibility = 'public' and c.visibility = 'public'
                and (select count(*) from reports r where r.episode_id = e.id) < $4)
               or (e.creator_id = $3 and $3 is not null))
     )
     select x.character_id, c.name, x.secret, x.episode_id, x.revealed_at as at,
            (select count(*)::int from cast_secrets t where t.character_id = x.character_id and t.season_id = $5) as total,
            (select count(*)::int from seen y where y.character_id = x.character_id and y.revealed_at <= x.revealed_at) as index
       from seen x join characters c on c.id = x.character_id
      where x.revealed_at > $1
      order by x.revealed_at desc limit 1`,
    [since.toISOString(), now.toISOString(), viewerId, REPORT_HIDE_THRESHOLD, OWN_SEASON],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    character_id: row.character_id,
    name: row.name,
    secret: row.secret,
    index: row.index,
    total: Math.max(row.total, row.index),
    at: new Date(row.at).toISOString(),
    own: { episode_path: `/episodes/${row.episode_id}` },
  };
}

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
