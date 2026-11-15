/**
 * Tonight's situation (docs/ideas.md "Bringing viewers back", idea 1; David 2026-11-01: "tackle the ones you think are
 * most impactful"). Every UTC day two of the season's house cast are dealt for a date, and three of the show's own
 * roleplays (lib/roleplays.ts) are put to the viewers: whatever most of them pick, the two of them play. The vote closes
 * at UTC midnight; the next hourly lobby run (app/api/jobs/lobby) makes the date as an always-on room (lib/watch.ts
 * createTemplateParty, the lobby's own kind of date) and tells everyone who voted that it's on. So a vote is a reason to
 * come back tomorrow: did my pick win, and how did it go.
 *
 *  - Anyone with the site's cookie votes, one vote a day, and can change it until the vote closes. The counts show once
 *    you've voted, so the first voters aren't just following the crowd.
 *  - Who's on, and the three choices, are dealt from the day (seedFrom), so every page and the job agree with nothing
 *    stored until the first vote. The "couples" roleplays (a second first date, pen pals) are left out: the pair may
 *    never have met.
 *  - A day nobody voted on makes no date: the lobby's own rooms carry on as before, so an idle day costs nothing.
 *  - The winner: most votes; a tie goes to the choice listed first (the dealt order), so it never depends on timing.
 *  - Cost: one lobby date a day, on the show's default model like every lobby room (it counts toward
 *    FRESH_ROOMS_PER_DAY, so a busy day makes no more rooms than before): at most ~5¢ a day, under $1.50 a month.
 *  - The producer's twists (lib/producer.ts, 2026-11-15): on a day the producer staged a beat that the season's format
 *    lets the house book, the ballot is two or three twists of that beat instead of the dealt roleplays: who gets the
 *    date, where, or whose story gets asked about. Each twist names its own two; the winner's two get the date, at its
 *    place when it has one, with no roleplay. Still a situation and never an ending: the engine decides the date as it
 *    decides any other. No beat (or PRODUCER=0), and everything above stands as it was.
 */
import { portraitPathSql } from "./portrait-sql";
import { dareChoices, dareCounts, daredOf, dareWinnerOf, producerDareNote } from "./dares";
import { judgeDare } from "./dare-verdict";
import type { Db } from "./db";
import { seedFrom } from "./engine";
import { notifyAll } from "./notifications";
import { DATE_ROLEPLAYS, fillPremise, termsFor, type DateRoleplay, type DateRoleplayDef } from "./roleplays";
import { firstPickOn, seasonCastIds, suitorInTurn } from "./season-cast";
import type { SeasonFormatDef } from "./season-format";
import { seasonFormatNow } from "./season-format-store";
import { createTemplateParty, type TemplateOpts } from "./watch";
import { beatFor, stagedPair, stageOf, twistsFor, type Twist } from "./producer";
import { setWant } from "./story-state";

/** How many situations each day's vote offers. */
export const SITUATION_CHOICES = 3;

/** The roleplays a vote can offer: all of the show's except those for a couple who already know each other. */
const OFFERED = DATE_ROLEPLAYS.filter((r) => r.tag !== "couples");

/** A UTC day as YYYY-MM-DD: the vote's key. */
export const utcDay = (d: Date): string => d.toISOString().slice(0, 10);

/** When a day's vote closes: the next UTC midnight. */
export const closesAt = (day: string): Date => new Date(Date.parse(`${day}T00:00:00Z`) + 24 * 60 * 60 * 1000);

/** The three situations a day's vote offers, in their dealt order (a tie goes to the earlier one). */
export function situationChoices(day: string): DateRoleplayDef[] {
  const pool = [...OFFERED];
  const out: DateRoleplayDef[] = [];
  for (let i = 0; i < SITUATION_CHOICES && pool.length; i++) out.push(pool.splice(seedFrom("situation", day, i) % pool.length, 1)[0]);
  return out;
}

