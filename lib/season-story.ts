/**
 * The season's story so far, for the night pages (David, 2026-11-27: "Do 1-6"). Two reads over what has already aired:
 *
 *  - "Previously on" (SEASON_PREVIOUSLY=0 turns it off): two or three lines at the top of the season page and the
 *    Botchelor card, the way a TV episode opens. Last Sunday's ceremony, then the producer's line for today
 *    (lib/producer.ts storyToday), else the latest storyline it staged.
 *  - "The tea" (TEA_BOARD=0 turns it off): who's feuding, who's flirting and who said what. The producer's beats of the
 *    last TEA_DAYS days, each its public logline (the line already on Watch), the faces it is about, and the aired public
 *    date where it played out, when there is one. Never `why` or the evidence: those stay with the owner.
 *
 * $0: rows the producer and the ceremonies already wrote. Two queries for the tea, however many beats.
 */
import type { Db } from "./db";
import { shortName } from "./names";
import { portraitPathSql } from "./portrait-sql";
import { producerOn, storyToday } from "./producer";
import { REPORT_HIDE_THRESHOLD } from "./rules";

type Env = Record<string, string | undefined>;
export const seasonPreviouslyOn = (env: Env = process.env): boolean => env.SEASON_PREVIOUSLY?.trim() !== "0";
export const teaBoardOn = (env: Env = process.env): boolean => env.TEA_BOARD?.trim() !== "0" && producerOn(env);

export const TEA_DAYS = 7;
export const TEA_MAX = 6;
const DAY_MS = 86_400_000;
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

type HeldCeremony = { week: number; finale: boolean; voted: string | null; lead: string | null; final_rose: string | null; remaining: string[] };

/** The ceremony's sentence for "Previously on" (pure). */
export function ceremonyRecapLine(c: HeldCeremony, name: (id: string) => string): string {
  if (c.finale) return c.final_rose ? `The finale: ${name(c.final_rose)} took the final rose.` : "The finale has been held.";
  const gone = [c.voted, c.lead].filter((s): s is string => Boolean(s)).map(name);
  const when = c.week === 1 ? "At the first rose ceremony" : `At week ${c.week}'s ceremony`;
  const home = gone.length ? `${gone.join(" and ")} went home` : "nobody went home";
  return `${when}, ${home}. ${c.remaining.length} ${c.remaining.length === 1 ? "suitor is" : "suitors are"} still in.`;
}

/** "Previously on The Botchelor": up to three lines, or null when the season has nothing aired to recap yet. */
export async function seasonPreviously(db: Db, seasonId: string, now: Date = new Date(), env: Env = process.env): Promise<string[] | null> {
  if (!seasonPreviouslyOn(env)) return null;
  const [cer, today, latest] = await Promise.all([
    db.query<{ week: number; finale: boolean; eliminated_by_vote: string | null; eliminated_by_lead: string | null; final_rose: string | null; remaining: string[] | null }>(
      `select week, finale, eliminated_by_vote, eliminated_by_lead, final_rose, remaining from ceremonies where season_id = $1 and held_at is not null order by held_on desc limit 1`,
      [seasonId],
    ),
    storyToday(db, now, env).catch(() => null),
    db.query<{ logline: string | null; previously: string | null }>(
      `select logline, previously from story_beats where season_id = $1 and day < $2 and status in ('staged', 'played', 'missed') order by day desc limit 1`,
      [seasonId, dayOf(now)],
    ).catch(() => ({ rows: [] as { logline: string | null; previously: string | null }[] })),
  ]);
  const lines: string[] = [];
  const c = cer.rows[0];
  if (c) {
    const ids = [c.eliminated_by_vote, c.eliminated_by_lead, c.final_rose].filter((s): s is string => Boolean(s));
    const names = new Map((await db.query<{ id: string; name: string }>(`select id, name from characters where id = any($1)`, [ids])).rows.map((r) => [r.id, shortName(r.name)]));
    lines.push(
      ceremonyRecapLine(
        { week: c.week, finale: c.finale, voted: c.eliminated_by_vote, lead: c.eliminated_by_lead, final_rose: c.final_rose, remaining: c.remaining ?? [] },
        (id) => names.get(id) ?? "a suitor",
      ),
    );
  }
  if (today?.previously) lines.push(today.previously);
  else if (latest.rows[0]?.logline) lines.push(latest.rows[0].logline);
  if (today?.tonight) lines.push(today.tonight);
  return lines.length ? lines : null;
}

export type TeaFace = { id: string; name: string; hue: number | null; portrait: string | null; house: boolean };
export type TeaItem = { day: string; logline: string; faces: TeaFace[]; episode_id: string | null };

/** The tea: the last week's storylines, newest first, each linked to the date where it happened. */
export async function teaBoard(db: Db, seasonId: string, now: Date = new Date(), env: Env = process.env): Promise<TeaItem[]> {
  if (!teaBoardOn(env)) return [];
  const today = dayOf(now);
  const from = dayOf(new Date(now.getTime() - TEA_DAYS * DAY_MS));
  const { rows: beats } = await db.query<{ day: string; logline: string | null; who: string[] | null }>(
    `select day, logline, who from story_beats where season_id = $1 and day > $2 and day <= $3 and status in ('staged', 'played', 'missed') and logline is not null order by day desc limit $4`,
    [seasonId, from, today, TEA_MAX],
  );
  const list = beats.filter((b) => b.logline?.trim() && (b.who ?? []).length >= 2);
  if (!list.length) return [];
  const ids = [...new Set(list.flatMap((b) => b.who ?? []))];
  const [faces, eps] = await Promise.all([
    db.query<TeaFace & { visibility: string }>(`select c.id, c.name, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait, c.is_house as house, c.visibility from characters c where c.id = any($1)`, [ids]),
    // Aired public dates between any two of them since the window opened: matched to each beat in memory below.
    db.query<{ id: string; a: string; b: string; revealed_at: string | Date }>(
      `select e.id, e.character_a as a, e.character_b as b, e.revealed_at from episodes e
        where e.character_a = any($1) and e.character_b = any($1) and e.revealed_at >= $2 and e.visibility = 'public' and e.status = 'ready'
          and coalesce((e.setup ->> 'after_dark')::boolean, false) = false
          and (select count(*) from reports r where r.episode_id = e.id) < $3
        order by e.revealed_at`,
      [ids, `${from}T00:00:00.000Z`, REPORT_HIDE_THRESHOLD],
    ),
  ]);
  const faceOf = new Map(faces.rows.filter((f) => f.visibility === "public").map(({ visibility: _v, ...f }) => [f.id, f]));
  return list.flatMap((b) => {
    const who = (b.who ?? []).slice(0, 3);
    const fs = who.map((id) => faceOf.get(id)).filter((f): f is TeaFace => Boolean(f));
    if (fs.length < 2) return [];
    const [x, y] = who;
    const start = Date.parse(`${b.day}T00:00:00.000Z`);
    // The date it played out on: the first aired between the two on its day or the two after.
    const ep = eps.rows.find((e) => ((e.a === x && e.b === y) || (e.a === y && e.b === x)) && +new Date(e.revealed_at) >= start && +new Date(e.revealed_at) < start + 3 * DAY_MS);
    return [{ day: b.day, logline: b.logline!.trim(), faces: fs, episode_id: ep?.id ?? null }];
  });
}
