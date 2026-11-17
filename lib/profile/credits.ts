/**
 * Credits: what a character has been in (docs/data-model.md; the connected-model plan, stage 3).
 *
 * The facts existed, spread over six tables with no single read: who was on a season's cast and as what
 * (`season_casts`), who auditioned (`cast_auditions`), the suitors' badges and roses (`suitor_badges`, `walk_on_roses`),
 * the season's awards (frozen as JSON inside `season_recaps`), and the dates themselves. The character page showed the
 * newest badge and nothing else; the Gallery, the agents' tools and chat showed nothing. `characterCredits` answers
 * "which seasons was this character in, as what, and what came of it" for any number of characters in ONE statement,
 * so a page of cards costs the same round trip as a single profile.
 *
 * Rules the read keeps:
 *  - The public record only: dates count when they are aired and public (lib/date-number.ts `publicDateSql`), and a
 *    private character has no credits for anyone but its owner. An owner also sees their own audition's standing.
 *  - Seasons of the show only: the leaderboard weeks before the first monthly season are not seasons of the show
 *    (lib/season-ref.ts), so dates from then are not a credit.
 *  - Nothing of After Dark's, and nothing from chat.
 *  - Derived on read. A stored summary is the upgrade if this is ever measured slow (the `relationships` pattern).
 *
 * Awards are normalised when a season's recap freezes (`saveSeasonAwards`), and filled for recaps frozen earlier by the
 * hourly job (`syncSeasonAwards`). CHARACTER_CREDITS=0 hides every surface; the rows are still written.
 */
import type { Db } from "../db";
import { publicDateSql } from "../date-number";
import { seasonFormat, type SeasonFormatSlug, SEASON_FORMAT_SLUGS } from "../season-format";
import { seasonFormatSlug } from "../season-format-store";
import { seasonPath } from "../season-ref";
import { seasonIdOf, seasonLabel } from "../season-window";

type Env = Record<string, string | undefined>;

export const characterCreditsOn = (env: Env = process.env): boolean => env.CHARACTER_CREDITS?.trim() !== "0";

/** A character's part in a season, most prominent first: a row with several facts takes the first that applies. */
export const CREDIT_ROLES = ["lead", "suitor", "cast", "fan", "walk_on", "guest"] as const;
export type CreditRole = (typeof CREDIT_ROLES)[number];

export const ROLE_LABEL: Record<CreditRole, string> = {
  lead: "The lead",
  suitor: "Suitor",
  cast: "On the cast",
  fan: "Fan pick on the cast",
  walk_on: "Walk-on",
  guest: "Dated on the show",
};

export type AuditionStanding = "open" | "approved" | "rejected" | "withdrawn";

export type CharacterCredit = {
  season_id: string;
  show_id: string;
  /** "Season 3"; null only if the registry row is missing. */
  number: number | null;
  /** "December 2026". */
  label: string;
  path: string;
  format: SeasonFormatSlug | null;
  format_title: string | null;
  role: CreditRole;
  /** Left the cast before the season ended. */
  withdrawn: boolean;
  /** Aired public dates in the season, and how many ended in a second date. */
  dates: number;
  second_dates: number;
  /** Roses, badges and awards, in the order they read best. */
  honours: { key: string; label: string }[];
  /** "now" while the season is on air, "next" before it starts, else "past". */
  when: "now" | "next" | "past";
  /** The viewer's own character only: how its audition for this season stands. */
  audition?: AuditionStanding;
};

const BADGE_LABEL: Record<string, string> = {
  final_rose: "🌹 The final rose",
  runner_up: "Runner-up",
  peoples_rose: "🌹 The people's rose",
};

/** An award's key from its title ("🏆 The golden couple" → "the-golden-couple"): stable across recaps, readable in a row. */
export const awardKey = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "award";

type AwardIn = { title: string; chars: { id: string }[] };

/**
 * Writes one season's awards as rows, one per character an award names, replacing what was there (a recap computed
 * again, lib/season-recap.ts RECAP_VERSION, can name different winners). Idempotent.
 */
export async function saveSeasonAwards(db: Db, seasonId: string, awards: readonly AwardIn[]): Promise<number> {
  const rows = awards.flatMap((a) => a.chars.map((c, i) => ({ award: awardKey(a.title), title: a.title.slice(0, 120), character: c.id, slot: i })));
  if (!rows.length) {
    await db.query(`delete from season_awards where season_id = $1`, [seasonId]);
    return 0;
  }
  const res = await db.query<{ n: number }>(
    `with gone as (delete from season_awards where season_id = $1),
          done as (
       insert into season_awards (season_id, award, title, character_id, slot)
       select $1, * from unnest($2::text[], $3::text[], $4::text[], $5::smallint[])
       on conflict (season_id, award, character_id) do nothing returning 1)
     select count(*)::int as n from done`,
    [seasonId, rows.map((r) => r.award), rows.map((r) => r.title), rows.map((r) => r.character), rows.map((r) => r.slot)],
  );
  return Number(res.rows[0]?.n ?? 0);
}