/**
 * The two of the season's house cast a day's vote is for. The season is the one the day falls in (noon UTC), so the
 * date made just after midnight on the 1st is still last month's pair. On a Botchelor season (the format passed in has
 * a lead, lib/ceremony.ts) the pair is the lead and the suitor whose turn it is, so every suitor dates the lead before
 * Sunday; without a format, or on any other, the pair is dealt from the day exactly as before, unless the week's house
 * challenge gave its winner first pick of this day (lib/season-cast.ts firstPickOn): then it is the winner and their pick.
 */
export function situationPair(day: string, def: SeasonFormatDef | null = null): [string, string] | null {
  const noon = new Date(`${day}T12:00:00Z`);
  if (def?.lead) return suitorInTurn(noon);
  const cast = seasonCastIds(noon);
  if (cast.length < 2) return null;
  // The week's house challenge (lib/house-conflict.ts): its winner has first pick of this day's house date.
  const prize = firstPickOn(day, cast);
  if (prize) return prize;
  const i = seedFrom("situation-a", day) % cast.length;
  const j = (i + 1 + (seedFrom("situation-b", day) % (cast.length - 1))) % cast.length;
  return [cast[i], cast[j]];
}

/** The format a day's season runs in, for the pair (lib/season-format-store.ts); null means classic, as before. */
const formatOfDay = (db: Db, day: string): Promise<SeasonFormatDef | null> => seasonFormatNow(db, new Date(`${day}T12:00:00Z`)).catch(() => null);

export type VoteResult = { ok: true; pick: string } | { ok: false; status: number; error: string; message: string };

/** One viewer's vote on today's situation (a second vote changes it). Only today's three choices count. */
export async function voteSituation(db: Db, userId: string, pick: string, now: Date = new Date()): Promise<VoteResult> {
  const day = utcDay(now);
  const twists = await twistsFor(db, day).catch(() => null);
  if (!(twists ?? situationChoices(day)).some((c) => c.id === pick)) {
    return { ok: false, status: 400, error: "not_on_the_ballot", message: "That isn't one of today's situations." };
  }
  await db.query(
    `insert into situation_votes (day, user_id, pick) values ($1, $2, $3)
     on conflict (day, user_id) do update set pick = excluded.pick, updated_at = now()`,
    [day, userId, pick],
  );
  return { ok: true, pick };
}

async function counts(db: Db, day: string): Promise<Map<string, number>> {
  const { rows } = await db.query<{ pick: string; n: number }>(`select pick, count(*)::int as n from situation_votes where day = $1 group by pick`, [day]);
  return new Map(rows.map((r) => [r.pick, r.n]));
}

/** A day's winner: most votes, ties to the earlier choice; null when nobody voted. Generic: the recoupling vote (lib/recoupling.ts) reuses it. */
export function winnerOf<C extends { id: string }>(choices: readonly C[], tally: Map<string, number>): C | null {
  let best: C | null = null;
  for (const c of choices) if ((tally.get(c.id) ?? 0) > 0 && (!best || (tally.get(c.id) ?? 0) > (tally.get(best.id) ?? 0))) best = c;
  return best;
}

export type SituationPlayed =
  | { played: true; day: string; pick: string | null; dare: string | null; party_id: string; room_path: string }
  | { played: false; day: string; reason: "already" | "no_votes" | "no_cast" | "failed" };

export type SituationDeal =
  | { ok: false; reason: "no_votes" | "no_cast" }
  | {
      ok: true;
      /** The roleplay that won (the dealt ballot), or null: a twist won, or only the dare lane had votes. */
      winner: DateRoleplayDef | null;
      /** The producer's twist that won, on a day whose ballot was twists. */
      twist: Twist | null;
      dare: ReturnType<typeof dareWinnerOf>;
      dared: string | null;
      /** The two the date is for; `first` and `second` are the order it is booked in (the dared one goes first). */
      pair: [string, string];
      first: string;
      second: string;
      /** What createTemplateParty is called with: the roleplay, the dare's note, the twist's place. */
      opts: TemplateOpts;
      tally: Map<string, number>;
      dareTally: Map<string, number>;
      total: number;
    };

