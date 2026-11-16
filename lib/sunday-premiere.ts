/**
 * The Sunday premiere (brief F, 2026-11-16; docs/sunday-premiere.md): the show's appointment, one time a week when
 * everyone watches the same date together.
 *
 *  - WEEKLY. On every ceremony Sunday of a lead season (lib/season-format.ts ceremonySundays), the lead's last-chance
 *    date with the suitor in most danger premieres in a shared room at PREMIERE_HOUR_UTC (23: 6 pm US Eastern, 3 pm
 *    Pacific). The suitor is the bottom of the lead's verdicts since the last ceremony (lib/ceremony.ts leadVerdicts,
 *    the window the ceremony itself reads), a tie going to whoever the lead saw least. The ceremony is held on the same
 *    hour's :20 pass (lib/ceremony.ts ceremonyHourUtc), after the premiere's decision at :04, so it counts that date.
 *  - PILOT. The Sunday before a lead season starts, "Meet the lead": the coming season's lead (the admin's pick,
 *    season_leads, as open casting reads the preseason) dates the top of its casting shortlist (lib/auditions.ts), else
 *    the house's first suitor (lib/season-cast.ts houseSuitorFill). Same room, same path, no ceremony. PREMIERE_PILOT=0
 *    leaves it out. Back-to-back lead seasons: the finale's premiere is that Sunday's, and there is no pilot.
 *  - HOW. The hourly lobby job's pass the hour before (22:20 for 23:00) claims the Sunday's row, picks the suitor and
 *    builds the date through the path template rooms take (lib/watch.ts createTemplateParty: engine, pipeline, PG
 *    checks; the house pays within the paid daily cap, and the cost is tracked as a template date's). Then the room
 *    becomes a premiere with starts_at = the premiere time, so it plays for everyone at once. The date is held until
 *    the room's decision and airs as watch-party dates do (lib/air.ts); the first pass after the decision airs it if no
 *    viewer's room has, before the ceremony reads the week. Once a Sunday: the row is the claim, BUILD_TRIES at most.
 *  - WHO HEARS, once, right after the build (about 40 minutes before): the suitor's owner (a person's character: they
 *    applied to the season, so no new consent is asked), anyone following the lead or the suitor
 *    (lib/character-follows.ts), and anyone who gets the show's news: browser notifications on and The show not muted
 *    (the site has no other show-news opt-in). One `premiere` notice a person, under The show, so a mute holds
 *    (lib/notifications.ts notify: stored read, no push). At most PREMIERE_NOTICE_CAP a Sunday.
 *  - Nothing here touches an ending, points or odds: the engine decides the date like any other, and the ceremony reads
 *    it like any other. Before it airs nobody sees how it ends.
 *
 * SUNDAY_PREMIERE=0 turns all of it off, and the ceremony goes back to its own hour (20, or CEREMONY_HOUR_UTC). The cost:
 * one house date a week, plus the pilot: about 5 cents each on the paid default (up to 10 with the showcase retake).
 */
import { airIfDue, WATCH_DECISION_SECONDS } from "./air";
import { track } from "./analytics";
import { ceremonyRunsAt, houseOf, leadVerdicts, verdictsSince, type Verdict } from "./ceremony";
import type { Db } from "./db";
import { shortName } from "./names";
import { notify, notifyAll } from "./notifications";
import { portraitPathSql } from "./portrait-sql";
import {
  pilotSundayFor,
  premiereAt,
  premiereHourUtc,
  premierePilotOn,
  premiereTimeWords,
  sundayPremiereOn,
  type NextPremiere,
  type PremiereFace,
  type PremiereKind,
} from "./premiere-clock";
import { DELETED_OWNER, WATCH_PHASES } from "./rules";
import { ceremonySundays, seasonFormat, twistOf, type SeasonFormatDef } from "./season-format";
import { seasonFormatNow } from "./season-format-store";
import { nextSeasonStart, seasonIdOf } from "./season-window";
import type { TemplateOpts } from "./watch";

export type { NextPremiere, PremiereFace, PremiereKind } from "./premiere-clock";

