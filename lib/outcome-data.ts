/**
 * What the offline evaluators for learning from outcomes (ROADMAP #578; scripts/eval/deck-cf-offline.mjs and
 * chemistry-model.mjs) may read, and nothing else. Report only: nothing here changes the deck, the prompts or the engine,
 * and the engine stays deterministic (a learned model would only ever inform previews and who meets whom).
 *
 * Training or testing a model on people's data needs their opt-in (the privacy page's "Training and research"), so every
 * read goes through the dataset gates the export uses (lib/ml-consent.ts):
 *  - a swipe, an impression or a match counts only when both characters are the show's own or their owners had opted in
 *    at the time (consentedCharactersSql), neither is a private character, and neither is ours (lib/our-traffic.ts);
 *  - a date counts only when it aired publicly (airedPublicSql: never private, unlisted, report-hidden or After Dark),
 *    with the same rules for its characters and whoever booked it. A second date counts only when it aired publicly too;
 *    a first date whose follow-up didn't is left out rather than read as "no second date".
 * Only public sheet fields are read (traits, voice, the date's format, what kind of being they are): never a soul, a
 * dealbreaker, the engine trace's soul-derived signals or anything After Dark.
 *
 * Scripts load this one module through Vite's module runner (scripts/eval/export-preferences.mjs loadLib).
 */
import type { Db } from "./db";
import { airedPublicSql, consentedCharactersSql } from "./ml-consent";

export { buildTraitStats, compatibility } from "./compatibility";
export { loadOurIds } from "./our-traffic";
export { sheetSignals } from "./temperament";
export { gateText, OUTCOMES_GATE, outcomesReadiness } from "./training-readiness";

const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : typeof v === "string" ? (JSON.parse(v) as T[]) : []);
const iso = (d: Date | string) => new Date(d).toISOString();

/** SQL: the characters `x` and `y` are usable together at `at`: opted in (or the show's), public, and not ours ($1). */
const pairOk = (x: string, y: string, at: string) =>
  `${x}.visibility = 'public' and ${y}.visibility = 'public'
     and coalesce(${x}.owner_id, '') <> all($1::text[]) and coalesce(${y}.owner_id, '') <> all($1::text[])
     and ${consentedCharactersSql(x, y, at)}`;

export type Swipe = { viewer: string; card: string; liked: boolean; at: string };
export type Impression = { viewer: string; card: string; score: number | null; rank: number; at: string };
export type PairEvent = { x: string; y: string; at: string };
export type DeckData = { swipes: Swipe[]; impressions: Impression[]; matches: PairEvent[]; seconds: PairEvent[] };

/** The deck's record, gated: swipes, what decks showed (with the deck's own score), mutual matches and second dates. */
export async function loadDeckData(db: Db, ours: readonly string[]): Promise<DeckData> {
  const p = [ours];
  const swipes = (
    await db.query<{ viewer: string; card: string; liked: boolean; at: Date | string }>(
      `select s.swiper as viewer, s.target as card, s.liked, s.created_at as at
         from swipes s join characters c on c.id = s.swiper join characters t on t.id = s.target
        where not c.is_house and ${pairOk("c", "t", "s.created_at")}
        order by s.created_at, s.swiper, s.target`,
      p,
    )
  ).rows.map((r) => ({ viewer: r.viewer, card: r.card, liked: Boolean(r.liked), at: iso(r.at) }));
  const impressions = (
    await db.query<{ viewer: string; card: string; score: number | null; rank: number; at: Date | string }>(
      `select i.viewer, i.card, i.score, i.rank, i.at
         from swipe_impressions i join characters c on c.id = i.viewer join characters t on t.id = i.card
        where not c.is_house and ${pairOk("c", "t", "i.at")}
        order by i.at, i.id`,
      p,
    )
  ).rows.map((r) => ({ viewer: r.viewer, card: r.card, score: r.score === null ? null : Number(r.score), rank: Number(r.rank), at: iso(r.at) }));
  const matches = (
    await db.query<{ x: string; y: string; at: Date | string }>(
      `select m.character_lo as x, m.character_hi as y, m.matched_at as at
         from matches m join characters c on c.id = m.character_lo join characters t on t.id = m.character_hi
        where ${pairOk("c", "t", "m.matched_at")}
        order by m.matched_at`,
      p,
    )
  ).rows.map((r) => ({ x: r.x, y: r.y, at: iso(r.at) }));
  const seconds = (
    await db.query<{ x: string; y: string; at: Date | string }>(
      `select e.character_a as x, e.character_b as y, f.created_at as at
         from episodes e join episodes f on f.followup_of = e.id
         join characters c on c.id = e.character_a join characters t on t.id = e.character_b
        where ${airedPublicSql("e")} and ${airedPublicSql("f")} and ${pairOk("c", "t", "e.created_at")}
          and ${consentedCharactersSql("c", "t", "f.created_at")}
          and e.creator_id <> all($1::text[]) and f.creator_id <> all($1::text[])
        order by f.created_at`,
      p,
    )
  ).rows.map((r) => ({ x: r.x, y: r.y, at: iso(r.at) }));
  return { swipes, impressions, matches, seconds };
}

