/**
 * Your character lives without you (docs/ideas.md "The core, 2026-11-14": your character has a love life, and you're in
 * their corner). The Tomodachi mechanic: things happen to your character whether or not you show up, and the text about
 * it is the reason to come back. Three pieces, all $0 apart from the date itself:
 *
 *  1. **The house takes your character out once a week** (`weeklyLifeDates`, the daily job's people part): one house-paid
 *     speed date with a season cast member it hasn't dated lately, for each owned character that has had a date already
 *     (the first date is the person's own). Booked through the ordinary booking route as the owner, on a request marked
 *     show-paid (lib/cast-date-request.ts, the cast-date prize's path), so it spends none of the person's free dates and
 *     every rule of the route holds (taken, blocks, one date at a time). Marked on the episode (`setup.met_via = 'life'`).
 *  2. **The text afterwards** (`lifeTextAfterAir`, from lib/air.ts when the date airs): the character tells its person
 *     what happened, ending included, in its companion thread. Only to a thread whose person tapped "Hear from" once
 *     (`companion_threads.muted_proactive = false`, the same opt-in as the day-after text), tagged `life:<episode id>`,
 *     with a photo from the date (lib/date-photo.ts).
 *     Everyone else gets the usual `date_aired` notice and a "went on a date while you were away" line on Since you were
 *     here (lib/since.ts).
 *  3. **"Your character's week"** (`weekOf`, `sendCharacterWeeks`, Sundays): a recap built from what already happened,
 *     no model call: the week's dates and how they ended, texts from the character, who texted whom, the chemistry
 *     shift, the next thing booked. Kind `character_week`: inbox, push, and the daily digest for email opt-ins.
 *
 * Sacred rule: nothing here touches points, odds, pairings or endings. The engine decides every life date like any other.
 */
import { POST as postEpisode } from "@/app/api/episodes/route";
import { track } from "./analytics";
import { markShowPaidRequest } from "./cast-date-request";
import { runningChemistry } from "./chemistry-shifts";
import { postFromCharacter } from "./companion";
import { textPhoto } from "./date-photo";
import { generationPaused } from "./compute";
import type { Db } from "./db";
import type { SideOutcome } from "./engine";
import { firstDateFormat, pickFirstPartner } from "./first-date";
import { PREMIUM_HOUSE_CHARACTERS, type HouseCharacter } from "./house";
import { MCP_CALL_URL, USER_COOKIE } from "./http";
import { paidDatesPerDay, paidDatesToday } from "./limits";
import { notify } from "./notifications";
import { loadOurIds } from "./our-traffic";
import { takenSql } from "./partners";
import { approvedPortraitSelect } from "./portrait-sql";
import type { Reflections } from "./reflection";
import { DELETED_OWNER, endingLabel, type Ending } from "./rules";
import { seasonCast } from "./season-cast";
import { venuePhrase } from "./venues";

/** The marker on a life date's setup (`episodes.setup->>'met_via'`), next to match / chosen / blind / proposal / second_date. */
export const LIFE_MET_VIA = "life";
/** A character goes out with the house at most this often. */
export const LIFE_GAP_DAYS = 6;
/** A cast member it dated this recently isn't picked again. */
export const LIFE_PARTNER_GAP_DAYS = 30;
/** Life dates one run books at most. */
export const LIFE_RUN_LIMIT = 25;
/** Life dates a day across the show, unless LIFE_DATES_PER_DAY says otherwise (~1¢ each on the show's model). */
export const DEFAULT_LIFE_DATES_PER_DAY = 30;
/** How far back "this week" looks for the recap. */
export const WEEK_DAYS = 7;
/** Recaps one run sends at most (well under the email cap; the rest go next Sunday). */
export const WEEK_BATCH = 50;

const DAY_MS = 24 * 60 * 60 * 1000;
const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] || name;

/** Today's cap on life dates: LIFE_DATES_PER_DAY (0 turns them off), else the default. */
export function lifeDatesPerDay(env: Record<string, string | undefined> = process.env): number {
  const raw = env.LIFE_DATES_PER_DAY?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_LIFE_DATES_PER_DAY;
}

/* ------------------------------------------------ the house takes them out ------------------------------------------------ */

type Candidate = { id: string; name: string; owner_id: string; visibility: string; dates: number };

