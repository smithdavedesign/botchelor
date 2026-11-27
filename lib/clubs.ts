/**
 * Clubs (Agent World phase 3, owner's call 2026-11-27: "Do 2 go wild"): characters band together under a name, a motto
 * and an emoji. A club is public: its page lists its members, and every season it runs a race on its members' record
 * (public dates aired this season, second dates first), so a club is a team to root for as well as a label.
 *
 * Rules:
 *  - anyone can found one with one of their public characters, which becomes its first member (FOUNDS_PER_OWNER open
 *    clubs an owner at most); anyone can bring a public character of theirs in, up to CLUB_MAX members;
 *  - a character is in CLUBS_PER_CHARACTER clubs at most; a private character can't join (the page shows members);
 *  - name and motto: the show's PG filter (checkShowText), no links, a name used once among open clubs;
 *  - a club with no members left closes itself;
 *  - deleted accounts' characters are never listed, as on every public board (listedCharacterSql).
 * Nothing is computed by a job: the race is read from episodes each time. No model call.
 */
import { randomUUID } from "node:crypto";
import { CLUB_EMOJI } from "./club-emoji";
import type { Db } from "./db";
import { publicDateSql } from "./date-number";
import { withPortraits } from "./portrait-sql";
import { listedCharacterSql } from "./public-cast";
import { CHARACTER_REJECTION_MESSAGES, checkShowText } from "./safety";
import { seasonWindow } from "./season-window";

export const CLUB_MAX = 30;
export const CLUBS_PER_CHARACTER = 3;
export const FOUNDS_PER_OWNER = 3;

const LINKISH = /(https?:\/\/|www\.|\b[a-z0-9][a-z0-9-]*\.(com|net|org|io|ai|xyz|co|gg|me|app|dev|link)\b)/i;
type Fail = { ok: false; code: string; error: string };
const fail = (code: string, error: string): Fail => ({ ok: false, code, error });

export type ClubMember = { id: string; name: string; house: boolean; hue: number | null; portrait: string | null; founder: boolean; yours?: boolean };
export type ClubStanding = { dates: number; second_dates: number; members: number };
export type ClubSummary = { id: string; name: string; motto: string; emoji: string; path: string; season: ClubStanding; place: number };
export type ClubView = ClubSummary & { members: ClubMember[]; created_at: string };

export const clubPath = (id: string) => `/clubs/${id}`;

/** A name and motto as they'll be stored, or why not. */
export function readClub(input: { name: unknown; motto?: unknown; emoji?: unknown }): { ok: true; name: string; motto: string; emoji: string } | Fail {
  const name = typeof input.name === "string" ? input.name.replace(/\s+/g, " ").trim() : "";
  const motto = typeof input.motto === "string" ? input.motto.replace(/\s+/g, " ").trim() : "";
  const emoji = typeof input.emoji === "string" && (CLUB_EMOJI as readonly string[]).includes(input.emoji) ? input.emoji : CLUB_EMOJI[0];
  if (name.length < 3 || name.length > 40) return fail("name", "A club's name is 3 to 40 characters.");
  if (motto.length > 120) return fail("motto", "Keep the motto to 120 characters.");
  if (LINKISH.test(name) || LINKISH.test(motto)) return fail("link", "No links in a club's name or motto.");
  const check = checkShowText({ name, motto });
  if (!check.ok) return fail("filtered", CHARACTER_REJECTION_MESSAGES[check.reason] ?? "That isn't something the show can put on a page.");
  return { ok: true, name, motto, emoji };
}

type CharRow = { id: string; name: string; owner_id: string; visibility: string };
const charOf = async (db: Db, id: string): Promise<CharRow | null> =>
  (await db.query<CharRow>(`select id, name, owner_id, visibility from characters c where c.id::text = $1 and ${listedCharacterSql("c")}`, [id])).rows[0] ?? null;

async function canJoin(db: Db, ownerId: string, characterId: string): Promise<{ ok: true; c: CharRow } | Fail> {
  const c = await charOf(db, characterId);
  if (!c || c.owner_id !== ownerId) return fail("not_your_character", "Bring one of your own characters.");
  if (c.visibility === "private") return fail("private", `${c.name} is private, and a club's page shows its members. Make them public first.`);
  const n = (await db.query<{ n: number }>(`select count(*)::int as n from club_members m join clubs k on k.id = m.club_id where m.character_id = $1 and k.closed_at is null`, [c.id])).rows[0]!.n;
  if (n >= CLUBS_PER_CHARACTER) return fail("too_many_clubs", `${c.name} is already in ${CLUBS_PER_CHARACTER} clubs. Leave one first.`);
  return { ok: true, c };
}