type Env = Record<string, string | undefined>;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const dayId = (d: Date): string => d.toISOString().slice(0, 10);
/** How long a room plays, from its start to its last phase (lib/watch.ts LAST_AT). */
const ROOM_SECONDS = WATCH_PHASES[WATCH_PHASES.length - 1].at;

/** The pass that builds a premiere runs from this long before it starts (the job's :20 pass the hour before)... */
export const BUILD_FROM_MINUTES = 60;
/** ...until this long before: a room built later would start before anyone heard of it. */
export const BUILD_UNTIL_MINUTES = 5;
/** Tries one Sunday may take at building its date (a model failure, or a room started in between, takes a second). */
export const BUILD_TRIES = 2;
/** A claim this old with nothing built is a pass that died: a later pass in the window may take it again. */
const CLAIM_STALE_MS = 10 * MINUTE_MS;
/** The most people one premiere's notices go to: the suitor's owner and the followers first, then the show's news. */
export const PREMIERE_NOTICE_CAP = 200;

/** A Sunday that premieres, before anything is built: when, which kind, whose season and format, and its lead. */
export type PremiereSlot = {
  sunday: string;
  at: Date;
  kind: PremiereKind;
  season_id: string;
  format: SeasonFormatDef;
  lead: PremiereFace;
  /** The season's last Sunday (the finale's premiere comes before the final rose). */
  finale: boolean;
};

type LeadRow = PremiereFace & { season_id: string; src: "cast" | "pick" };

/**
 * The Sundays that premiere, from this season's on, in order: this season's ceremony Sundays when it runs a lead format
 * with a lead on its cast (or picked for it); the coming season's pilot and ceremony Sundays when it is picked as a lead
 * format (the stored row: the viewers' ballot can still move until the 1st) with its lead picked. One round trip.
 */
export async function premiereSlots(db: Db, now: Date = new Date(), env: Env = process.env): Promise<PremiereSlot[]> {
  if (!sundayPremiereOn(env)) return [];
  const thisSeason = seasonIdOf(now);
  const nextStart = nextSeasonStart(now);
  const nextSeason = seasonIdOf(nextStart);
  const [thisDef, nextRow, leads] = await Promise.all([
    seasonFormatNow(db, now),
    db.query<{ slug: string }>(`select slug from season_formats where season_id = $1`, [nextSeason]),
    db.query<LeadRow>(
      `select s.season_id, 'cast' as src, c.id, c.name, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait, c.is_house as house
         from season_casts s join characters c on c.id = s.character_id
        where s.season_id = $1 and s.source = 'lead'
       union all
       select l.season_id, 'pick' as src, c.id, c.name, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait, c.is_house as house
         from season_leads l join characters c on c.id = l.character_id
        where l.season_id = any($2::text[]) and c.is_house and c.premium_sku is null and c.visibility = 'public'`,
      [thisSeason, [thisSeason, nextSeason]],
    ),
  ]);
  const face = (r: LeadRow): PremiereFace => ({ id: r.id, name: r.name, hue: r.hue ?? null, portrait: r.portrait ?? null, house: r.house });
  const leadOf = (season: string, ...srcs: LeadRow["src"][]) => srcs.map((src) => leads.rows.find((r) => r.season_id === season && r.src === src)).find(Boolean) ?? null;
  const out: PremiereSlot[] = [];
  const weekly = (def: SeasonFormatDef, seasonId: string, lead: LeadRow, inSeason: Date) => {
    const sundays = ceremonySundays(def, inSeason);
    for (const sunday of sundays) {
      out.push({ sunday, at: premiereAt(sunday, env), kind: "weekly", season_id: seasonId, format: def, lead: face(lead), finale: sunday === sundays[sundays.length - 1] });
    }
  };
  const thisLead = leadOf(thisSeason, "cast", "pick");
  if (thisDef.lead && thisLead) weekly(thisDef, thisSeason, thisLead, now);
  const nextDef = nextRow.rows[0] ? seasonFormat(nextRow.rows[0].slug) : null;
  const nextLead = leadOf(nextSeason, "pick");
  if (nextDef?.lead && nextLead) {
    const pilot = pilotSundayFor(nextStart);
    if (premierePilotOn(env) && !out.some((s) => s.sunday === pilot)) {
      out.push({ sunday: pilot, at: premiereAt(pilot, env), kind: "pilot", season_id: nextSeason, format: nextDef, lead: face(nextLead), finale: false });
    }
    weekly(nextDef, nextSeason, nextLead, nextStart);
  }
  return out.sort((x, y) => x.sunday.localeCompare(y.sunday));
}