/**
 * Whose turn it is: owned characters (a real person's, never the house's; one made over MCP only when its owner has an
 * account), public or at least open to dates (a private one that may be asked out by name may be taken out too, on an
 * unlisted date), with a portrait, with at least one date already (the first is the person's own), none being filmed,
 * not taken (one partner), and no life date in LIFE_GAP_DAYS, nor a Sunday rose in that time (lib/casting.ts: a rose is
 * a show-paid second date with the lead, which is that week's outing). Longest since their last life date first. Our own
 * identities (lib/our-traffic.ts) are left out by the caller.
 */
async function candidates(db: Db, now: Date, limit: number): Promise<Candidate[]> {
  const { rows } = await db.query<Candidate>(
    `select c.id, c.name, c.owner_id, c.visibility,
            (select count(*) from episodes e where c.id in (e.character_a, e.character_b) and e.status = 'ready')::int as dates
       from characters c
      where not c.is_house and c.owner_id is not null and c.owner_id <> $1
        and (c.visibility = 'public' or c.open_to_dates)
        and (c.created_via <> 'mcp' or exists (select 1 from accounts a where a.user_id = c.owner_id))
        and exists (${approvedPortraitSelect("c.id")})
        and exists (select 1 from episodes e where c.id in (e.character_a, e.character_b) and e.status = 'ready')
        and not exists (select 1 from episodes e where c.id in (e.character_a, e.character_b) and e.status = 'generating')
        and not exists (select 1 from episodes e where e.character_a = c.id and e.setup->>'met_via' = $2
                         and e.created_at > $3::timestamptz - make_interval(days => $4::int))
        and not exists (select 1 from walk_on_roses w where w.character_id = c.id and w.rose
                         and w.created_at > $3::timestamptz - make_interval(days => $4::int))
        and not ${takenSql("c")}
      order by (select max(e.created_at) from episodes e where e.character_a = c.id and e.setup->>'met_via' = $2) nulls first, c.created_at, c.id
      limit $5`,
    [DELETED_OWNER, LIFE_MET_VIA, now.toISOString(), LIFE_GAP_DAYS, limit],
  );
  return rows;
}

