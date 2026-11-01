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
 */
import type { Db } from "./db";
import { seedFrom } from "./engine";
import { notifyAll } from "./notifications";
import { DATE_ROLEPLAYS, fillPremise, termsFor, type DateRoleplay, type DateRoleplayDef } from "./roleplays";
import { seasonCastIds } from "./season-cast";
import { createTemplateParty } from "./watch";

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
 * date made just after midnight on the 1st is still last month's pair.
 */
export function situationPair(day: string): [string, string] | null {
  const cast = seasonCastIds(new Date(`${day}T12:00:00Z`));
  if (cast.length < 2) return null;
  const i = seedFrom("situation-a", day) % cast.length;
  const j = (i + 1 + (seedFrom("situation-b", day) % (cast.length - 1))) % cast.length;
  return [cast[i], cast[j]];
}

export type VoteResult = { ok: true; pick: string } | { ok: false; status: number; error: string; message: string };

/** One viewer's vote on today's situation (a second vote changes it). Only today's three choices count. */
export async function voteSituation(db: Db, userId: string, pick: string, now: Date = new Date()): Promise<VoteResult> {
  const day = utcDay(now);
  if (!situationChoices(day).some((c) => c.id === pick)) {
    return { ok: false, status: 400, error: "not_on_the_ballot", message: "That isn't one of today's three situations." };
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

/** A day's winner: most votes, ties to the earlier choice; null when nobody voted. */
export function winnerOf(choices: readonly DateRoleplayDef[], tally: Map<string, number>): DateRoleplayDef | null {
  let best: DateRoleplayDef | null = null;
  for (const c of choices) if ((tally.get(c.id) ?? 0) > 0 && (!best || (tally.get(c.id) ?? 0) > (tally.get(best.id) ?? 0))) best = c;
  return best;
}

export type SituationPlayed =
  | { played: true; day: string; pick: string; party_id: string; room_path: string }
  | { played: false; day: string; reason: "already" | "no_votes" | "no_cast" | "failed" };

/**
 * The hourly lobby run: once yesterday's vote has closed, make its date, once. A claim row first (so two runs can't both
 * make it); a date that couldn't be made drops the claim, so the next hour tries again. Only yesterday: a day the job
 * missed entirely isn't made late.
 */
export async function playVotedSituation(db: Db, now: Date = new Date()): Promise<SituationPlayed> {
  const day = utcDay(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const tally = await counts(db, day);
  const choices = situationChoices(day);
  const winner = winnerOf(choices, tally);
  if (!winner) return { played: false, day, reason: "no_votes" };
  const pair = situationPair(day);
  if (!pair) return { played: false, day, reason: "no_cast" };
  const total = [...tally.values()].reduce((s, n) => s + n, 0);
  const claimed = await db.query(
    `insert into situation_nights (day, a_id, b_id, pick, votes, total) values ($1, $2, $3, $4, $5, $6)
     on conflict (day) do nothing returning day`,
    [day, pair[0], pair[1], winner.id, tally.get(winner.id) ?? 0, total],
  );
  if (!claimed.rows.length) return { played: false, day, reason: "already" };
  const roleplay: DateRoleplay = { ...termsFor(winner, pair[0]), agreed: "auto" };
  const room = await createTemplateParty(db, pair[0], pair[1], { roleplay }).catch(() => null);
  if (!room?.ok) {
    await db.query(`delete from situation_nights where day = $1 and party_id is null`, [day]);
    return { played: false, day, reason: "failed" };
  }
  await db.query(`update situation_nights set party_id = $2 where day = $1`, [day, room.id]);
  const names = await namesOf(db, pair);
  const cast = pair.map((id) => ({ id, name: names.get(id) ?? "" }));
  const voters = (await db.query<{ user_id: string; pick: string }>(`select user_id, pick from situation_votes where day = $1`, [day])).rows;
  const body = `${cast[0].name} × ${cast[1].name}: ${fillPremise(termsFor(winner, pair[0]), cast)}`;
  await notifyAll(db, voters.filter((v) => v.pick === winner.id).map((v) => v.user_id), {
    kind: "situation_on",
    title: `Your pick won: ${winner.title}`,
    body,
    link: room.room_path,
  });
  await notifyAll(db, voters.filter((v) => v.pick !== winner.id).map((v) => v.user_id), {
    kind: "situation_on",
    title: `The viewers picked ${winner.title}`,
    body,
    link: room.room_path,
  });
  return { played: true, day, pick: winner.id, party_id: room.id, room_path: room.room_path };
}

async function namesOf(db: Db, ids: string[]): Promise<Map<string, string>> {
  const { rows } = await db.query<{ id: string; name: string }>(`select id, name from characters where id = any($1)`, [ids]);
  return new Map(rows.map((r) => [r.id, r.name]));
}

export type SituationCast = { id: string; name: string; hue: number | null };
export type SituationChoice = { id: string; title: string; icon: string; premise: string; votes: number };

/** Everything the vote's card shows: today's vote, and how the last one went. */
export type SituationBoard = {
  day: string;
  closes_at: string;
  cast: [SituationCast, SituationCast];
  choices: SituationChoice[];
  my_pick: string | null;
  total: number;
  /** The last vote that made a date (yesterday's, once it's on): what won, by how much, and the room to watch it in. */
  last: { day: string; title: string; icon: string; votes: number; total: number; cast: [string, string]; room_path: string; my_pick: string | null; won: boolean } | null;
};

/** The card's data for one viewer. null when the season has no cast to deal from. */
export async function situationBoard(db: Db, viewerId: string | null, now: Date = new Date()): Promise<SituationBoard | null> {
  const day = utcDay(now);
  const pair = situationPair(day);
  if (!pair) return null;
  const [chars, tally, mine, lastRow] = await Promise.all([
    db.query<{ id: string; name: string; hue: number | null }>(`select id, name, avatar_hue as hue from characters where id = any($1)`, [pair]),
    counts(db, day),
    viewerId
      ? db.query<{ pick: string }>(`select pick from situation_votes where day = $1 and user_id = $2`, [day, viewerId])
      : Promise.resolve({ rows: [] as { pick: string }[] }),
    db.query<{ day: string; a_id: string; b_id: string; pick: string; votes: number; total: number; party_id: string }>(
      `select day, a_id, b_id, pick, votes, total, party_id from situation_nights where party_id is not null and day < $1 order by day desc limit 1`,
      [day],
    ),
  ]);
  const byId = new Map(chars.rows.map((c) => [c.id, c]));
  const a = byId.get(pair[0]);
  const b = byId.get(pair[1]);
  if (!a || !b) return null;
  const cast = [a, b].map((c) => ({ id: c.id, name: c.name }));
  const choices = situationChoices(day).map((c) => ({
    id: c.id,
    title: c.title,
    icon: c.icon,
    premise: fillPremise(termsFor(c, a.id), cast),
    votes: tally.get(c.id) ?? 0,
  }));
  let last: SituationBoard["last"] = null;
  const lr = lastRow.rows[0];
  const lastDef = lr ? DATE_ROLEPLAYS.find((r) => r.id === lr.pick) : undefined;
  if (lr && lastDef) {
    const names = await namesOf(db, [lr.a_id, lr.b_id]);
    const myLast = viewerId
      ? ((await db.query<{ pick: string }>(`select pick from situation_votes where day = $1 and user_id = $2`, [lr.day, viewerId])).rows[0]?.pick ?? null)
      : null;
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
    cast: [
      { id: a.id, name: a.name, hue: a.hue },
      { id: b.id, name: b.name, hue: b.hue },
    ],
    choices,
    my_pick: mine.rows[0]?.pick ?? null,
    total: [...tally.values()].reduce((s, n) => s + n, 0),
    last,
  };
}