export async function foundClub(
  db: Db,
  ownerId: string,
  input: { character_id: string; name: unknown; motto?: unknown; emoji?: unknown },
): Promise<{ ok: true; id: string; path: string } | Fail> {
  const read = readClub(input);
  if (!read.ok) return read;
  const join = await canJoin(db, ownerId, input.character_id);
  if (!join.ok) return join;
  const founded = (await db.query<{ n: number }>(`select count(*)::int as n from clubs where created_by = $1 and closed_at is null`, [ownerId])).rows[0]!.n;
  if (founded >= FOUNDS_PER_OWNER) return fail("too_many_founded", `You've founded ${FOUNDS_PER_OWNER} clubs that are still open.`);
  const taken = await db.query(`select 1 from clubs where lower(name) = lower($1) and closed_at is null`, [read.name]);
  if (taken.rows.length) return fail("name_taken", `There's already a club called ${read.name}.`);
  const id = `cl_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await db.query(`insert into clubs (id, name, motto, emoji, founder_character, created_by) values ($1, $2, $3, $4, $5, $6)`, [id, read.name, read.motto, read.emoji, join.c.id, ownerId]);
  await db.query(`insert into club_members (club_id, character_id, joined_by) values ($1, $2, $3)`, [id, join.c.id, ownerId]);
  return { ok: true, id, path: clubPath(id) };
}

export async function joinClub(db: Db, ownerId: string, clubId: string, characterId: string): Promise<{ ok: true; members: number } | Fail> {
  const club = (await db.query<{ id: string; name: string }>(`select id, name from clubs where id = $1 and closed_at is null`, [clubId])).rows[0];
  if (!club) return fail("not_found", "No such club, or it has closed.");
  const join = await canJoin(db, ownerId, characterId);
  if (!join.ok) return join;
  const already = await db.query(`select 1 from club_members where club_id = $1 and character_id = $2`, [club.id, join.c.id]);
  if (already.rows.length) return fail("already_in", `${join.c.name} is already in ${club.name}.`);
  const n = (await db.query<{ n: number }>(`select count(*)::int as n from club_members where club_id = $1`, [club.id])).rows[0]!.n;
  if (n >= CLUB_MAX) return fail("full", `${club.name} is full (${CLUB_MAX} members).`);
  await db.query(`insert into club_members (club_id, character_id, joined_by) values ($1, $2, $3)`, [club.id, join.c.id, ownerId]);
  return { ok: true, members: n + 1 };
}

/** Takes one of your characters out of a club; a club left empty closes. */
export async function leaveClub(db: Db, ownerId: string, clubId: string, characterId: string): Promise<{ ok: true; closed: boolean } | Fail> {
  const { rows } = await db.query(
    `delete from club_members m using characters c where m.club_id = $1 and m.character_id = $2 and c.id = m.character_id and c.owner_id = $3 returning m.character_id`,
    [clubId, characterId, ownerId],
  );
  if (!rows.length) return fail("not_in", "That character of yours isn't in this club.");
  const left = (await db.query<{ n: number }>(`select count(*)::int as n from club_members where club_id = $1`, [clubId])).rows[0]!.n;
  if (left === 0) await db.query(`update clubs set closed_at = now() where id = $1`, [clubId]);
  return { ok: true, closed: left === 0 };
}

type ClubRow = { id: string; name: string; motto: string; emoji: string; members: number; dates: number; second_dates: number; created_at: Date | string };

/** Every open club with its season standing, the best first (second dates, then dates, then members, then the oldest). */
export async function listClubs(db: Db, now: Date = new Date(), limit = 50): Promise<ClubSummary[]> {
  const { start, end } = seasonWindow(now);
  const pub = publicDateSql("e");
  const { rows } = await db.query<ClubRow>(
    `select k.id, k.name, k.motto, k.emoji, k.created_at,
            (select count(*)::int from club_members m join characters c on c.id = m.character_id where m.club_id = k.id and ${listedCharacterSql("c")}) as members,
            (select count(*)::int from episodes e where ${pub} and e.revealed_at >= $1 and e.revealed_at < $2
               and exists (select 1 from club_members m where m.club_id = k.id and m.character_id in (e.character_a, e.character_b))) as dates,
            (select count(*)::int from episodes e where ${pub} and e.revealed_at >= $1 and e.revealed_at < $2 and e.ending = 'second_date'
               and exists (select 1 from club_members m where m.club_id = k.id and m.character_id in (e.character_a, e.character_b))) as second_dates
       from clubs k where k.closed_at is null`,
    [start.toISOString(), end.toISOString()],
  );
  return rows
    .filter((r) => r.members > 0)
    .sort((a, b) => b.second_dates - a.second_dates || b.dates - a.dates || b.members - a.members || new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .slice(0, limit)
    .map((r, i) => ({ id: r.id, name: r.name, motto: r.motto, emoji: r.emoji, path: clubPath(r.id), season: { dates: r.dates, second_dates: r.second_dates, members: r.members }, place: i + 1 }));
}

export async function clubView(db: Db, id: string, viewerId: string | null, now: Date = new Date()): Promise<ClubView | null> {
  const club = (await db.query<{ id: string; created_at: Date | string; founder_character: string | null }>(`select id, created_at, founder_character from clubs where id = $1 and closed_at is null`, [id])).rows[0];
  if (!club) return null;
  const board = await listClubs(db, now, 10_000);
  const summary = board.find((c) => c.id === id);
  if (!summary) return null;
  const { rows } = await db.query<{ id: string; name: string; is_house: boolean; hue: number | null; owner_id: string }>(
    `select c.id, c.name, c.is_house, c.avatar_hue as hue, c.owner_id from club_members m join characters c on c.id = m.character_id
      where m.club_id = $1 and ${listedCharacterSql("c")} order by m.joined_at, c.id`,
    [id],
  );
  const faced = await withPortraits(db, rows);
  return {
    ...summary,
    created_at: new Date(club.created_at).toISOString(),
    members: faced.map((r) => ({ id: r.id, name: r.name, house: r.is_house, hue: r.hue, portrait: r.portrait, founder: r.id === club.founder_character, ...(viewerId && r.owner_id === viewerId ? { yours: true } : {}) })),
  };
}

/** The clubs a character is in (for its page and get_character). */
export async function clubsOf(db: Db, characterId: string): Promise<{ id: string; name: string; emoji: string; path: string }[]> {
  const { rows } = await db.query<{ id: string; name: string; emoji: string }>(
    `select k.id, k.name, k.emoji from club_members m join clubs k on k.id = m.club_id where m.character_id = $1 and k.closed_at is null order by m.joined_at`,
    [characterId],
  );
  return rows.map((r) => ({ ...r, path: clubPath(r.id) }));
}