/** Life dates booked today (UTC), for the daily cap. */
async function bookedToday(db: Db, now: Date): Promise<number> {
  const day = `${now.toISOString().slice(0, 10)}T00:00:00Z`;
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from episodes where setup->>'met_via' = $1 and created_at >= $2::timestamptz`, [LIFE_MET_VIA, day]);
  return rows[0]?.n ?? 0;
}

/** This season's cast a life date may be with: the free roster (lib/season-cast.ts seasonCast), never a bought premium one. */
const freeCast = (now: Date): HouseCharacter[] => {
  const premium = new Set(PREMIUM_HOUSE_CHARACTERS.map((c) => c.id));
  return seasonCast(now).filter((c) => !premium.has(c.id));
};

/**
 * The cast member for this character's life date (pure): one of `cast` not in `recent` (dated within
 * LIFE_PARTNER_GAP_DAYS), picked by the character's id salted with how many dates it has had, so the pick rotates from
 * one life date to the next. When it has dated the whole cast lately, anyone on it. Null with nobody on the cast.
 */
export function pickLifePartner<T extends { id: string }>(cast: readonly T[], characterId: string, dates: number, recent: ReadonlySet<string>): T | null {
  const free = [...cast];
  const fresh = free.filter((c) => !recent.has(c.id));
  const pool = fresh.length ? fresh : free;
  const picked = pickFirstPartner(pool.map((c) => ({ id: c.id, name: c.id })), `${characterId}:${dates}`);
  return picked ? (pool.find((c) => c.id === picked.id) ?? null) : null;
}

export type LifeDatesRun = {
  /** Dates booked this run. */
  booked: number;
  /** Characters whose turn it was. */
  candidates: number;
  /** Why nothing (or less) was booked: the pause, the caps, or nobody due. */
  stopped: "paused" | "daily_cap" | "paid_cap" | "no_cast" | null;
  /** The route's refusals, by error code. */
  refused: Record<string, number>;
};

/**
 * The run (the daily job): one house-paid speed date each for the characters whose turn it is, up to `limit` and the
 * day's cap (LIFE_DATES_PER_DAY), none while generation is paused or the paid model's daily cap is spent (lib/limits.ts:
 * the generation job claims a paid date per show date, so a day at the cap books no life dates on top). Booked as the
 * owner through the booking route on a show-paid request: the owner's free dates stay untouched. Never for our own
 * identities (lib/our-traffic.ts loadOurIds, read only when someone is due).
 */
export async function weeklyLifeDates(db: Db, now = new Date(), limit = LIFE_RUN_LIMIT, env: Record<string, string | undefined> = process.env): Promise<LifeDatesRun> {
  const run: LifeDatesRun = { booked: 0, candidates: 0, stopped: null, refused: {} };
  if (generationPaused(env)) return { ...run, stopped: "paused" };
  const room = Math.min(Math.max(0, limit), lifeDatesPerDay(env) - (await bookedToday(db, now)));
  if (room <= 0) return { ...run, stopped: "daily_cap" };
  if ((await paidDatesToday(db, now)) >= paidDatesPerDay(env)) return { ...run, stopped: "paid_cap" };
  const cast = freeCast(now);
  if (!cast.length) return { ...run, stopped: "no_cast" };

  // Twice the room: our own identities are filtered after the read, and the gap rule already thins the list.
  const due = await candidates(db, now, room * 2);
  if (!due.length) return run;
  const ours = new Set(await loadOurIds(db).catch(() => [] as string[]));
  const mine = due.filter((c) => !ours.has(c.owner_id));
  run.candidates = mine.length;
  const castIds = cast.map((c) => c.id);
  for (const c of mine.slice(0, room)) {
    // Cast members this character dated in the last LIFE_PARTNER_GAP_DAYS: not again so soon.
    const recent = new Set(
      (
        await db.query<{ id: string }>(
          `select case when e.character_a = $1 then e.character_b else e.character_a end as id from episodes e
            where $1 in (e.character_a, e.character_b) and e.created_at > $2::timestamptz - make_interval(days => $3::int)
              and (e.character_a = any($4::text[]) or e.character_b = any($4::text[]))`,
          [c.id, now.toISOString(), LIFE_PARTNER_GAP_DAYS, castIds],
        )
      ).rows.map((r) => r.id),
    );
    const partner = pickLifePartner(cast, c.id, c.dates, recent);
    if (!partner) break;
    const res = await bookLifeDate(db, c, partner.id, env).catch((): { ok: false; error: string } => ({ ok: false, error: "threw" }));
    if (res.ok) {
      run.booked++;
      track("life_date_booked", { episode_id: res.id, character_id: c.id, partner_id: partner.id });
    } else {
      run.refused[res.error] = (run.refused[res.error] ?? 0) + 1;
    }
  }
  return run;
}

/**
 * One life date: the booking route as the owner (the legacy identity cookie, like the mixer run and scheduled dates), the
 * first date's format (lib/first-date.ts: the speed date unless FIRST_DATE_FORMAT says otherwise), public when the
 * character is, unlisted for a private one. The request is marked show-paid, which the route reads as house-paid: no free date
 * is reserved. The episode is then marked `met_via = 'life'` (the route chose "chosen", a by-name pick, for it).
 */
async function bookLifeDate(db: Db, c: Candidate, partnerId: string, env: Record<string, string | undefined>): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const req = markShowPaidRequest(
    new Request(MCP_CALL_URL, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${USER_COOKIE}=${c.owner_id}` },
      body: JSON.stringify({ character_id: c.id, partner_id: partnerId, format: firstDateFormat(env), visibility: c.visibility === "public" ? "public" : "unlisted" }),
    }),
  );
  const res = await postEpisode(req);
  const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!res.ok || !body.id) return { ok: false, error: body.error ?? `http_${res.status}` };
  await db.query(`update episodes set setup = jsonb_set(coalesce(setup, '{}'::jsonb), '{met_via}', to_jsonb($2::text)) where id = $1`, [body.id, LIFE_MET_VIA]);
  return { ok: true, id: body.id };
}

/* -------------------------------------------------- the text afterwards -------------------------------------------------- */

/** What the life text is built from (pure): the date as the character's side saw it. */
export type LifeDateEpisode = {
  ending: Ending;
  /** The cast member's name. */
  partner: string;
  venue: string | null;
  /** The character's own first-person reflection (lib/reflection.ts), when there is one. */
  reflection: string | null;
  /** The character's side of the outcome (episodes.sides), for the debrief's cue words. */
  mine: SideOutcome | null;
};

