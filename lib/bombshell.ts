/**
 * The bombshell (David, 2026-11-27: "Do 1-6"): mid-season, the audience votes one audition into the house. After the
 * first rose ceremony of a Botchelor season the vote opens on the shortlisted auditions that didn't make the cast
 * (lib/auditions.ts, status 'approved'), and when the next ceremony's "Who goes home?" ballot has opened (Thursday) the
 * pick walks in as a suitor. A newcomer is safe at their first ceremony (bombshellImmune, read by lib/ceremony.ts
 * runCeremony): the week judges the dates they never had the days for.
 *
 * One vote a viewer, changeable until it closes. Nobody voted: the audition with the most casting votes walks in, so the
 * twist still lands on a quiet week. BOMBSHELL=0 turns it off. $0: rows and templates, no model call.
 */
import { ceremonyVoteOpensAt, ceremonyWeek } from "./ceremony";
import type { Db } from "./db";
import { shortName } from "./names";
import { notify, notifyAll } from "./notifications";
import { portraitPathSql } from "./portrait-sql";
import { forgetLoadedSeasonCast } from "./season-cast";
import { ceremonySundays, nextCeremonySunday, type SeasonFormatDef } from "./season-format";
import { seasonFormatNow } from "./season-format-store";
import { seasonIdOf } from "./season-window";
import { winnerOf } from "./situations";

type Env = Record<string, string | undefined>;
export const bombshellOn = (env: Env = process.env): boolean => env.BOMBSHELL?.trim() !== "0";

/** The ceremony after which the vote opens (the first). */
export const BOMBSHELL_AFTER_WEEK = 1;
/** How many auditions are on the ballot at most. */
export const BOMBSHELL_CHOICES = 4;
const HOUR_MS = 3_600_000;

type Choice = { id: string; name: string };
type Row = { season_id: string; opens_at: string | Date; closes_at: string | Date; choices: Choice[]; joined: string | null; joined_at: string | Date | null };

const rowOf = async (db: Db, seasonId: string): Promise<Row | null> =>
  (await db.query<Row>(`select season_id, opens_at, closes_at, choices, joined, joined_at from bombshells where season_id = $1`, [seasonId])).rows[0] ?? null;

async function tallyOf(db: Db, seasonId: string): Promise<Map<string, number>> {
  const { rows } = await db.query<{ pick: string; n: number }>(`select pick, count(*)::int as n from bombshell_votes where season_id = $1 group by pick`, [seasonId]);
  return new Map(rows.map((r) => [r.pick, r.n]));
}

/** The shortlisted auditions not on the cast, most casting votes first: the ballot. */
async function candidates(db: Db, seasonId: string): Promise<Choice[]> {
  const { rows } = await db.query<Choice>(
    `select a.character_id as id, c.name
       from cast_auditions a join characters c on c.id = a.character_id
      where a.season_id = $1 and a.status = 'approved' and c.visibility = 'public' and c.owner_id is distinct from 'deleted'
        and not exists (select 1 from season_casts s where s.season_id = $1 and s.character_id = a.character_id)
      order by (select count(*) from audition_votes v where v.season_id = a.season_id and v.character_id = a.character_id) desc, a.created_at, a.character_id
      limit $2`,
    [seasonId, BOMBSHELL_CHOICES],
  );
  return rows;
}

/** When the pick walks in: an hour after the next ceremony's ballot opened, so it never lands on that ballot. */
export const bombshellClosesAt = (nextHeldOn: string): Date => new Date(ceremonyVoteOpensAt(nextHeldOn).getTime() + HOUR_MS);

/**
 * The hourly lobby job's part: open the vote once the first ceremony is held (with a regular ceremony still to come),
 * and bring the pick in once it closes. Returns what it did, or null.
 */
export async function runDueBombshell(db: Db, now: Date = new Date(), env: Env = process.env): Promise<{ opened: boolean } | { joined: string } | null> {
  if (!bombshellOn(env)) return null;
  const def = await seasonFormatNow(db, now);
  if (!def.lead) return null;
  const seasonId = seasonIdOf(now);
  const row = await rowOf(db, seasonId);
  if (!row) return openVote(db, def, seasonId, now);
  if (row.joined_at || now < new Date(row.closes_at)) return null;
  return bringIn(db, row, now);
}

async function openVote(db: Db, def: SeasonFormatDef, seasonId: string, now: Date): Promise<{ opened: boolean } | null> {
  const held = (await db.query<{ week: number }>(`select week from ceremonies where season_id = $1 and held_at is not null and not finale order by held_on`, [seasonId])).rows;
  if (held.length !== BOMBSHELL_AFTER_WEEK) return null;
  const next = nextCeremonySunday(def, now);
  if (!next || ceremonyWeek(def, next, now).finale || ceremonySundays(def, now).indexOf(next) < BOMBSHELL_AFTER_WEEK) return null;
  const closes = bombshellClosesAt(next);
  if (now >= closes) return null;
  const choices = await candidates(db, seasonId);
  if (choices.length < 2) return null;
  const ins = await db.query(`insert into bombshells (season_id, opens_at, closes_at, choices) values ($1, $2, $3, $4::jsonb) on conflict do nothing returning season_id`, [
    seasonId,
    now.toISOString(),
    closes.toISOString(),
    JSON.stringify(choices),
  ]);
  return { opened: ins.rows.length > 0 };
}

