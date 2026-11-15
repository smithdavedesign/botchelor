/**
 * The rose ceremony (lib/season-format.ts 'botchelor'; David 2026-11-14: December's format is the show's own premise,
 * run original). On a Botchelor season one lead from the cast dates people's characters, the suitors, all week
 * (lib/season-cast.ts leadAndSuitors: the lobby's house dates and tonight's situation deal the lead with a suitor in
 * turn), and every Sunday at CEREMONY_HOUR_UTC the hourly lobby job holds a ceremony:
 *
 *  - Two go home a week until two remain, then the last Sunday is the finale. (a) The audience's vote, "Who goes home?",
 *    open from Thursday (VOTE_OPEN_DAYS before) until the ceremony, one changeable vote a viewer, the ballot frozen
 *    when it opens, sends one suitor home. (b) The lead's own verdicts send another: the ending kinds of the week's
 *    dates between them (a second date beats friends beats a disaster), ties by the lead's own "see again" answer on
 *    those dates (episodes.sides, the living-dates engine), then by who the lead saw least. A suitor the lead didn't
 *    date all week ranks last. With three left only one can go: the audience decides. Nobody voted: the lead's dates
 *    decide both, and every place that tells it says so (the counts are published either way).
 *  - The finale: the lead's pick is the suitor with the better ending record over the whole season; the season recap
 *    bills it as "The final rose" (lib/season-recap.ts). Everyone else left gets "runner-up".
 *  - A suitor sent home leaves the cast at once (season_casts.withdrawn_at, as an owner's withdrawal does), keeps a
 *    "Season N suitor" badge (suitor_badges), and their owner hears: a notification, and, when they opted in to hear
 *    from their character (companion_threads.muted_proactive = false), the character's own text about it
 *    (lib/companion.ts postFromCharacter; the tag keeps it to one).
 *  - The ceremony itself is rows and templates ($0, no model call): the row (ceremonies) says who went home and why,
 *    and the /watch card and a `ceremony_held` notification tell it in the show's voice. The engine decided every
 *    date; the ceremony only reads the endings. Nothing here touches points, odds, pairings or endings.
 *  - Walk-ons (lib/casting.ts, open casting): people's new characters whose first date went to the lead get their own
 *    Sunday roses, outside the house: the card's "Walk-ons this week" line and the finale's "people's rose" come from there.
 */
import { portraitPathSql } from "./portrait-sql";
import type { Db } from "./db";
import { shortName } from "./names";
import { notify, notifyAll } from "./notifications";
import type { Ending } from "./rules";
import { forgetLoadedSeasonCast } from "./season-cast";
import { ceremonySundays, nextCeremonySunday, type SeasonFormatDef } from "./season-format";
import { seasonFormatNow } from "./season-format-store";
import { seasonNumber } from "./season-ref";
import { seasonIdOf, seasonWindow } from "./season-window";
import { winnerOf } from "./situations";
import { venuePhrase } from "./venues";

/** How many days before a Sunday its vote opens (Thursday). */
export const VOTE_OPEN_DAYS = 3;
/** The hourly job's pass that holds the ceremony runs at :20. */
const RUNS_AT_MINUTE = 20;
/** The hour (UTC) the ceremony is held on Sundays; the env CEREMONY_HOUR_UTC moves it. */
export function ceremonyHourUtc(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.CEREMONY_HOUR_UTC?.trim());
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : 20;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const dayId = (d: Date): string => d.toISOString().slice(0, 10);
/** When a Sunday's ceremony is held: the job's pass at the ceremony hour. */
export const ceremonyRunsAt = (heldOn: string, env?: Record<string, string | undefined>): Date =>
  new Date(Date.parse(`${heldOn}T00:00:00Z`) + (ceremonyHourUtc(env) * 60 + RUNS_AT_MINUTE) * 60 * 1000);
/** When a Sunday's vote opens: Thursday, midnight UTC. */
export const ceremonyVoteOpensAt = (heldOn: string): Date => new Date(Date.parse(`${heldOn}T00:00:00Z`) - VOTE_OPEN_DAYS * DAY_MS);

export type CeremonyChoice = { id: string; name: string };
export type CeremonyLine = string;

type CeremonyRow = {
  season_id: string;
  held_on: string;
  week: number;
  lead_id: string;
  choices: CeremonyChoice[];
  finale: boolean;
  held_at: string | Date | null;
  eliminated_by_vote: string | null;
  eliminated_by_lead: string | null;
  final_rose: string | null;
  votes: number | null;
  total: number | null;
  remaining: string[] | null;
  lines: CeremonyLine[] | null;
};