const quote = (s: string) => `"${s.replace(/\s+/g, " ").trim().slice(0, 80)}"`;

/**
 * The character's text after a life date (pure): where it went while the person was gone, how it ended (this one tells,
 * since the person wasn't there to watch), and one question. Three bubbles, never a guilt trip: it says what it did,
 * not what the person didn't do.
 */
export function lifeLines(ep: LifeDateEpisode): string[] {
  const them = firstNameOf(ep.partner);
  const where = ep.venue ? ` at ${venuePhrase(ep.venue)}` : "";
  const opener = `I went out with ${them}${where} while you were gone. The house set it up.`;
  const liked = ep.mine?.want_met?.trim() || null;
  const off = ep.mine?.dealbreaker_hit?.trim() || null;
  switch (ep.ending) {
    case "second_date":
      return [opener, ep.reflection ?? (liked ? `It went well. There was a moment around ${quote(liked)} where I caught myself smiling.` : `It went well. ${them} wants to see me again, and I think I do too.`), `Want me to see ${them} again?`];
    case "friends":
      return [opener, ep.reflection ?? (off ? `Nice enough, but the bit about ${quote(off)} put me off. Friends is where it lands.` : "Nice enough, honestly. Friends is where it lands."), "Should I let the house pick again, or do you have someone in mind?"];
    case "disaster":
      return [opener, ep.reflection ?? (off ? `${quote(off)} was the moment it went sideways. It did not recover.` : "It went about as badly as it could. I'm still a bit wound up."), "Next time, will you pick?"];
  }
}

type LifeAired = {
  id: string;
  ending: Ending;
  venue: string | null;
  created_at: Date | string;
  reflections: Reflections | null;
  sides: [SideOutcome, SideOutcome] | null;
  partner: string;
  /** The character's own name (side a: the route books the owner's character first). */
  name: string;
  owner_id: string;
  character_id: string;
  thread_id: string | null;
};

/**
 * When a date airs (lib/air.ts airEpisode, fire-and-forget): a life date's owner hears from their own character what
 * happened, if their thread with that very character is opted in (muted_proactive = false) and not paused, tagged
 * `life:<episode id>` (once, however the date is aired again). `life: false` for any other date, so the caller sends
 * the tease instead. Not to whoever aired it (`skip`). A date's own side is character_a: the route books the owner's
 * character first.
 */
export async function lifeTextAfterAir(db: Db, episodeId: string, opts: { now?: Date; skip?: readonly (string | null | undefined)[] } = {}): Promise<{ life: boolean; sent: number }> {
  const { rows } = await db.query<LifeAired>(
    `select e.id, e.ending, e.setup->>'venue' as venue, e.created_at, e.reflections, e.sides, b.name as partner, a.name, a.owner_id, a.id as character_id,
            (select t.id from companion_threads t where t.character_id = a.id and t.user_id = a.owner_id and t.muted_proactive = false and t.paused_at is null) as thread_id
       from episodes e
       join characters a on a.id = e.character_a
       join characters b on b.id = e.character_b
      where e.id = $1 and e.setup->>'met_via' = $2 and e.status = 'ready' and e.revealed_at is not null and a.owner_id is not null`,
    [episodeId, LIFE_MET_VIA],
  );
  const r = rows[0];
  if (!r) return { life: false, sent: 0 };
  const skip = new Set((opts.skip ?? []).filter((u): u is string => Boolean(u)));
  if (!r.thread_id || skip.has(r.owner_id)) return { life: true, sent: 0 };
  const lines = lifeLines({ ending: r.ending, partner: r.partner, venue: r.venue, reflection: r.reflections?.a?.trim() || null, mine: r.sides?.[0] ?? null });
  // A photo from the date they weren't there for (lib/date-photo.ts), with the text; DATE_PHOTO_TEXTS=0 leaves it out.
  const photo = textPhoto({ id: r.id, names: [r.name, r.partner], venue: r.venue, at: r.created_at });
  const posted = await postFromCharacter(db, { userId: r.owner_id, characterId: r.character_id, lines, now: opts.now, kind: "life", dedupeKey: `life:${r.id}`, photo }).catch(() => null);
  return { life: true, sent: posted ? 1 : 0 };
}

/* -------------------------------------------------- your character's week -------------------------------------------------- */