type PremiereRow = {
  held_on: string;
  season_id: string;
  kind: PremiereKind;
  lead_id: string;
  suitor_id: string | null;
  party_id: string | null;
  episode_id: string | null;
  claimed_at: Date | string | null;
  built_at: Date | string | null;
  notified_at: Date | string | null;
  tries: number;
  note: string | null;
};

const ROW = `held_on, season_id, kind, lead_id, suitor_id, party_id, episode_id, claimed_at, built_at, notified_at, tries, note`;
const rowOf = async (db: Db, sunday: string): Promise<PremiereRow | null> =>
  (await db.query<PremiereRow>(`select ${ROW} from premieres where held_on = $1`, [sunday])).rows[0] ?? null;
const isBuilt = (r: PremiereRow | null | undefined): boolean => Boolean(r?.party_id && r.built_at);

/**
 * When the roses follow a premiere: its Sunday's ceremony (lib/ceremony.ts ceremonyRunsAt), which is held on the finale
 * and on any Sunday with more than two suitors in (two left wait for the finale). Null for the pilot, and for a week
 * with two left. A coming season's cast is picked when it starts, so its Sundays count as ceremonies.
 */
function rosesAt(slot: PremiereSlot, suitorsIn: number, thisSeason: string, env: Env): Date | null {
  if (slot.kind !== "weekly") return null;
  return slot.finale || slot.season_id !== thisSeason || suitorsIn > 2 ? ceremonyRunsAt(slot.sunday, env) : null;
}

/**
 * The next Sunday premiere, for any page (the season page, home's tonight band, /watch's Botchelor card, the admin's
 * line): when, which kind, the lead, and once the pass the hour before has built it, the suitor and the room. It stays
 * the next one until its room's last phase, then the following Sunday's takes its place. A Sunday whose build failed
 * (its row says why) is skipped, and so is one still unbuilt at its start. Null with the switch off or no lead season
 * ahead. Two round trips at most (the season's format, read once per page), no model call.
 */
export async function nextPremiere(db: Db, now: Date = new Date(), env: Env = process.env): Promise<NextPremiere | null> {
  if (!sundayPremiereOn(env)) return null;
  const today = dayId(now);
  const thisSeason = seasonIdOf(now);
  const [slots, rows, house] = await Promise.all([
    premiereSlots(db, now, env),
    db.query<PremiereRow & { suitor: PremiereFace | null }>(
      `select ${ROW.split(", ").map((c) => `p.${c}`).join(", ")},
              case when s.id is null then null
                   else json_build_object('id', s.id, 'name', s.name, 'hue', s.avatar_hue, 'portrait', ${portraitPathSql("s")}, 'house', s.is_house) end as suitor
         from premieres p left join characters s on s.id = p.suitor_id and s.visibility = 'public'
        where p.held_on >= $1 order by p.held_on limit 8`,
      [today],
    ),
    houseOf(db, thisSeason).catch(() => ({ lead: null, suitors: [] as string[] })),
  ]);
  const t = now.getTime();
  for (const slot of slots) {
    if (slot.sunday < today) continue;
    const row = rows.rows.find((r) => r.held_on === slot.sunday) ?? null;
    const built = isBuilt(row);
    const at = slot.at.getTime();
    if (built ? t >= at + ROOM_SECONDS * 1000 : t >= at || Boolean(row?.note)) continue;
    return {
      sunday: slot.sunday,
      at: slot.at.toISOString(),
      time_words: premiereTimeWords(slot.at),
      kind: slot.kind,
      season_id: slot.season_id,
      lead: slot.lead,
      suitor: built ? (row!.suitor ?? null) : null,
      room_path: built ? `/watch/${row!.party_id}` : null,
      episode_id: built ? row!.episode_id : null,
      roses_at: rosesAt(slot, house.suitors.length, thisSeason, env)?.toISOString() ?? null,
      finale: slot.finale,
      state: !built ? "scheduled" : t >= at ? "live" : "built",
    };
  }
  return null;
}