/** A first date as the chemistry model reads it: public sheet fields, the format, and both outcomes it could predict. */
export type FirstDate = {
  id: string;
  at: string;
  format: string;
  a: { traits: string[]; voice: string | null; kind: string | null };
  b: { traits: string[]; voice: string | null; kind: string | null };
  /**
   * The couple booked a second date and it aired publicly (Real use's second-date rate, on the usable part). Null when
   * it can't be told: aired under `minAgeDays` ago (a second date takes time to book), or the follow-up didn't air
   * publicly (it can't be used, and reading it as "no" would be wrong).
   */
  booked: boolean | null;
  /** The engine's ending was a second date (what chemistry_on_record predicts today). */
  ending_second: boolean;
};

/** Every usable first date (no followup_of): aired publicly, both characters opted in (or the show's), nobody ours. */
export async function loadFirstDates(db: Db, ours: readonly string[], { now = new Date(), minAgeDays = 7 }: { now?: Date; minAgeDays?: number } = {}): Promise<{ dates: FirstDate[]; too_recent: number; follow_up_unusable: number }> {
  const { rows } = await db.query<{
    id: string;
    at: Date | string;
    revealed_at: Date | string;
    ending: string;
    format: string | null;
    a_traits: unknown;
    b_traits: unknown;
    a_voice: string | null;
    b_voice: string | null;
    a_kind: string | null;
    b_kind: string | null;
    followed: boolean;
    followed_public: boolean;
  }>(
    `select e.id, e.created_at as at, e.revealed_at, e.ending, e.setup->>'format' as format,
            coalesce(e.setup->'sheet_a'->'traits', c.traits) as a_traits, coalesce(e.setup->'sheet_b'->'traits', t.traits) as b_traits,
            coalesce(e.setup->'sheet_a'->>'voice', c.voice) as a_voice, coalesce(e.setup->'sheet_b'->>'voice', t.voice) as b_voice,
            c.extras->>'kind' as a_kind, t.extras->>'kind' as b_kind,
            exists (select 1 from episodes f where f.followup_of = e.id) as followed,
            exists (select 1 from episodes f where f.followup_of = e.id and ${airedPublicSql("f")}) as followed_public
       from episodes e join characters c on c.id = e.character_a join characters t on t.id = e.character_b
      where e.followup_of is null and ${airedPublicSql("e")} and ${pairOk("c", "t", "e.created_at")} and e.creator_id <> all($1::text[])
      order by e.created_at, e.id`,
    [ours],
  );
  const cutoff = now.getTime() - minAgeDays * 86_400_000;
  let tooRecent = 0;
  let unusable = 0;
  const dates: FirstDate[] = [];
  for (const r of rows) {
    const recent = new Date(r.revealed_at).getTime() > cutoff;
    const hidden = Boolean(r.followed) && !r.followed_public;
    if (recent) tooRecent++;
    else if (hidden) unusable++;
    dates.push({
      id: r.id,
      at: iso(r.at),
      format: r.format ?? "classic",
      a: { traits: asArray<string>(r.a_traits), voice: r.a_voice, kind: r.a_kind },
      b: { traits: asArray<string>(r.b_traits), voice: r.b_voice, kind: r.b_kind },
      booked: recent || hidden ? null : Boolean(r.followed_public),
      ending_second: r.ending === "second_date",
    });
  }
  return { dates, too_recent: tooRecent, follow_up_unusable: unusable };
}