export type WeekDate = { episode_id: string; partner: string; ending: Ending; date_number: number | null; aired: boolean; life: boolean; at: string };
export type WeekCoupleTexts = { partner_id: string; partner: string; from_mine: number; from_theirs: number };
export type WeekShift = { partner_id: string; partner: string; before: number; now: number; shift: number };
export type WeekNext = { kind: "filming" | "scheduled"; partner: string | null; episode_id: string | null; at: string };

export type CharacterWeek = {
  character: { id: string; name: string };
  /** The week's dates, oldest first, with how each ended. */
  dates: WeekDate[];
  /** Texts the character sent its person this week (its companion thread). */
  texts_to_you: number;
  /** Who texted whom between dates (couple_texts), per partner. */
  couple_texts: WeekCoupleTexts[];
  /** The chemistry meter's move this week, per partner it dated this week (only pairs with a meter before the week). */
  shifts: WeekShift[];
  /** The next thing booked: a date being filmed, or one scheduled for later. */
  next: WeekNext | null;
  /** How many things happened: dates, texts, couple texts, the next booking. 0 means nothing to say. */
  events: number;
};

/**
 * The week for each of one person's characters (the last WEEK_DAYS days), from what already happened: no model call.
 * Characters with nothing this week come back with `events: 0`, so a caller can skip them.
 */