/**
 * What a day's vote makes, as the votes stand: who the date is for, in which order, and with what. One place for it,
 * so the hourly job (playVotedSituation, once the vote has closed) and the producer's night plans (lib/night-plans.ts,
 * an hour before it closes) build the same date. Reads only.
 */
export async function situationDeal(db: Db, day: string): Promise<SituationDeal> {
  const [tally, dareTally, twists] = await Promise.all([counts(db, day), dareCounts(db, day), twistsFor(db, day).catch(() => null)]);
  const twist = twists ? winnerOf(twists, tally) : null;
  const winner = twists ? null : winnerOf(situationChoices(day), tally);
  // The ballot's dare lane (lib/dares.ts): its winner rides the same date. Either lane alone makes the night.
  const dare = dareWinnerOf(dareChoices(day), dareTally);
  if (!winner && !twist && !dare) return { ok: false, reason: "no_votes" };
  // A twist names its own two; the dealt ballot (and a night only the dare lane voted on) is for the day's dealt pair.
  // The twist's two must still be bookable when the date is made (a suitor may have gone home since the ballot was set).
  const pair = twist ? stagedPair(twist.pair[0], twist.pair[1], await stageOf(db, closesAt(day))) : situationPair(day, await formatOfDay(db, day));
  if (!pair) return { ok: false, reason: "no_cast" };
  const dared = dare ? daredOf(day, pair) : null;
  const roleplay: DateRoleplay | null = winner ? { ...termsFor(winner, pair[0]), agreed: "auto" } : null;
  // The dared one goes in first (side A), so the dare rides its private note and the other side never sees it.
  const [first, second]: [string, string] = dared && dared !== pair[0] ? [pair[1], pair[0]] : [pair[0], pair[1]];
  const opts: TemplateOpts = { roleplay, dare: dare ? producerDareNote(dare.text) : null, ...(twist?.venue ? { venuePool: [twist.venue] } : {}) };
  return { ok: true, winner, twist, dare, dared, pair, first, second, opts, tally, dareTally, total: [...tally.values()].reduce((n, v) => n + v, 0) };
}

/**
 * The hourly lobby run: once yesterday's vote has closed, make its date, once. A claim row first (so two runs can't both
 * make it); a date that couldn't be made drops the claim, so the next hour tries again. Only yesterday: a day the job
 * missed entirely isn't made late.
 */