const rowOf = async (db: Db, heldOn: string): Promise<CeremonyRow | null> =>
  (
    await db.query<CeremonyRow>(
      `select season_id, held_on, week, lead_id, choices, finale, held_at, eliminated_by_vote, eliminated_by_lead, final_rose, votes, total, remaining, lines
         from ceremonies where held_on = $1`,
      [heldOn],
    )
  ).rows[0] ?? null;

/** The season's lead and the suitors still in, from the stored cast (the database, not the loaded copy: a job reads live). */
export async function houseOf(db: Db, seasonId: string): Promise<{ lead: string | null; suitors: string[] }> {
  const { rows } = await db.query<{ character_id: string; source: string; is_on: boolean }>(
    `select s.character_id, s.source,
            (s.withdrawn_at is null and c.visibility = 'public' and c.owner_id is distinct from 'deleted') as is_on
       from season_casts s join characters c on c.id = s.character_id
      where s.season_id = $1 and s.source in ('lead', 'suitor') order by s.slot`,
    [seasonId],
  );
  return { lead: rows.find((r) => r.source === "lead")?.character_id ?? null, suitors: rows.filter((r) => r.source === "suitor" && r.is_on).map((r) => r.character_id) };
}

async function namesOf(db: Db, ids: readonly string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { rows } = await db.query<{ id: string; name: string }>(`select id, name from characters where id = any($1)`, [[...ids]]);
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Which week's ceremony a Sunday is (1-based), and whether it's the finale (the season's last). */
export function ceremonyWeek(def: SeasonFormatDef, heldOn: string, now: Date): { week: number; finale: boolean } {
  const days = ceremonySundays(def, now);
  return { week: days.indexOf(heldOn) + 1, finale: days[days.length - 1] === heldOn };
}

/**
 * Opens the next Sunday's vote once it's within VOTE_OPEN_DAYS (the hourly lobby job calls this): the row with its
 * frozen ballot, the suitors still in, inserted once. No vote with two or fewer left (they wait for the finale) or on
 * the finale itself (the lead's pick, not a vote). Returns the row, or null when none is open.
 */
export async function ensureCeremonyVote(db: Db, def: SeasonFormatDef, now: Date = new Date()): Promise<CeremonyRow | null> {
  if (!def.lead) return null;
  const heldOn = nextCeremonySunday(def, now);
  if (!heldOn || now < ceremonyVoteOpensAt(heldOn)) return null;
  const have = await rowOf(db, heldOn);
  if (have) return have;
  const seasonId = seasonIdOf(now);
  const { lead, suitors } = await houseOf(db, seasonId);
  const { week, finale } = ceremonyWeek(def, heldOn, now);
  if (!lead || finale || suitors.length <= 2) return null;
  const names = await namesOf(db, suitors);
  const choices = suitors.map((id) => ({ id, name: names.get(id) ?? id }));
  await db.query(`insert into ceremonies (season_id, held_on, week, lead_id, choices, finale) values ($1, $2, $3, $4, $5::jsonb, $6) on conflict do nothing`, [
    seasonId,
    heldOn,
    week,
    lead,
    JSON.stringify(choices),
    finale,
  ]);
  return rowOf(db, heldOn);
}

export type CeremonyVoteResult = { ok: true; pick: string } | { ok: false; status: number; error: string; message: string };

/** One viewer's vote on who goes home this Sunday (a second vote changes it), until the ceremony is held. */
export async function voteCeremony(db: Db, userId: string, pick: string, now: Date = new Date()): Promise<CeremonyVoteResult> {
  const def = await seasonFormatNow(db, now);
  const heldOn = def.lead ? nextCeremonySunday(def, now) : null;
  const row = heldOn ? await rowOf(db, heldOn) : null;
  if (!row || row.held_at) return { ok: false, status: 404, error: "no_vote_open", message: "There's no rose ceremony vote open right now." };
  if (!row.choices.some((c) => c.id === pick)) return { ok: false, status: 400, error: "not_on_the_ballot", message: "That suitor isn't on the ballot." };
  await db.query(
    `insert into ceremony_votes (held_on, user_id, pick) values ($1, $2, $3)
     on conflict (held_on, user_id) do update set pick = excluded.pick, updated_at = now()`,
    [heldOn, userId, pick],
  );
  return { ok: true, pick };
}

async function tallyOf(db: Db, heldOn: string): Promise<Map<string, number>> {
  const { rows } = await db.query<{ pick: string; n: number }>(`select pick, count(*)::int as n from ceremony_votes where held_on = $1 group by pick`, [heldOn]);
  return new Map(rows.map((r) => [r.pick, r.n]));
}

/** How the engine's ending kinds rank for the lead's verdict: a second date beats friends beats a disaster. */
const ENDING_RANK: Record<Ending, number> = { second_date: 3, friends: 1, disaster: 0 };

export type Verdict = {
  suitor: string;
  /** The sum of the week's ending ranks; -1 when the lead never dated them in the window. */
  score: number;
  /** How many of those dates the lead's own side wanted to see them again (episodes.sides wants_another). */
  see_again: number;
  dates: number;
  /** The worst date's ending and place, for the words. */
  worst: { ending: Ending; venue: string | null } | null;
  best: { ending: Ending; venue: string | null } | null;
};

/**
 * The lead's verdicts on the suitors from the public dates between them aired in [since, until): the engine's endings,
 * nothing else. Ordered worst first (the first goes home): lowest score, then fewest "see again", then the most dates
 * (the lead has seen enough), then the ballot's order from the end, so a tie never depends on timing.
 */
export async function leadVerdicts(db: Db, lead: string, suitors: readonly string[], since: Date, until: Date): Promise<Verdict[]> {
  if (!suitors.length) return [];
  const { rows } = await db.query<{ suitor: string; ending: Ending; venue: string | null; see_again: boolean | null }>(
    `select case when e.character_a = $1 then e.character_b else e.character_a end as suitor, e.ending, e.setup ->> 'venue' as venue,
            case when e.character_a = $1 then (e.sides -> 0 ->> 'wants_another')::boolean else (e.sides -> 1 ->> 'wants_another')::boolean end as see_again
       from episodes e
      where (e.character_a = $1 or e.character_b = $1) and (e.character_a = any($2::text[]) or e.character_b = any($2::text[]))
        and e.status = 'ready' and e.visibility = 'public' and e.revealed_at >= $3 and e.revealed_at < $4
        and coalesce((e.setup ->> 'after_dark')::boolean, false) = false
      order by e.revealed_at`,
    [lead, [...suitors], since.toISOString(), until.toISOString()],
  );
  const by = new Map<string, Verdict>(suitors.map((s) => [s, { suitor: s, score: -1, see_again: 0, dates: 0, worst: null, best: null }]));
  for (const r of rows) {
    const v = by.get(r.suitor);
    if (!v) continue;
    v.score = Math.max(0, v.score) + ENDING_RANK[r.ending];
    v.dates += 1;
    if (r.see_again) v.see_again += 1;
    if (!v.worst || ENDING_RANK[r.ending] < ENDING_RANK[v.worst.ending]) v.worst = { ending: r.ending, venue: r.venue };
    if (!v.best || ENDING_RANK[r.ending] > ENDING_RANK[v.best.ending]) v.best = { ending: r.ending, venue: r.venue };
  }
  const order = new Map(suitors.map((s, i) => [s, i]));
  return [...by.values()].sort((x, y) => x.score - y.score || x.see_again - y.see_again || y.dates - x.dates || (order.get(y.suitor) ?? 0) - (order.get(x.suitor) ?? 0));
}

/** A venue's phrase without its trouble ("a basement jazz bar"), as lib/season-recap.ts placeOf shortens it. */
const placeShort = (venue: string): string => {
  const phrase = venuePhrase(venue);
  return phrase.replace(/\s*\([^)]*\)/g, "").split(/,\s/)[0].split(/\s(?:with|that|on|where|for|while|during)\s/)[0].trim() || phrase;
};

/** The lead's reason, in the show's voice, for a verdict that sent someone home. */
function whyHome(name: string, v: Verdict): string {
  if (v.dates === 0) return `${name} never got a date with the lead this week.`;
  if (v.worst?.ending === "disaster") return `${name}'s date${v.worst.venue ? ` at ${placeShort(v.worst.venue)}` : ""} was a disaster, and the lead didn't forget it.`;
  if (v.best?.ending === "friends") return `${name} and the lead ended as friends, every time. Friends don't get roses.`;
  return `${name}'s week with the lead was the weakest of the house.`;
}

export type CeremonyRun =
  | { held: true; held_on: string; week: number; finale: boolean; went_home: string[]; final_rose: string | null }
  | { held: false; reason: "not_due" | "already" | "no_lead" | "no_suitors" | "waiting_for_finale" };

/** A suitor's own words to their person, the night a rose went elsewhere (lib/companion.ts postFromCharacter). */
export const SENT_HOME_LINES: readonly string[] = ["The rose went elsewhere. I'm fine. Mostly.", "Thanks for being in my corner."];
const FINAL_ROSE_LINES: readonly string[] = ["I got the final rose. I keep looking at it like it might change its mind.", "You were in my corner the whole way. Thank you."];
const RUNNER_UP_LINES: readonly string[] = ["Final two. Not the rose. I'm oddly okay.", "Thanks for watching every one of those dates."];

/**
 * Holds a Sunday's ceremony: claims the row (two job passes can't both hold it), reads the votes and the lead's verdicts,
 * sends the suitors home (the cast, badges, owners told, the characters' own texts), and keeps the words. The finale
 * hands the final rose instead. Idempotent through the claim; a season with no lead or no suitor holds nothing.
 */
export async function runCeremony(db: Db, def: SeasonFormatDef, heldOn: string, now: Date = new Date()): Promise<CeremonyRun> {
  if (!def.lead) return { held: false, reason: "no_lead" };
  const seasonId = seasonIdOf(now);
  const { lead, suitors } = await houseOf(db, seasonId);
  if (!lead) return { held: false, reason: "no_lead" };
  if (!suitors.length) return { held: false, reason: "no_suitors" };
  const { week, finale } = ceremonyWeek(def, heldOn, now);
  if (!finale && suitors.length <= 2) return { held: false, reason: "waiting_for_finale" };

  // The row may never have opened (two or fewer left all week, the finale, a job down all window): make it now.
  let row = await rowOf(db, heldOn);
  if (!row) {
    const names = await namesOf(db, suitors);
    await db.query(`insert into ceremonies (season_id, held_on, week, lead_id, choices, finale) values ($1, $2, $3, $4, $5::jsonb, $6) on conflict do nothing`, [
      seasonId,
      heldOn,
      week,
      lead,
      JSON.stringify(suitors.map((id) => ({ id, name: names.get(id) ?? id }))),
      finale,
    ]);
    row = await rowOf(db, heldOn);
  }
  if (!row || row.held_at) return { held: false, reason: "already" };
  const claimed = await db.query(`update ceremonies set held_at = $3 where season_id = $1 and held_on = $2 and held_at is null returning held_on`, [seasonId, heldOn, now.toISOString()]);
  if (!claimed.rows.length) return { held: false, reason: "already" };

  // The week: since the last ceremony held this season, else the season's start. The finale weighs the whole season.
  const { start } = seasonWindow(now);
  const last = (await db.query<{ held_at: string | Date }>(`select held_at from ceremonies where season_id = $1 and held_at is not null and held_on < $2 order by held_on desc limit 1`, [seasonId, heldOn])).rows[0];
  const since = finale || !last ? start : new Date(last.held_at);
  const names = await namesOf(db, [lead, ...suitors]);
  const nameOf = (id: string) => shortName(names.get(id) ?? "someone");
  const leadName = nameOf(lead);
  const lines: string[] = [];
  const number = seasonNumber(seasonId);

  let goneByVote: string | null = null;
  let goneByLead: string | null = null;
  let finalRose: string | null = null;
  let votes = 0;
  let total = 0;
  const verdicts = await leadVerdicts(db, lead, suitors, since, now);

  if (finale) {
    // The final rose: the better record over the season, the engine's verdicts and nothing else.
    finalRose = verdicts[verdicts.length - 1].suitor;
    const others = suitors.filter((s) => s !== finalRose);
    lines.push(
      others.length
        ? `The last Sunday of the season. ${leadName} holds one rose, and ${others.map(nameOf).join(" and ")} ${others.length === 1 ? "waits" : "wait"} with ${nameOf(finalRose)}.`
        : `The last Sunday of the season. ${leadName} holds one rose, and only ${nameOf(finalRose)} is left to take it.`,
    );
    const w = verdicts[verdicts.length - 1];
    lines.push(`The final rose goes to ${nameOf(finalRose)}: ${w.dates} ${w.dates === 1 ? "date" : "dates"} with ${leadName} this season${w.best?.ending === "second_date" ? ", and a second date among them" : ""}.`);
    if (others.length) lines.push(`${others.map(nameOf).join(" and ")} ${others.length === 1 ? "leaves" : "leave"} as the final ${others.length === 1 ? "two" : `${others.length + 1}`}.`);
  } else {
    const tally = await tallyOf(db, heldOn);
    total = [...tally.values()].reduce((s, n) => s + n, 0);
    // Only suitors still in count (one may have been withdrawn since the ballot froze).
    const stillIn = row.choices.filter((c) => suitors.includes(c.id));
    const voted = winnerOf(stillIn, tally);
    const twoGo = suitors.length >= 4;
    lines.push(`Sunday night at the house. ${leadName} holds ${suitors.length - (twoGo ? 2 : 1)} ${suitors.length - (twoGo ? 2 : 1) === 1 ? "rose" : "roses"} for ${suitors.length} suitors.`);
    if (voted) {
      goneByVote = voted.id;
      votes = tally.get(voted.id) ?? 0;
      lines.push(`The audience spoke first: ${votes} of ${total} ${total === 1 ? "vote" : "votes"} sent ${nameOf(goneByVote)} home.`);
    } else {
      lines.push(`Nobody voted this week, so ${leadName}'s dates had to speak for everyone.`);
    }
    const rest = verdicts.filter((v) => v.suitor !== goneByVote);
    if (twoGo || !goneByVote) {
      goneByLead = rest[0].suitor;
      lines.push(`${leadName}'s own week decided the rest: ${whyHome(nameOf(goneByLead), rest[0])}`);
    }
    // Nobody voted with four or more left: the lead's dates stand in for the audience too, so the week still moves.
    if (!goneByVote && twoGo) {
      goneByVote = rest[1].suitor;
      lines.push(`And with no vote to lean on, the dates sent ${nameOf(goneByVote)} home too. ${whyHome(nameOf(goneByVote), rest[1])}`);
    }
    const remaining = suitors.filter((s) => s !== goneByVote && s !== goneByLead);
    lines.push(remaining.length === 2 ? `Two remain: ${remaining.map(nameOf).join(" and ")}. The final rose on the last Sunday.` : `Still in: ${remaining.map(nameOf).join(", ")}.`);
  }

  const gone = [goneByVote, goneByLead].filter((s): s is string => Boolean(s));
  const remaining = finale ? (finalRose ? [finalRose] : []) : suitors.filter((s) => !gone.includes(s));
  await db.query(
    `update ceremonies set eliminated_by_vote = $3, eliminated_by_lead = $4, final_rose = $5, votes = $6, total = $7, remaining = $8::jsonb, lines = $9::jsonb
      where season_id = $1 and held_on = $2`,
    [seasonId, heldOn, goneByVote, goneByLead, finalRose, votes, total, JSON.stringify(remaining), JSON.stringify(lines)],
  );

  // Who leaves with what (once a character a season), and the cast: a suitor sent home is off at once, like a withdrawal.
  const badges: [string, "suitor" | "runner_up" | "final_rose"][] = finale
    ? suitors.map((s) => [s, s === finalRose ? "final_rose" : "runner_up"] as [string, "runner_up" | "final_rose"])
    : gone.map((s) => [s, "suitor"] as [string, "suitor"]);
  for (const [id, badge] of badges) {
    await db.query(`insert into suitor_badges (season_id, character_id, badge, week) values ($1, $2, $3, $4) on conflict do nothing`, [seasonId, id, badge, week]);
  }
  if (gone.length) {
    await db.query(`update season_casts set withdrawn_at = $3 where season_id = $1 and character_id = any($2::text[]) and withdrawn_at is null`, [seasonId, gone, now.toISOString()]);
    forgetLoadedSeasonCast();
  }

  // The owners hear, and the characters text whoever opted in to hear from them.
  const seasonWord = number ? `Season ${number}` : "this season";
  const owners = (
    await db.query<{ id: string; owner_id: string | null; is_house: boolean }>(`select id, owner_id, is_house from characters where id = any($1) and owner_id is distinct from 'deleted'`, [
      [...gone, ...(finale ? suitors : [])],
    ])
  ).rows.filter((r) => !r.is_house && r.owner_id);
  const { postFromCharacter } = await import("./companion");
  for (const o of owners) {
    const name = nameOf(o.id);
    const kind = finale ? (o.id === finalRose ? "final_rose" : "runner_up") : "suitor";
    await notify(db, o.owner_id, {
      kind: "ceremony_held",
      title: kind === "final_rose" ? `🌹 ${name} got the final rose` : kind === "runner_up" ? `🥀 ${name} was ${leadName}'s final two` : `🥀 ${name} went home from The Botchelor`,
      body:
        kind === "final_rose"
          ? `${leadName} chose ${name} on the last Sunday of ${seasonWord}. The season recap tells it.`
          : kind === "runner_up"
            ? `${name} made it to the final rose and came second. A ${seasonWord} runner-up.`
            : `${lines.find((l) => l.includes(name)) ?? `${name} went home at the week ${week} rose ceremony.`} ${name} keeps a ${seasonWord} suitor badge.`,
      link: `/characters/${o.id}`,
    });
    const opted = await db.query(`select 1 from companion_threads where user_id = $1 and character_id = $2 and muted_proactive = false and paused_at is null`, [o.owner_id, o.id]);
    if (opted.rows.length) {
      await postFromCharacter(db, {
        userId: o.owner_id!,
        characterId: o.id,
        lines: kind === "final_rose" ? FINAL_ROSE_LINES : kind === "runner_up" ? RUNNER_UP_LINES : SENT_HOME_LINES,
        now,
        kind: "ceremony",
        dedupeKey: `ceremony:${seasonId}-${week}`,
      }).catch(() => null);
    }
  }

  // The voters hear how it went (the card on /watch tells the whole ceremony).
  const voters = (await db.query<{ user_id: string }>(`select user_id from ceremony_votes where held_on = $1`, [heldOn])).rows.map((v) => v.user_id);
  const voterIds = voters.filter((v) => !owners.some((o) => o.owner_id === v));
  if (voterIds.length) {
    await notifyAll(db, voterIds, {
      kind: "ceremony_held",
      title: finale ? `🌹 The final rose went to ${nameOf(finalRose!)}` : `🥀 The rose ceremony: ${gone.map(nameOf).join(" and ")} went home`,
      body: lines.slice(1, 3).join(" "),
      link: "/watch#rose-ceremony",
    }).catch(() => {});
  }
  return { held: true, held_on: heldOn, week, finale, went_home: gone, final_rose: finalRose };
}

/**
 * The hourly lobby job's part: open the next Sunday's vote once it's Thursday, and hold today's ceremony at the
 * ceremony hour. Null when the season's format has no lead or nothing was due.
 */
export async function runDueCeremony(db: Db, now: Date = new Date(), env: Record<string, string | undefined> = process.env): Promise<CeremonyRun | null> {
  const def = await seasonFormatNow(db, now);
  if (!def.lead) return null;
  await ensureCeremonyVote(db, def, now).catch(() => null);
  const heldOn = nextCeremonySunday(def, now);
  if (!heldOn || heldOn !== dayId(now) || now.getUTCHours() < ceremonyHourUtc(env)) return null;
  return runCeremony(db, def, heldOn, now);
}

export type CeremonyFace = { id: string; name: string; hue: number | null; portrait: string | null; house: boolean };
export type SuitorState = "in" | "out" | "final_rose" | "runner_up";

export type CeremonyBoard = {
  title: string;
  lead: CeremonyFace;
  suitors: (CeremonyFace & { state: SuitorState; week: number | null })[];
  /** The next ceremony (today's until it's held), when the season has one left. */
  next: { held_on: string; runs_at: string; week: number; finale: boolean } | null;
  /** The open vote, with counts once this viewer has voted (as on the situation vote). */
  vote: { held_on: string; closes_at: string; choices: { id: string; name: string; votes: number }[]; my_pick: string | null; total: number } | null;
  /** The newest ceremony held, in the show's words. */
  last: { held_on: string; week: number; finale: boolean; lines: string[]; went_home: CeremonyFace[]; final_rose: CeremonyFace | null; votes: number; total: number } | null;
  /**
   * Open casting (lib/casting.ts): "Walk-ons this week" in words (the count under the empty-room rule) and the people's
   * rose once the finale handed it out. Null with casting switched off.
   */
  walk_ons: { line: string | null; peoples_rose: { id: string; name: string; roses: number } | null } | null;
};

async function facesOf(db: Db, ids: readonly string[]): Promise<Map<string, CeremonyFace>> {
  if (!ids.length) return new Map();
  const { rows } = await db.query<CeremonyFace>(`select c.id, c.name, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait, c.is_house as house from characters c where c.id = any($1)`, [[...ids]]);
  return new Map(rows.map((r) => [r.id, r]));
}

/** The Botchelor card's data for one viewer (/watch): null on any season without a lead, so a classic page is unchanged. */
export async function ceremonyBoard(db: Db, viewerId: string | null, now: Date = new Date()): Promise<CeremonyBoard | null> {
  const def = await seasonFormatNow(db, now);
  if (!def.lead) return null;
  const seasonId = seasonIdOf(now);
  // The walk-ons' line (open casting), started now so it rides alongside the board's own reads. Imported here:
  // lib/casting.ts reads this module's hour and house.
  const walkOnsP = import("./casting").then((m) => m.walkOnsLine(db, viewerId, now)).catch(() => null);
  const { lead, suitors } = await houseOf(db, seasonId);
  if (!lead) return null;
  const [all, badges, lastRow] = await Promise.all([
    db.query<{ character_id: string }>(`select character_id from season_casts where season_id = $1 and source = 'suitor' order by slot`, [seasonId]),
    // The suitors' badges only: the people's rose is a walk-on's (lib/casting.ts), never a suitor's state.
    db.query<{ character_id: string; badge: "suitor" | "runner_up" | "final_rose"; week: number }>(`select character_id, badge, week from suitor_badges where season_id = $1 and badge <> 'peoples_rose'`, [seasonId]),
    db.query<CeremonyRow>(
      `select season_id, held_on, week, lead_id, choices, finale, held_at, eliminated_by_vote, eliminated_by_lead, final_rose, votes, total, remaining, lines
         from ceremonies where season_id = $1 and held_at is not null order by held_on desc limit 1`,
      [seasonId],
    ),
  ]);
  const ids = [lead, ...all.rows.map((r) => r.character_id)];
  const faces = await facesOf(db, ids);
  const badgeOf = new Map(badges.rows.map((b) => [b.character_id, b]));
  const face = (id: string): CeremonyFace => faces.get(id) ?? { id, name: "A suitor", hue: null, portrait: null, house: false };
  const suitorCards = all.rows.map((r) => {
    const b = badgeOf.get(r.character_id);
    const state: SuitorState = b ? (b.badge === "suitor" ? "out" : b.badge) : suitors.includes(r.character_id) ? "in" : "out";
    return { ...face(r.character_id), state, week: b?.week ?? null };
  });

  const heldOn = nextCeremonySunday(def, now);
  const row = heldOn ? await rowOf(db, heldOn) : null;
  const next = heldOn && (!row || !row.held_at) ? { held_on: heldOn, runs_at: ceremonyRunsAt(heldOn).toISOString(), ...ceremonyWeek(def, heldOn, now) } : null;
  let vote: CeremonyBoard["vote"] = null;
  if (row && !row.held_at && row.choices.length >= 2) {
    const [tally, mine] = await Promise.all([
      tallyOf(db, row.held_on),
      viewerId ? db.query<{ pick: string }>(`select pick from ceremony_votes where held_on = $1 and user_id = $2`, [row.held_on, viewerId]) : Promise.resolve({ rows: [] as { pick: string }[] }),
    ]);
    vote = {
      held_on: row.held_on,
      closes_at: ceremonyRunsAt(row.held_on).toISOString(),
      choices: row.choices.filter((c) => suitors.includes(c.id)).map((c) => ({ id: c.id, name: c.name, votes: tally.get(c.id) ?? 0 })),
      my_pick: mine.rows[0]?.pick ?? null,
      total: [...tally.values()].reduce((s, n) => s + n, 0),
    };
  }
  const lr = lastRow.rows[0];
  const last: CeremonyBoard["last"] = lr
    ? {
        held_on: lr.held_on,
        week: lr.week,
        finale: lr.finale,
        lines: lr.lines ?? [],
        went_home: [lr.eliminated_by_vote, lr.eliminated_by_lead].filter((s): s is string => Boolean(s)).map(face),
        final_rose: lr.final_rose ? face(lr.final_rose) : null,
        votes: lr.votes ?? 0,
        total: lr.total ?? 0,
      }
    : null;
  return { title: def.title, lead: face(lead), suitors: suitorCards, next, vote, last, walk_ons: await walkOnsP };
}

export type CeremonySummary = {
  season_id: string;
  lead: { id: string; name: string } | null;
  ceremonies: {
    week: number;
    held_on: string;
    held_at: string | null;
    finale: boolean;
    eliminated_by_vote: { id: string; name: string } | null;
    eliminated_by_lead: { id: string; name: string } | null;
    final_rose: { id: string; name: string } | null;
    votes: number;
    total: number;
    remaining: { id: string; name: string }[];
    lines: string[];
  }[];
  badges: { character_id: string; name: string; badge: string; week: number }[];
  /** The walk-on with the most roses, named on the season's last Sunday (lib/casting.ts); null until then. */
  peoples_rose: { id: string; name: string; roses: number } | null;
};

/** A season's ceremonies in order, names resolved: for the clip scripts (scripts/clips/*) and the recap. */
export async function ceremonySummary(db: Db, seasonId: string): Promise<CeremonySummary> {
  const [{ lead }, rows, badges, peoplesRose] = await Promise.all([
    houseOf(db, seasonId),
    db.query<CeremonyRow>(
      `select season_id, held_on, week, lead_id, choices, finale, held_at, eliminated_by_vote, eliminated_by_lead, final_rose, votes, total, remaining, lines
         from ceremonies where season_id = $1 and held_at is not null order by held_on`,
      [seasonId],
    ),
    db.query<{ character_id: string; badge: string; week: number }>(`select character_id, badge, week from suitor_badges where season_id = $1 order by week, badge`, [seasonId]),
    import("./casting").then((m) => m.peoplesRoseOf(db, seasonId)).catch(() => null),
  ]);
  const ids = new Set<string>([...(lead ? [lead] : []), ...badges.rows.map((b) => b.character_id)]);
  for (const r of rows.rows) for (const id of [r.eliminated_by_vote, r.eliminated_by_lead, r.final_rose, ...(r.remaining ?? [])]) if (id) ids.add(id);
  const names = await namesOf(db, [...ids]);
  const who = (id: string | null) => (id ? { id, name: names.get(id) ?? id } : null);
  return {
    season_id: seasonId,
    lead: who(lead),
    ceremonies: rows.rows.map((r) => ({
      week: r.week,
      held_on: r.held_on,
      held_at: r.held_at ? new Date(r.held_at).toISOString() : null,
      finale: r.finale,
      eliminated_by_vote: who(r.eliminated_by_vote),
      eliminated_by_lead: who(r.eliminated_by_lead),
      final_rose: who(r.final_rose),
      votes: r.votes ?? 0,
      total: r.total ?? 0,
      remaining: (r.remaining ?? []).map((id) => who(id)!),
      lines: r.lines ?? [],
    })),
    badges: badges.rows.map((b) => ({ ...b, name: names.get(b.character_id) ?? b.character_id })),
    peoples_rose: peoplesRose,
  };
}

/** The season recap's award (lib/season-recap.ts): the final rose, when the season held a finale. Null otherwise. */
export async function finalRoseAward(db: Db, seasonId: string): Promise<{ title: string; name: string; detail: string; chars: CeremonyFace[] } | null> {
  const row = (await db.query<{ final_rose: string; lead_id: string; week: number }>(`select final_rose, lead_id, week from ceremonies where season_id = $1 and finale and final_rose is not null`, [seasonId])).rows[0];
  if (!row) return null;
  const faces = await facesOf(db, [row.final_rose, row.lead_id]);
  const rose = faces.get(row.final_rose);
  const lead = faces.get(row.lead_id);
  if (!rose || !lead) return null;
  return { title: "The final rose", name: shortName(rose.name), detail: `${shortName(lead.name)}'s pick on the last Sunday, after ${row.week} ${row.week === 1 ? "ceremony" : "ceremonies"}.`, chars: [lead, rose] };
}

/** What a character left a Botchelor season with, for its page and lists: null when it was never a suitor. */
export async function suitorBadgesOf(db: Db, characterId: string): Promise<{ season_id: string; badge: string; label: string }[]> {
  const { rows } = await db.query<{ season_id: string; badge: string }>(`select season_id, badge from suitor_badges where character_id = $1 order by season_id`, [characterId]);
  return rows.map((r) => {
    const n = seasonNumber(r.season_id);
    const season = n ? `Season ${n}` : r.season_id;
    return { ...r, label: r.badge === "final_rose" ? `${season} final rose` : r.badge === "runner_up" ? `${season} runner-up` : r.badge === "peoples_rose" ? `${season} people's rose` : `${season} suitor` };
  });
}