async function bringIn(db: Db, row: Row, now: Date): Promise<{ joined: string } | null> {
  const tally = await tallyOf(db, row.season_id);
  // Only a choice still free to join (one may have been cast or withdrawn since the ballot froze).
  const free = new Set((await candidates(db, row.season_id)).map((c) => c.id));
  const open = row.choices.filter((c) => free.has(c.id));
  const pick = winnerOf(open, tally) ?? open[0] ?? null;
  const claimed = await db.query(`update bombshells set joined_at = $2, joined = $3 where season_id = $1 and joined_at is null returning season_id`, [row.season_id, now.toISOString(), pick?.id ?? null]);
  if (!claimed.rows.length || !pick) return null;
  const slot = (await db.query<{ n: number }>(`select coalesce(max(slot), 0)::int + 1 as n from season_casts where season_id = $1`, [row.season_id])).rows[0].n;
  await db.query(`insert into season_casts (season_id, character_id, slot, source) values ($1, $2, $3, 'suitor') on conflict (season_id, character_id) do update set withdrawn_at = null`, [
    row.season_id,
    pick.id,
    slot,
  ]);
  forgetLoadedSeasonCast();
  const name = shortName(pick.name);
  const votes = tally.get(pick.id) ?? 0;
  const owner = (await db.query<{ owner_id: string | null; is_house: boolean }>(`select owner_id, is_house from characters where id = $1`, [pick.id])).rows[0];
  if (owner && !owner.is_house && owner.owner_id) {
    await notify(db, owner.owner_id, {
      kind: "ceremony_held",
      title: `💣 ${name} is The Botchelor's bombshell`,
      body: `${votes ? "The audience voted" : "The casting votes put"} ${name} into the house mid-season. They're safe at their first ceremony.`,
      link: `/characters/${pick.id}`,
    }).catch(() => {});
  }
  const voters = (await db.query<{ user_id: string }>(`select user_id from bombshell_votes where season_id = $1`, [row.season_id])).rows.map((v) => v.user_id).filter((u) => u !== owner?.owner_id);
  if (voters.length) {
    await notifyAll(db, voters, { kind: "ceremony_held", title: `💣 The bombshell: ${name} walks in`, body: `${name} joins the suitors tonight and is safe on Sunday.`, link: "/watch#rose-ceremony" }).catch(() => {});
  }
  return { joined: pick.id };
}

export type BombshellVoteResult = { ok: true; pick: string } | { ok: false; status: number; error: string; message: string };

/** A vote (or a changed one) for who walks in: one a viewer, until it closes. */
export async function voteBombshell(db: Db, userId: string, pick: string, now: Date = new Date()): Promise<BombshellVoteResult> {
  const row = bombshellOn() ? await rowOf(db, seasonIdOf(now)) : null;
  if (!row || row.joined_at || now >= new Date(row.closes_at)) return { ok: false, status: 404, error: "no_bombshell", message: "No bombshell vote is open." };
  if (!row.choices.some((c) => c.id === pick)) return { ok: false, status: 400, error: "not_on_ballot", message: "That character isn't on this ballot." };
  await db.query(
    `insert into bombshell_votes (season_id, user_id, pick) values ($1, $2, $3)
       on conflict (season_id, user_id) do update set pick = excluded.pick, updated_at = now()`,
    [row.season_id, userId, pick],
  );
  return { ok: true, pick };
}

/** Who joined as the bombshell at or after `since`: safe at that ceremony (lib/ceremony.ts runCeremony). */
export async function bombshellImmune(db: Db, seasonId: string, since: Date): Promise<Set<string>> {
  const { rows } = await db.query<{ joined: string }>(`select joined from bombshells where season_id = $1 and joined is not null and joined_at >= $2`, [seasonId, since.toISOString()]);
  return new Set(rows.map((r) => r.joined));
}

export type BombshellFace = { id: string; name: string; hue: number | null; portrait: string | null };
export type BombshellBoard = {
  state: "open" | "joined";
  closes_at: string;
  /** With counts once this viewer has voted (the card decides whether to show them, the empty-room rule). */
  choices: (BombshellFace & { votes: number })[];
  my_pick: string | null;
  total: number;
  joined: BombshellFace | null;
};

/** The vote while it's open, or who walked in: for the Botchelor card. Null on a season without one. */
export async function bombshellBoard(db: Db, viewerId: string | null, now: Date = new Date()): Promise<BombshellBoard | null> {
  if (!bombshellOn()) return null;
  const row = await rowOf(db, seasonIdOf(now));
  if (!row) return null;
  const ids = row.choices.map((c) => c.id);
  const [faces, tally, mine] = await Promise.all([
    db.query<BombshellFace>(`select c.id, c.name, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait from characters c where c.id = any($1)`, [ids]),
    tallyOf(db, row.season_id),
    viewerId ? db.query<{ pick: string }>(`select pick from bombshell_votes where season_id = $1 and user_id = $2`, [row.season_id, viewerId]) : Promise.resolve({ rows: [] as { pick: string }[] }),
  ]);
  const faceOf = new Map(faces.rows.map((f) => [f.id, f]));
  const face = (c: Choice): BombshellFace => faceOf.get(c.id) ?? { id: c.id, name: c.name, hue: null, portrait: null };
  const joined = row.joined ? row.choices.find((c) => c.id === row.joined) : undefined;
  if (row.joined_at) return joined ? { state: "joined", closes_at: new Date(row.closes_at).toISOString(), choices: [], my_pick: null, total: 0, joined: face(joined) } : null;
  const myPick = mine.rows[0]?.pick ?? null;
  return {
    state: "open",
    closes_at: new Date(row.closes_at).toISOString(),
    choices: row.choices.map((c) => ({ ...face(c), votes: myPick ? (tally.get(c.id) ?? 0) : 0 })),
    my_pick: myPick,
    total: myPick ? [...tally.values()].reduce((s, n) => s + n, 0) : 0,
    joined: null,
  };
}