/** The hourly pass: recaps frozen before awards were rows get theirs, a few seasons a pass. Idempotent. */
export async function syncSeasonAwards(db: Db, limit = 12): Promise<number> {
  const { rows } = await db.query<{ season_id: string; awards: AwardIn[] | null }>(
    `select r.season_id, r.data->'awards' as awards from season_recaps r
      where r.frozen_at is not null and jsonb_typeof(r.data->'awards') = 'array' and jsonb_array_length(r.data->'awards') > 0
        and not exists (select 1 from season_awards a where a.season_id = r.season_id)
      order by r.season_id limit $1`,
    [limit],
  );
  let n = 0;
  for (const r of rows) n += await saveSeasonAwards(db, r.season_id, (r.awards ?? []).filter((a) => a && typeof a.title === "string" && Array.isArray(a.chars)));
  return n;
}

type Row = {
  character_id: string;
  season_id: string;
  kind: "cast" | "lead_pick" | "badge" | "walk_on" | "award" | "dates" | "audition";
  detail: string | null;
  flag: boolean;
  n: number;
  m: number;
  number: number | null;
  format: string | null;
  show_id: string | null;
};

const isSlug = (s: string | null): s is SeasonFormatSlug => s !== null && (SEASON_FORMAT_SLUGS as readonly string[]).includes(s);

const castRole = (source: string | null): CreditRole => (source === "lead" ? "lead" : source === "suitor" ? "suitor" : source === "fan" ? "fan" : "cast");

/**
 * Every listed character's credits, newest season first. `viewerId` is who is looking: a private character's credits
 * come back only to its owner, and so does an audition's standing.
 */