export async function weekOf(db: Db, userId: string, now = new Date()): Promise<CharacterWeek[]> {
  const since = new Date(now.getTime() - WEEK_DAYS * DAY_MS).toISOString();
  const mine = (await db.query<{ id: string; name: string }>(`select id, name from characters where owner_id = $1 and not is_house order by created_at`, [userId])).rows;
  if (!mine.length) return [];
  const ids = mine.map((c) => c.id);
  const [dates, texts, couple, nexts] = await Promise.all([
    db.query<{ character_id: string; episode_id: string; partner_id: string; partner: string; ending: Ending; date_number: number | null; aired: boolean; life: boolean; at: Date | string }>(
      `select c.id as character_id, e.id as episode_id, p.id as partner_id, p.name as partner, e.ending, (e.setup->>'date_number')::int as date_number,
              e.revealed_at is not null as aired, e.setup->>'met_via' = $3 as life, e.created_at as at
         from unnest($1::text[]) as c(id)
         join episodes e on c.id in (e.character_a, e.character_b)
         join characters p on p.id = case when e.character_a = c.id then e.character_b else e.character_a end
        where e.status = 'ready' and e.created_at > $2::timestamptz and e.created_at <= $4::timestamptz
          and coalesce((e.setup->>'after_dark')::boolean, false) = false
        order by e.created_at, e.id`,
      [ids, since, LIFE_MET_VIA, now.toISOString()],
    ),
    // One text is one event, however many bubbles it came in (every bubble of a text carries its tag, lib/companion.ts).
    db.query<{ character_id: string; n: number }>(
      `select t.character_id, count(distinct coalesce(m.action, m.id))::int as n from companion_threads t
         join companion_messages m on m.thread_id = t.id and m.role = 'character' and m.replaced_by is null
        where t.user_id = $1 and t.character_id = any($2::text[]) and m.created_at > $3::timestamptz and m.created_at <= $4::timestamptz
        group by t.character_id`,
      [userId, ids, since, now.toISOString()],
    ),
    db.query<{ character_id: string; partner_id: string; partner: string; from_mine: number; from_theirs: number }>(
      `select c.id as character_id, p.id as partner_id, p.name as partner,
              (count(*) filter (where (x.who = 'lo') = (x.character_lo = c.id)))::int as from_mine,
              (count(*) filter (where (x.who = 'lo') <> (x.character_lo = c.id)))::int as from_theirs
         from unnest($1::text[]) as c(id)
         join couple_texts x on c.id in (x.character_lo, x.character_hi)
         join characters p on p.id = case when x.character_lo = c.id then x.character_hi else x.character_lo end
        where x.created_at > $2::timestamptz and x.created_at <= $3::timestamptz
        group by c.id, p.id, p.name
        order by c.id, p.name`,
      [ids, since, now.toISOString()],
    ),
    db.query<{ character_id: string; kind: "filming" | "scheduled"; partner: string | null; episode_id: string | null; at: Date | string }>(
      `select c.id as character_id, 'filming' as kind, p.name as partner, e.id as episode_id, e.created_at as at
         from unnest($1::text[]) as c(id)
         join episodes e on c.id in (e.character_a, e.character_b) and e.status = 'generating'
         join characters p on p.id = case when e.character_a = c.id then e.character_b else e.character_a end
       union all
       select s.character_id, 'scheduled', p.name, null, s.run_at
         from scheduled_dates s left join characters p on p.id = s.partner_id
        where s.character_id = any($1::text[]) and s.ran_at is null and s.run_at > $2::timestamptz
       order by at`,
      [ids, now.toISOString()],
    ),
  ]);
  // The meter's move this week, per pair that dated this week: the running chemistry (lib/chemistry-shifts.ts) over every
  // aired date of the pair, against where it stood before the week. Owner's view: their own dates count, public or not.
  const pairs = [...new Set(dates.rows.filter((d) => d.aired).map((d) => `${d.character_id}|${d.partner_id}`))];
  const shifts = new Map<string, WeekShift[]>();
  for (const key of pairs) {
    const [cid, pid] = key.split("|");
    const { rows } = await db.query<{ chemistry: number | null; this_week: boolean }>(
      `select (e.box_score->'chemistry'->>'final')::float as chemistry, e.created_at > $3::timestamptz as this_week
         from episodes e
        where e.status = 'ready' and e.revealed_at is not null and e.created_at <= $4::timestamptz
          and ((e.character_a = $1 and e.character_b = $2) or (e.character_a = $2 and e.character_b = $1))
        order by e.created_at, e.id`,
      [cid, pid, since, now.toISOString()],
    );
    const before = runningChemistry(rows.filter((r) => !r.this_week).map((r) => r.chemistry));
    const after = runningChemistry(rows.map((r) => r.chemistry));
    if (before === null || after === null) continue;
    const shift = Math.round(after - before);
    if (!shift) continue;
    const partner = dates.rows.find((d) => d.character_id === cid && d.partner_id === pid)?.partner ?? "";
    shifts.set(cid, [...(shifts.get(cid) ?? []), { partner_id: pid, partner, before: Math.round(before), now: Math.round(after), shift }]);
  }
  const textsBy = new Map(texts.rows.map((r) => [r.character_id, r.n]));
  return mine.map((c) => {
    const myDates = dates.rows.filter((d) => d.character_id === c.id).map((d) => ({ episode_id: d.episode_id, partner: d.partner, ending: d.ending, date_number: d.date_number, aired: d.aired, life: d.life, at: new Date(d.at).toISOString() }));
    const myTexts = couple.rows.filter((r) => r.character_id === c.id).map(({ partner_id, partner, from_mine, from_theirs }) => ({ partner_id, partner, from_mine, from_theirs }));
    const n = nexts.rows.find((r) => r.character_id === c.id);
    const next: WeekNext | null = n ? { kind: n.kind, partner: n.partner, episode_id: n.episode_id, at: new Date(n.at).toISOString() } : null;
    const texts_to_you = textsBy.get(c.id) ?? 0;
    return {
      character: c,
      dates: myDates,
      texts_to_you,
      couple_texts: myTexts,
      shifts: shifts.get(c.id) ?? [],
      next,
      events: myDates.length + texts_to_you + myTexts.reduce((s, t) => s + t.from_mine + t.from_theirs, 0) + (next ? 1 : 0),
    };
  });
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** One character's week as a sentence or two (pure), in the show's voice: present tense, names, no database captions. */
export function weekSentence(w: CharacterWeek): string {
  const me = firstNameOf(w.character.name);
  // Each part reads with the character as its subject; the first carries the name.
  const parts: string[] = [];
  if (w.dates.length) {
    const outings = w.dates.map((d) => `${firstNameOf(d.partner)} (${d.aired ? endingLabel(d.ending, d.date_number).toLowerCase() : "not aired yet"}${d.life ? ", the house set it up" : ""})`);
    parts.push(`went out with ${list(outings)}`);
  }
  if (w.texts_to_you) parts.push(`texted you ${w.texts_to_you === 1 ? "once" : w.texts_to_you === 2 ? "twice" : `${w.texts_to_you} times`}`);
  for (const t of w.couple_texts) {
    const them = firstNameOf(t.partner);
    if (t.from_mine && t.from_theirs) parts.push(`traded ${plural(t.from_mine + t.from_theirs, "text")} with ${them}`);
    else if (t.from_mine) parts.push(`texted ${them} ${plural(t.from_mine, "time")} with no answer yet`);
    else parts.push(`heard from ${them} ${plural(t.from_theirs, "time")} and hasn't answered`);
  }
  for (const s of w.shifts) parts.push(`chemistry with ${firstNameOf(s.partner)} is ${s.shift > 0 ? "up" : "down"} ${Math.abs(s.shift)} to ${s.now}`);
  if (w.next) parts.push(w.next.kind === "filming" ? `is on a date with ${w.next.partner ? firstNameOf(w.next.partner) : "someone new"} right now` : `has a date with ${w.next.partner ? firstNameOf(w.next.partner) : "a blind date"} coming up`);
  if (!parts.length) return `${me}: a quiet week.`;
  return `${me} ${parts.join("; ")}.`;
}

/** The recap's title and body (pure), for one person's characters with something to tell. */
export function characterWeekNotice(weeks: readonly CharacterWeek[]): { title: string; body: string; link: string } | null {
  const busy = weeks.filter((w) => w.events > 0);
  if (!busy.length) return null;
  const lead = [...busy].sort((x, y) => y.events - x.events)[0];
  const dates = busy.reduce((s, w) => s + w.dates.length, 0);
  const texts = busy.reduce((s, w) => s + w.texts_to_you, 0);
  const what = [dates ? plural(dates, "date") : null, texts ? plural(texts, "text", "texts") + " to you" : null].filter(Boolean).join(", ");
  const title = busy.length === 1 ? `📺 ${firstNameOf(lead.character.name)}'s week on the show${what ? `: ${what}` : ""}` : `📺 Your characters' week on the show${what ? `: ${what}` : ""}`;
  return { title, body: busy.map(weekSentence).join(" "), link: `/characters/${lead.character.id}` };
}

/** Whether `now` is the recap's day: Sunday, UTC (the daily job runs once a day). */
export const isRecapDay = (now: Date): boolean => now.getUTCDay() === 0;

/**
 * Sunday's recap (the daily job's people part, before the digest so the same day's email carries it): one
 * `character_week` notice per owner whose characters had at least one event this week, once a week (a second run the
 * same day finds the notice and sends nothing). Never to our own identities, never to the house. notify() honours
 * their type mutes (lib/notification-mutes.ts). Returns how many went out; 0 on any other day unless `force`.
 */
export async function sendCharacterWeeks(db: Db, now = new Date(), opts: { force?: boolean; limit?: number } = {}): Promise<number> {
  if (!opts.force && !isRecapDay(now)) return 0;
  const since = new Date(now.getTime() - WEEK_DAYS * DAY_MS).toISOString();
  // Owners with a character that dated, got a text from its own character, or texted a partner this week.
  const { rows } = await db.query<{ owner_id: string }>(
    `select distinct c.owner_id from characters c
      where not c.is_house and c.owner_id is not null and c.owner_id <> $1
        -- A step-in "you" (lib/step-in-shared.ts PERSONA_OWNER_PREFIX) is a person on one date, not a character with a week.
        and c.owner_id not like 'you:%'
        and (exists (select 1 from episodes e where c.id in (e.character_a, e.character_b) and e.status = 'ready' and e.created_at > $2::timestamptz)
          or exists (select 1 from companion_threads t join companion_messages m on m.thread_id = t.id
                      where t.character_id = c.id and t.user_id = c.owner_id and m.role = 'character' and m.created_at > $2::timestamptz)
          or exists (select 1 from couple_texts x where c.id in (x.character_lo, x.character_hi) and x.created_at > $2::timestamptz))
        and not exists (select 1 from notifications n where n.user_id = c.owner_id and n.kind = 'character_week' and n.created_at > $2::timestamptz)
      order by c.owner_id limit $3`,
    [DELETED_OWNER, since, opts.limit ?? WEEK_BATCH],
  );
  if (!rows.length) return 0;
  const ours = new Set(await loadOurIds(db).catch(() => [] as string[]));
  let sent = 0;
  for (const { owner_id } of rows) {
    if (ours.has(owner_id)) continue;
    const notice = characterWeekNotice(await weekOf(db, owner_id, now).catch(() => []));
    if (!notice) continue;
    await notify(db, owner_id, { kind: "character_week", ...notice });
    sent++;
  }
  return sent;
}