/**
 * The suitor in most danger: the bottom of the lead's verdicts (lib/ceremony.ts leadVerdicts, worst first: the lowest
 * score, then the fewest "see again"), except that a tie goes to whoever the lead saw least, where the ceremony's own
 * tie sends home whoever the lead saw most. A suitor not dated in the window scores lowest of all. Pure.
 */
export function pickInDanger(verdicts: readonly Verdict[]): Verdict | null {
  return [...verdicts].sort((x, y) => x.score - y.score || x.see_again - y.see_again || x.dates - y.dates)[0] ?? null;
}

/**
 * Who the lead dates on a Sunday's premiere at `now`. Weekly: the suitor in most danger among those still in (a person's
 * character closed to dates since it was cast sits it out: no consent is assumed back). The pilot: the top of the
 * coming season's shortlist, else the house's first suitor. Null when there is nobody. Reads only.
 */
export async function premiereSuitor(db: Db, slot: PremiereSlot, now: Date = new Date()): Promise<string | null> {
  if (slot.kind === "pilot") {
    const { shortlist } = await import("./auditions");
    const fans = (await shortlist(db, slot.season_id)).filter((id) => id !== slot.lead.id);
    if (fans[0]) return fans[0];
    const { houseSuitorFill } = await import("./season-cast");
    return (await houseSuitorFill(db, [slot.lead.id], 1))[0] ?? null;
  }
  const { suitors } = await houseOf(db, slot.season_id);
  if (!suitors.length) return null;
  const open = new Set(
    (await db.query<{ id: string }>(`select id from characters where id = any($1) and (is_house or open_to_dates)`, [suitors])).rows.map((r) => r.id),
  );
  const eligible = suitors.filter((s) => open.has(s) && s !== slot.lead.id);
  if (!eligible.length) return null;
  const since = await verdictsSince(db, slot.season_id, slot.sunday, slot.finale, now);
  return pickInDanger(await leadVerdicts(db, slot.lead.id, eligible, since, now))?.suitor ?? null;
}

/** The thumbs a premiere's date is built with: its week's twist and the format's venues (the pilot: the season's first week). */
function thumbsOf(slot: PremiereSlot): TemplateOpts {
  const twist = twistOf(slot.format, new Date(`${slot.kind === "pilot" ? slot.season_id : slot.sunday}T12:00:00Z`));
  return {
    ...(twist?.format ? { format: twist.format } : {}),
    ...(twist?.producer ? { producer: twist.producer } : {}),
    ...(slot.format.venues ? { venuePool: slot.format.venues } : {}),
  };
}

type Built = { ok: true; party_id: string; episode_id: string } | { ok: false; note: string };

/**
 * Builds the date the way the lobby's house dates are built (lib/watch.ts createTemplateParty), then turns its room into
 * the premiere: kind 'premiere', starts_at the premiere time. A try that made no date (the model failed) is tried once
 * more; so is one whose room someone started in the moment between (that date plays as an open room). A date whose
 * line-by-line conversation failed is kept: its room plays the acts, and the daily job fills its lines for the replay
 * (lib/backfill.ts), where a second date would leave the first one airing beside it. Each try is counted on the row first.
 */
async function buildRoom(db: Db, slot: PremiereSlot, suitor: string, triedBefore: number): Promise<Built> {
  const { createTemplateParty } = await import("./watch");
  let note = "no_date";
  for (let tried = triedBefore; tried < BUILD_TRIES; tried++) {
    await db.query(`update premieres set tries = tries + 1 where held_on = $1`, [slot.sunday]);
    const made = await createTemplateParty(db, slot.lead.id, suitor, thumbsOf(slot)).catch(() => null);
    if (!made || !made.ok) {
      note = made && !made.ok ? made.error : "no_date";
      if (made && !made.ok && made.status === 503) break; // the show is paused: no try will do better this pass
      continue;
    }
    const turned = await db.query<{ episode_id: string }>(
      `update watch_parties set kind = 'premiere', starts_at = $2 where id = $1 and kind = 'template' and starts_at is null returning episode_id`,
      [made.id, slot.at.toISOString()],
    );
    if (!turned.rows[0]) {
      note = "started_early";
      continue;
    }
    return { ok: true, party_id: made.id, episode_id: turned.rows[0].episode_id };
  }
  return { ok: false, note };
}