export async function playVotedSituation(db: Db, now: Date = new Date()): Promise<SituationPlayed> {
  const day = utcDay(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const deal = await situationDeal(db, day);
  if (!deal.ok) return { played: false, day, reason: deal.reason };
  const { winner, twist, dare, dared, pair, tally, dareTally, total } = deal;
  const claimed = await db.query(
    `insert into situation_nights (day, a_id, b_id, pick, votes, total, title, icon) values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (day) do nothing returning day`,
    [day, pair[0], pair[1], (twist ?? winner)?.id ?? null, twist || winner ? (tally.get((twist ?? winner)!.id) ?? 0) : 0, total, twist?.title ?? null, twist?.icon ?? null],
  );
  if (!claimed.rows.length) return { played: false, day, reason: "already" };
  // A twist that is "whose story gets asked about": the one who asks carries it into the date as this week's want.
  if (twist?.want) await setWant(db, { holder: twist.want.holder, want: twist.want.want, kind: twist.want.kind, about: twist.want.about, setBy: "producer", now }).catch(() => false);
  const room = await createTemplateParty(db, deal.first, deal.second, deal.opts).catch(() => null);
  if (!room?.ok) {
    await db.query(`delete from situation_nights where day = $1 and party_id is null`, [day]);
    return { played: false, day, reason: "failed" };
  }
  await db.query(`update situation_nights set party_id = $2 where day = $1`, [day, room.id]);
  // The dare lane's record (the reveal reads it once the date airs).
  if (dare && dared) {
    const episodeId = (await db.query<{ episode_id: string }>(`select episode_id from watch_parties where id = $1`, [room.id])).rows[0]?.episode_id ?? null;
    await db.query(
      `insert into dare_nights (day, character_id, dare_id, votes, total, party_id, episode_id) values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (day) do nothing`,
      [day, dared, dare.id, dareTally.get(dare.id) ?? 0, [...dareTally.values()].reduce((s, n) => s + n, 0), room.id, episodeId],
    );
    // Did they do it: read from the date's own lines now, stored once, revealed when it airs (lib/dare-verdict.ts).
    await judgeDare(db, day).catch(() => null);
  }
  const names = await namesOf(db, pair);
  const cast = pair.map((id) => ({ id, name: names.get(id) ?? "" }));
  const won = twist ?? winner;
  if (won) {
    const voters = (await db.query<{ user_id: string; pick: string }>(`select user_id, pick from situation_votes where day = $1`, [day])).rows;
    const body = `${cast[0].name} × ${cast[1].name}: ${twist ? twist.premise : fillPremise(termsFor(winner!, pair[0]), cast)}`;
    await notifyAll(db, voters.filter((v) => v.pick === won.id).map((v) => v.user_id), {
      kind: "situation_on",
      title: `Your pick won: ${won.title}`,
      body,
      link: room.room_path,
    });
    await notifyAll(db, voters.filter((v) => v.pick !== won.id).map((v) => v.user_id), {
      kind: "situation_on",
      title: `The viewers picked ${won.title}`,
      body,
      link: room.room_path,
    });
  }
  if (dare && dared) {
    const daredName = names.get(dared) ?? "";
    const voters = (await db.query<{ user_id: string; pick: string }>(`select user_id, pick from dare_votes where day = $1`, [day])).rows;
    const body = `${daredName}'s side has it in the pocket: "${dare.text}" Their date doesn't know. Watch whether they go through with it.`;
    await notifyAll(db, voters.filter((v) => v.pick === dare.id).map((v) => v.user_id), {
      kind: "dare_on",
      title: `The producers took your dare`,
      body,
      link: room.room_path,
    });
    await notifyAll(db, voters.filter((v) => v.pick !== dare.id).map((v) => v.user_id), {
      kind: "dare_on",
      title: `The viewers dared ${daredName}`,
      body,
      link: room.room_path,
    });
  }
  return { played: true, day, pick: won?.id ?? null, dare: dare?.id ?? null, party_id: room.id, room_path: room.room_path };
}

async function namesOf(db: Db, ids: string[]): Promise<Map<string, string>> {
  const { rows } = await db.query<{ id: string; name: string }>(`select id, name from characters where id = any($1)`, [ids]);
  return new Map(rows.map((r) => [r.id, r.name]));
}

export type SituationCast = { id: string; name: string; hue: number | null; portrait: string | null };
export type SituationChoice = { id: string; title: string; icon: string; premise: string; votes: number };

/** Everything the vote's card shows: today's vote, and how the last one went. */
export type SituationBoard = {
  day: string;
  closes_at: string;
  cast: [SituationCast, SituationCast];
  /** On a day the producer staged a beat (lib/producer.ts): what the vote decides, in one line. Null: the dealt ballot, "what happens on their date?". */
  headline: string | null;
  choices: SituationChoice[];
  my_pick: string | null;
  total: number;
  /** The last vote that made a date (yesterday's, once it's on): what won, by how much, and the room to watch it in. */
  last: { day: string; title: string; icon: string; votes: number; total: number; cast: [string, string]; room_path: string; my_pick: string | null; won: boolean } | null;
};

/** The card's data for one viewer. null when the season has no cast to deal from. */
export async function situationBoard(db: Db, viewerId: string | null, now: Date = new Date()): Promise<SituationBoard | null> {
  const day = utcDay(now);
  // The producer's twists, when the day has them: each names its own two, so the card leads with the first twist's.
  // Read beside the season's format (which only a day without twists needs): one after the other was a round trip more
  // in front of everything below, on every home page (tests/perf-pages.test.ts).
  const [beat, format] = await Promise.all([beatFor(db, day).catch(() => null), formatOfDay(db, day)]);
  const twists = beat?.choices ?? null;
  const pair = twists ? twists[0].pair : situationPair(day, format);
  if (!pair) return null;
  const [chars, tally, mine, lastRow] = await Promise.all([
    db.query<{ id: string; name: string; hue: number | null; portrait: string | null }>(`select c.id, c.name, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait from characters c where c.id = any($1)`, [pair]),
    counts(db, day),
    viewerId
      ? db.query<{ pick: string }>(`select pick from situation_votes where day = $1 and user_id = $2`, [day, viewerId])
      : Promise.resolve({ rows: [] as { pick: string }[] }),
    db.query<{ day: string; a_id: string; b_id: string; pick: string; votes: number; total: number; party_id: string; title: string | null; icon: string | null }>(
      `select day, a_id, b_id, pick, votes, total, party_id, title, icon from situation_nights where party_id is not null and day < $1 order by day desc limit 1`,
      [day],
    ),
  ]);
  const byId = new Map(chars.rows.map((c) => [c.id, c]));
  const a = byId.get(pair[0]);
  const b = byId.get(pair[1]);
  if (!a || !b) return null;
  const cast = [a, b].map((c) => ({ id: c.id, name: c.name }));
  const choices = twists
    ? twists.map((c) => ({ id: c.id, title: c.title, icon: c.icon, premise: c.premise, votes: tally.get(c.id) ?? 0 }))
    : situationChoices(day).map((c) => ({
        id: c.id,
        title: c.title,
        icon: c.icon,
        premise: fillPremise(termsFor(c, a.id), cast),
        votes: tally.get(c.id) ?? 0,
      }));
  const said = beat?.tonight.replace(/^Tonight: /, "") ?? "";
  const headline = twists && said ? said.charAt(0).toUpperCase() + said.slice(1) : null;
  let last: SituationBoard["last"] = null;
  const lr = lastRow.rows[0];
  // What won: a roleplay by its id, or a producer's twist by the title the night kept.
  const lastDef = lr ? (DATE_ROLEPLAYS.find((r) => r.id === lr.pick) ?? (lr.title ? { title: lr.title, icon: lr.icon ?? "🎬" } : undefined)) : undefined;
  if (lr && lastDef) {
    const [names, myLast] = await Promise.all([
      namesOf(db, [lr.a_id, lr.b_id]),
      viewerId
        ? db.query<{ pick: string }>(`select pick from situation_votes where day = $1 and user_id = $2`, [lr.day, viewerId]).then((r) => r.rows[0]?.pick ?? null)
        : Promise.resolve(null),
    ]);
    last = {
      day: lr.day,
      title: lastDef.title,
      icon: lastDef.icon,
      votes: lr.votes,
      total: lr.total,
      cast: [names.get(lr.a_id) ?? "", names.get(lr.b_id) ?? ""],
      room_path: `/watch/${lr.party_id}`,
      my_pick: myLast,
      won: myLast === lr.pick,
    };
  }
  return {
    day,
    closes_at: closesAt(day).toISOString(),
    headline,
    cast: [
      { id: a.id, name: a.name, hue: a.hue, portrait: a.portrait },
      { id: b.id, name: b.name, hue: b.hue, portrait: b.portrait },
    ],
    choices,
    my_pick: mine.rows[0]?.pick ?? null,
    total: [...tally.values()].reduce((s, n) => s + n, 0),
    last,
  };
}