export async function characterCredits(db: Db, ids: readonly string[], opts: { viewerId?: string | null; now?: Date } = {}): Promise<Map<string, CharacterCredit[]>> {
  const out = new Map<string, CharacterCredit[]>();
  const wanted = [...new Set(ids)].filter(Boolean);
  if (!wanted.length) return out;
  const viewer = opts.viewerId ?? "";
  const now = opts.now ?? new Date();
  const { rows } = await db.query<Row>(
    `with ok as (
       select c.id from characters c
        where c.id = any($1::text[]) and (c.visibility <> 'private' or c.owner_id = $2)),
     facts as (
       select sc.character_id, sc.season_id, 'cast'::text as kind, sc.source::text as detail, (sc.withdrawn_at is not null) as flag, 0 as n, 0 as m
         from season_casts sc join ok on ok.id = sc.character_id
       union all
       -- The lead picked for a season before its cast is dealt (/admin/season): the cast row only exists once it starts.
       select sl.character_id, sl.season_id, 'lead_pick', null, false, 0, 0
         from season_leads sl join ok on ok.id = sl.character_id
       union all
       select b.character_id, b.season_id, 'badge', b.badge::text, false, 0, 0
         from suitor_badges b join ok on ok.id = b.character_id
       union all
       select w.character_id, w.season_id, 'walk_on', null, false, (count(*) filter (where w.rose))::int, count(*)::int
         from walk_on_roses w join ok on ok.id = w.character_id group by w.character_id, w.season_id
       union all
       select a.character_id, a.season_id, 'award', a.award || '|' || a.title, false, 0, 0
         from season_awards a join ok on ok.id = a.character_id
       union all
       select x.id, x.season_id, 'dates', null, false, count(*)::int, (count(*) filter (where x.ending = 'second_date'))::int
         from (
           select ok.id, e.season_id, e.ending from episodes e join ok on e.character_a = ok.id where e.season_id is not null and ${publicDateSql("e")}
           union all
           select ok.id, e.season_id, e.ending from episodes e join ok on e.character_b = ok.id where e.season_id is not null and ${publicDateSql("e")}
         ) x group by x.id, x.season_id
       union all
       select au.character_id, au.season_id, 'audition', au.status::text, false, 0, 0
         from cast_auditions au join ok on ok.id = au.character_id where au.owner_id = $2)
     select f.character_id, f.season_id, f.kind, f.detail, f.flag, f.n, f.m, s.number, s.format, s.show_id
       from facts f left join show_seasons s on s.id = f.season_id`,
    [wanted, viewer],
  );

  const current = seasonIdOf(now);
  type Building = CharacterCredit & { roles: Set<CreditRole>; leadPick: boolean };
  const byKey = new Map<string, Building>();
  for (const r of rows) {
    // The leaderboard weeks before the first monthly season are not seasons of the show: no number, no credit.
    if (r.number === null) continue;
    const key = `${r.character_id}\n${r.season_id}`;
    let c = byKey.get(key);
    if (!c) {
      c = {
        season_id: r.season_id,
        show_id: r.show_id ?? "botchelor",
        number: r.number,
        label: seasonLabel(r.season_id),
        path: seasonPath(r.season_id),
        format: isSlug(r.format) ? r.format : null,
        format_title: null,
        role: "guest",
        withdrawn: false,
        dates: 0,
        second_dates: 0,
        honours: [],
        when: r.season_id === current ? "now" : r.season_id > current ? "next" : "past",
        roles: new Set(),
        leadPick: false,
      };
      byKey.set(key, c);
      out.set(r.character_id, [...(out.get(r.character_id) ?? []), c]);
    }
    if (r.kind === "cast") {
      c.roles.add(castRole(r.detail));
      if (r.flag) c.withdrawn = true;
    } else if (r.kind === "lead_pick") {
      c.leadPick = true;
    } else if (r.kind === "badge") {
      if (r.detail === "suitor") c.roles.add("suitor");
      else if (r.detail && BADGE_LABEL[r.detail]) c.honours.push({ key: r.detail, label: BADGE_LABEL[r.detail] });
    } else if (r.kind === "walk_on") {
      c.roles.add("walk_on");
      if (r.n > 0) c.honours.push({ key: "roses", label: `🌹 ${r.n === 1 ? "A rose" : `${r.n} roses`}` });
    } else if (r.kind === "award") {
      const [award, ...title] = (r.detail ?? "").split("|");
      c.honours.push({ key: award, label: title.join("|") || award });
    } else if (r.kind === "dates") {
      c.dates = r.n;
      c.second_dates = r.m;
    } else if (r.kind === "audition") {
      c.audition = r.detail as AuditionStanding;
    }
  }

  // A season that hasn't started has no frozen format yet: ask the store (an admin's pick, else the ballot), once each.
  const unfrozen = [...new Set([...byKey.values()].filter((c) => !c.format).map((c) => c.season_id))];
  const resolved = new Map(await Promise.all(unfrozen.map(async (id) => [id, await seasonFormatSlug(db, id).catch(() => null)] as const)));
  for (const [characterId, list] of out) {
    const done: CharacterCredit[] = [];
    for (const b of list as Building[]) {
      const { roles, leadPick, ...credit } = b;
      credit.format = credit.format ?? resolved.get(credit.season_id) ?? null;
      credit.format_title = credit.format ? seasonFormat(credit.format).title : null;
      // A lead pick only means something on a season whose format has a lead (The Botchelor): on any other it is a
      // leftover of a format that was changed, and says nothing.
      if (leadPick && credit.format && seasonFormat(credit.format).lead) roles.add("lead");
      credit.role = CREDIT_ROLES.find((role) => roles.has(role)) ?? "guest";
      // An audition alone (never cast, never dated that season) is the owner's business only, and still a row for them.
      // A season with nothing to say is not a credit.
      if (credit.role === "guest" && credit.dates === 0 && !credit.honours.length && !credit.audition) continue;
      const order = ["final_rose", "peoples_rose", "runner_up", "roses"];
      credit.honours.sort((x, y) => (order.indexOf(x.key) + 1 || 99) - (order.indexOf(y.key) + 1 || 99));
      done.push(credit);
    }
    done.sort((x, y) => (x.season_id < y.season_id ? 1 : x.season_id > y.season_id ? -1 : 0));
    if (done.length) out.set(characterId, done);
    else out.delete(characterId);
  }
  return out;
}

/** One line for a card or a caption: the most telling credit. "Lead of The Botchelor, December 2026"; null when there is none worth a line. */
export function creditLine(credits: readonly CharacterCredit[] | undefined): string | null {
  if (!credits?.length) return null;
  const best = [...credits].sort((x, y) => CREDIT_ROLES.indexOf(x.role) - CREDIT_ROLES.indexOf(y.role) || (x.season_id < y.season_id ? 1 : -1))[0];
  if (best.role === "guest") return null;
  const show = best.format_title ?? "Botchelor";
  const what = best.role === "lead" ? `Lead of ${show}` : best.role === "suitor" ? `Suitor on ${show}` : best.role === "walk_on" ? `Walk-on on ${show}` : `On the cast of ${show}`;
  return `${what}, ${best.label}`;
}