const monthOf = (seasonId: string): string => new Date(`${seasonId}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
const hhmm = (d: Date): string => `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;

/** The words of a premiere's notices: one for the suitor's owner, one for everyone else. `roses`: when the ceremony follows (null: none tonight). Pure. */
export function premiereNotices(slot: PremiereSlot, lead: string, suitor: string, roses: Date | null): { owner: { title: string; body: string }; audience: { title: string; body: string } } {
  const L = shortName(lead);
  const S = shortName(suitor);
  const when = premiereTimeWords(slot.at);
  if (slot.kind === "pilot") {
    const month = monthOf(slot.season_id);
    return {
      owner: {
        title: `📺 ${S} has the pilot: a first date with ${L}`,
        body: `Meet the lead: ${L}, ${month}'s lead on ${slot.format.title}, goes on a first date with ${S} at ${when}, live in one room on Watch, where everyone sees it at the same time. No roses tonight: the season starts on 1 ${month}. How it ends is the engine's, as on every date.`,
      },
      audience: {
        title: `📺 Tonight's pilot: meet ${L}`,
        body: `${L}, ${month}'s lead on ${slot.format.title}, goes on a first date with ${S} at ${when}, live in one room on Watch.`,
      },
    };
  }
  const last = slot.finale ? "last date before the final rose" : "last-chance date of the week";
  const after = roses ? ` ${slot.finale ? "The final rose follows" : "The roses follow"} at ${hhmm(roses)}.` : "";
  return {
    owner: {
      title: `📺 ${S} has Sunday's premiere date with ${L}`,
      body: `${L}'s ${last} is with ${S}, and it premieres at ${when}, live in one room on Watch, where everyone sees it at the same time.${after} How it ends is the engine's, as on every date.`,
    },
    audience: {
      title: `📺 Tonight's premiere: ${L} × ${S}`,
      body: `${L}'s ${last}, with ${S}, premieres at ${when}, live in one room on Watch.${after}`,
    },
  };
}

/**
 * The premiere's notices, once (the row's notified_at is claimed before any goes out): the suitor's owner, then anyone
 * following the lead or the suitor, then the show's news (browser notifications on, The show not muted), each person
 * once, PREMIERE_NOTICE_CAP in all. Returns how many people were sent one.
 */
async function tellPremiere(db: Db, slot: PremiereSlot, suitorId: string, roomPath: string, env: Env): Promise<number> {
  const claimed = await db.query(`update premieres set notified_at = now() where held_on = $1 and notified_at is null returning held_on`, [slot.sunday]);
  if (!claimed.rows.length) return 0;
  const { rows } = await db.query<{ id: string; name: string; owner_id: string | null; is_house: boolean }>(
    `select id, name, owner_id, is_house from characters where id = any($1)`,
    [[slot.lead.id, suitorId]],
  );
  const lead = rows.find((r) => r.id === slot.lead.id);
  const suitor = rows.find((r) => r.id === suitorId);
  if (!lead || !suitor) return 0;
  const suitorsIn = slot.kind === "weekly" ? (await houseOf(db, slot.season_id)).suitors.length : 0;
  const words = premiereNotices(slot, lead.name, suitor.name, rosesAt(slot, suitorsIn, slot.season_id, env));
  const owner = !suitor.is_house && suitor.owner_id && suitor.owner_id !== DELETED_OWNER ? suitor.owner_id : null;
  const { characterFollowers } = await import("./character-follows");
  const [followers, news] = await Promise.all([
    characterFollowers(db, [slot.lead.id, suitorId], env).catch(() => new Map<string, string[]>()),
    db
      .query<{ user_id: string }>(
        `select distinct p.user_id from push_subscriptions p
          where p.user_id <> $2 and not exists (select 1 from notification_mutes m where m.user_id = p.user_id and m.type = 'show')
          order by p.user_id limit $1`,
        [PREMIERE_NOTICE_CAP, DELETED_OWNER],
      )
      .then((r) => r.rows.map((x) => x.user_id))
      .catch(() => [] as string[]),
  ]);
  let sent = 0;
  if (owner) {
    await notify(db, owner, { kind: "premiere", ...words.owner, link: roomPath });
    sent = 1;
  }
  const everyone = [...new Set([...[...followers.values()].flat(), ...news])].filter((u) => u && u !== owner && u !== DELETED_OWNER).slice(0, PREMIERE_NOTICE_CAP - sent);
  await notifyAll(db, everyone, { kind: "premiere", ...words.audience, link: roomPath });
  return sent + everyone.length;
}

export type PremiereRun = {
  sunday: string;
  kind: PremiereKind;
  /** The room is built (this pass or an earlier one). */
  built: boolean;
  room_path: string | null;
  suitor_id: string | null;
  /** People this pass sent the notice to. */
  notified: number;
  /** This pass aired the date, after its decision, because no viewer's room had. */
  aired: boolean;
  /** Why nothing was built: claimed (another pass has it), no_suitor, or the build's failure. */
  note: string | null;
};

/**
 * The hourly lobby job's part, on Sundays only (no query on any other day): in the pass the hour before a premiere,
 * claim the Sunday, pick the suitor, build the room and send the notices; in the first pass after its decision, air the
 * date if no viewer's room has, before the ceremony that follows in the same pass reads the week. Idempotent: the row
 * is the claim, and a built Sunday is never built again. Null when nothing was due.
 */
export async function runSundayPremiere(db: Db, now: Date = new Date(), env: Env = process.env): Promise<PremiereRun | null> {
  if (!sundayPremiereOn(env) || now.getUTCDay() !== 0) return null;
  const today = dayId(now);
  const slot = (await premiereSlots(db, now, env)).find((s) => s.sunday === today);
  if (!slot) return null;
  const at = slot.at.getTime();
  const t = now.getTime();
  const run: PremiereRun = { sunday: today, kind: slot.kind, built: false, room_path: null, suitor_id: null, notified: 0, aired: false, note: null };
  if (t >= at + WATCH_DECISION_SECONDS * 1000) {
    const row = await rowOf(db, today);
    if (!row || !isBuilt(row) || !row.episode_id) return null;
    run.aired = Boolean(await airIfDue(db, row.episode_id, env).catch(() => null));
    return { ...run, built: true, room_path: `/watch/${row.party_id}`, suitor_id: row.suitor_id };
  }
  if (t < at - BUILD_FROM_MINUTES * MINUTE_MS || t >= at - BUILD_UNTIL_MINUTES * MINUTE_MS) return null;

  const have = await rowOf(db, today);
  if (have && isBuilt(have)) {
    // Built by a pass that stopped before its notices: they go now, still before the start.
    const notified = have.notified_at ? 0 : await tellPremiere(db, slot, have.suitor_id!, `/watch/${have.party_id}`, env).catch(() => 0);
    return { ...run, built: true, room_path: `/watch/${have.party_id}`, suitor_id: have.suitor_id, notified };
  }
  const claim = (
    await db.query<{ tries: number }>(
      `insert into premieres (held_on, season_id, kind, lead_id, starts_at, claimed_at) values ($1, $2, $3, $4, $5, $6)
       on conflict (held_on) do update set claimed_at = excluded.claimed_at, note = null
         where premieres.built_at is null and premieres.tries < $7 and (premieres.claimed_at is null or premieres.claimed_at < $8)
       returning tries`,
      [today, slot.season_id, slot.kind, slot.lead.id, slot.at.toISOString(), now.toISOString(), BUILD_TRIES, new Date(t - CLAIM_STALE_MS).toISOString()],
    )
  ).rows[0];
  if (!claim) return { ...run, note: "claimed" };
  const suitor = await premiereSuitor(db, slot, now).catch(() => null);
  if (!suitor) {
    await db.query(`update premieres set note = 'no_suitor' where held_on = $1`, [today]);
    return { ...run, note: "no_suitor" };
  }
  await db.query(`update premieres set suitor_id = $2 where held_on = $1`, [today, suitor]);
  const built = await buildRoom(db, slot, suitor, claim.tries);
  if (!built.ok) {
    await db.query(`update premieres set note = $2 where held_on = $1`, [today, built.note]);
    return { ...run, suitor_id: suitor, note: built.note };
  }
  await db.query(`update premieres set party_id = $2, episode_id = $3, built_at = $4, note = null where held_on = $1`, [today, built.party_id, built.episode_id, now.toISOString()]);
  const roomPath = `/watch/${built.party_id}`;
  const notified = await tellPremiere(db, slot, suitor, roomPath, env).catch(() => 0);
  const tries = (await rowOf(db, today))?.tries ?? 1;
  track("premiere_built", { sunday: today, kind: slot.kind, party_id: built.party_id, episode_id: built.episode_id, tries, notified });
  return { ...run, built: true, room_path: roomPath, suitor_id: suitor, notified };
}

/**
 * The Sunday letter's line (lib/newsletter-issue.ts): next Sunday's premiere, from the letter's own Sunday. Null when
 * that Sunday has none.
 */
export type LetterPremiere = { sunday: string; at: string; time_words: string; kind: PremiereKind; lead: string; month: string; format_title: string; finale: boolean };
export async function letterPremiere(db: Db, week: string, now: Date = new Date(), env: Env = process.env): Promise<LetterPremiere | null> {
  const next = dayId(new Date(Date.parse(`${week}T00:00:00Z`) + 7 * DAY_MS));
  const slot = (await premiereSlots(db, now, env)).find((s) => s.sunday === next);
  return slot
    ? {
        sunday: slot.sunday,
        at: slot.at.toISOString(),
        time_words: premiereTimeWords(slot.at),
        kind: slot.kind,
        lead: slot.lead.name,
        month: monthOf(slot.season_id),
        format_title: slot.format.title,
        finale: slot.finale,
      }
    : null;
}

/** /admin/season's quiet line: the switches, the next premiere, its suitor (or who it would be right now) and whether it's built. */
export type PremiereAdmin = {
  switched_on: boolean;
  pilot_on: boolean;
  hour: number;
  next: NextPremiere | null;
  /** Before the build: who the pass would pick if it ran now (the verdicts can still move until then). */
  would_pick: { id: string; name: string } | null;
  /** The newest Sunday with a row: what happened (built, or why not). */
  last: { sunday: string; kind: PremiereKind; built: boolean; room_path: string | null; suitor: string | null; note: string | null; tries: number } | null;
};

export async function premiereAdminView(db: Db, now: Date = new Date(), env: Env = process.env): Promise<PremiereAdmin> {
  const switched_on = sundayPremiereOn(env);
  const base = { switched_on, pilot_on: premierePilotOn(env), hour: premiereHourUtc(env) };
  if (!switched_on) return { ...base, next: null, would_pick: null, last: null };
  const [next, slots, lastRow] = await Promise.all([
    nextPremiere(db, now, env),
    premiereSlots(db, now, env),
    db.query<PremiereRow & { suitor_name: string | null }>(
      `select ${ROW.split(", ").map((c) => `p.${c}`).join(", ")}, s.name as suitor_name from premieres p left join characters s on s.id = p.suitor_id order by p.held_on desc limit 1`,
    ),
  ]);
  let would_pick: PremiereAdmin["would_pick"] = null;
  const slot = next && next.state === "scheduled" ? slots.find((s) => s.sunday === next.sunday) : null;
  if (slot) {
    const id = await premiereSuitor(db, slot, now).catch(() => null);
    const name = id ? (await db.query<{ name: string }>(`select name from characters where id = $1`, [id])).rows[0]?.name : null;
    would_pick = id ? { id, name: name ?? id } : null;
  }
  const r = lastRow.rows[0];
  const last = r
    ? { sunday: r.held_on, kind: r.kind, built: isBuilt(r), room_path: isBuilt(r) ? `/watch/${r.party_id}` : null, suitor: r.suitor_name, note: r.note, tries: r.tries }
    : null;
  return { ...base, next, would_pick, last };
}
