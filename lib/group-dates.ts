/**
 * Double dates (docs/PRDs/group-dates.md, David 2026-10-25: "group double dates… available for users and bots…
 * remember things about each person"). One night, two couples at one table — and underneath, each couple's own
 * episode, so everything pairwise (the engine, predictions, the graph, memory, reviews, airing) works unchanged.
 * The episodes share the night's venue and carry a `table` line about the other couple (lib/simulation.ts), and
 * episodes.group_id ties them together.
 *
 * Consent and money: the proposer's couple is theirs to book; the other couple's booker (the owner of its first
 * character) accepts the invite, and each booker spends one date when the night books — a self-double (both couples
 * yours) books at once and spends two. Either couple's partner may be a house character (the show plays them); a
 * whole house couple has no booker, so that's not a double — book the house cast one-on-one instead.
 *
 * Booking both sides runs through the same route as go_on_date (lib/group-dates-run.ts), so every rule — caps,
 * consent, the swipe gate, operator reserve — applies per booker at book time.
 */
import type { Db } from "./db";
import { seedFrom } from "./engine";
import { takenSql } from "./partners";
import { seasonCastIds } from "./season-cast";
import { shortName } from "./names";
import { notify } from "./notifications";
import type { PlaceId } from "./venues";

/** Where every double happens for now: the booth set for four (a reviewed backdrop, and literally named for it). */
export const DOUBLE_VENUE: PlaceId = "double_date";
/** An invite nobody answered lapses after this long. */
export const INVITE_DAYS = 7;
/** Waiting invites one creator may have open (sent or received doesn't matter: proposing is free). */
export const DOUBLE_MAX_PENDING = 3;

export type Couple = { character_id: string; partner_id: string };
/** One drawn meeting of a mixer: who meets whom, whose date it spends, and how it went. */
export type Rotation = { a: string; b: string; booker: string; episode_id?: string | null; failed?: string };
export type GroupNight = {
  id: string;
  kind: "double" | "mixer";
  venue: string;
  created_by: string;
  status: "invited" | "booked" | "declined" | "lapsed" | "half_booked" | "open" | "running" | "done" | "cancelled";
  invite_to: string | null;
  couple_a: Couple;
  couple_b: Couple;
  episode_a: string | null;
  episode_b: string | null;
  rotations: Rotation[] | null;
  created_at: string;
};

const night = (r: Record<string, unknown>): GroupNight => ({
  id: String(r.id),
  kind: r.kind as GroupNight["kind"],
  venue: String(r.venue),
  created_by: String(r.created_by),
  status: r.status as GroupNight["status"],
  invite_to: (r.invite_to as string | null) ?? null,
  couple_a: r.couple_a as Couple,
  couple_b: r.couple_b as Couple,
  episode_a: (r.episode_a as string | null) ?? null,
  episode_b: (r.episode_b as string | null) ?? null,
  rotations: (r.rotations as Rotation[] | null) ?? null,
  created_at: new Date(r.created_at as string).toISOString(),
});

type CharLite = { id: string; name: string; owner_id: string | null; is_house: boolean; visibility: string };

async function loadChars(db: Db, ids: string[]): Promise<Map<string, CharLite>> {
  const { rows } = await db.query<CharLite>(`select id, name, owner_id, is_house, visibility from characters where id = any($1)`, [ids]);
  return new Map(rows.map((r) => [r.id, r]));
}

/** The one line both actors at a table see about the other couple. Names only: their date is theirs. */
export function tableLine(other: { a: string; b: string }): string {
  return `It's a double date: ${shortName(other.a)} and ${shortName(other.b)} share your table, on a date of their own. Their names can come up; their date is theirs.`;
}

export type ProposeResult =
  | { ok: true; night: GroupNight; books_now: boolean }
  | { ok: false; error: string };

/**
 * Propose a double: your couple and another. Both couples yours → ready to book at once (the caller runs
 * bookDoubleNight, lib/group-dates-run.ts). The other couple another creator's → an invite + a notification
 * to its booker (the owner of with.character_id).
 */
export async function proposeDouble(db: Db, creatorId: string, mine: Couple, withCouple: Couple, now: Date = new Date()): Promise<ProposeResult> {
  await lapseOldInvites(db, now).catch(() => {});
  const ids = [mine.character_id, mine.partner_id, withCouple.character_id, withCouple.partner_id];
  if (new Set(ids).size !== 4) return { ok: false, error: "A double date is four different characters: two in your couple, two in theirs." };
  const chars = await loadChars(db, ids);
  for (const id of ids) if (!chars.get(id)) return { ok: false, error: `No character with id ${id} (search_characters finds ids).` };
  const own = chars.get(mine.character_id)!;
  if (own.owner_id !== creatorId || own.is_house) return { ok: false, error: "character_id: the first character of your couple must be one of your own." };
  const otherLead = chars.get(withCouple.character_id)!;
  if (otherLead.is_house || !otherLead.owner_id) {
    return { ok: false, error: "with_character: the other couple's first character is its booker's, so it can't be the house cast (its partner can). For a date with just the house cast, book one-on-one." };
  }
  if (otherLead.visibility === "private" && otherLead.owner_id !== creatorId) {
    return { ok: false, error: "with_character: no character with that id." };
  }
  const invitee = otherLead.owner_id === creatorId ? null : otherLead.owner_id;
  if (invitee) {
    const pending = await db.query(`select 1 from group_nights where status = 'invited' and (created_by = $1 or invite_to = $1)`, [creatorId]);
    if (pending.rows.length >= DOUBLE_MAX_PENDING) {
      return { ok: false, error: `${DOUBLE_MAX_PENDING} double-date invites are already open (list: true shows them; decline: <id> clears one).` };
    }
  }
  const inserted = (
    await db.query(
      `insert into group_nights (id, kind, venue, created_by, status, invite_to, couple_a, couple_b)
       values ($1, 'double', $2, $3, $4, $5, $6::jsonb, $7::jsonb) returning *`,
      [crypto.randomUUID(), DOUBLE_VENUE, creatorId, invitee ? "invited" : "booked", invitee, JSON.stringify(mine), JSON.stringify(withCouple)],
    )
  ).rows[0];
  const made = night(inserted);
  if (invitee) {
    await notify(db, invitee, {
      kind: "double_invite",
      title: "💞💞 A double date invite",
      body: `${shortName(own.name)} and ${shortName(chars.get(mine.partner_id)!.name)} want a double date with ${shortName(otherLead.name)} and ${shortName(chars.get(withCouple.partner_id)!.name)}. Accepting books both tables and spends one of your dates (the double-date tool at ?tools=all takes accept: "${made.id}", and /doubles/${made.id} has buttons).`,
      link: `/doubles/${made.id}`,
    }).catch(() => {});
  }
  return { ok: true, night: made, books_now: !invitee };
}

/** The invite, if it's still this user's to answer. */
export async function openInvite(db: Db, userId: string, nightId: string, now: Date = new Date()): Promise<GroupNight | null> {
  await lapseOldInvites(db, now).catch(() => {});
  const { rows } = await db.query(`select * from group_nights where id = $1 and invite_to = $2 and status = 'invited'`, [nightId, userId]);
  return rows.length ? night(rows[0]) : null;
}

/** Accepting flips the night to booked (the caller then books both sides); declining tells the proposer. */
export async function acceptDouble(db: Db, userId: string, nightId: string, now: Date = new Date()): Promise<GroupNight | null> {
  const open = await openInvite(db, userId, nightId, now);
  if (!open) return null;
  const { rows } = await db.query(`update group_nights set status = 'booked', decided_at = $2 where id = $1 and status = 'invited' returning *`, [
    nightId,
    now.toISOString(),
  ]);
  return rows.length ? night(rows[0]) : null;
}

export async function declineDouble(db: Db, userId: string, nightId: string, now: Date = new Date()): Promise<boolean> {
  const open = await openInvite(db, userId, nightId, now);
  if (!open) return false;
  await db.query(`update group_nights set status = 'declined', decided_at = $2 where id = $1`, [nightId, now.toISOString()]);
  await notify(db, open.created_by, {
    kind: "double_date",
    title: "💞 Not this time",
    body: "Your double-date invite was declined. Nothing was spent.",
    link: null,
  }).catch(() => {});
  return true;
}

/** This user's open invites and recent nights, newest first. */
export async function listDoubles(db: Db, userId: string, now: Date = new Date()): Promise<GroupNight[]> {
  await lapseOldInvites(db, now).catch(() => {});
  const { rows } = await db.query(
    `select * from group_nights where created_by = $1 or invite_to = $1 order by created_at desc limit 10`,
    [userId],
  );
  return rows.map(night);
}

async function lapseOldInvites(db: Db, now: Date): Promise<void> {
  await db.query(`update group_nights set status = 'lapsed', decided_at = $1 where status = 'invited' and created_at < $2`, [
    now.toISOString(),
    new Date(now.getTime() - INVITE_DAYS * 24 * 60 * 60_000).toISOString(),
  ]);
}

/* ------------------------------------------------ mixers (M2) ------------------------------------------------ */

/** A mixer runs once this many singles are in (and the doors have been open a short while, so others can join). */
export const MIXER_MIN = 4;
export const MIXER_MAX = 6;
/** Doors open at most this long: an open mixer that never fills is called off, and nothing is spent. */
export const MIXER_WAIT_HOURS = 24;
/** How long the doors stay open once enough are in, so a mixer isn't dealt the instant the fourth arrives. */
export const MIXER_DOORS_MINUTES = 30;
/** Where a mixer happens: dealt per night from the venues a crowd suits. */
const MIXER_VENUES: readonly PlaceId[] = ["dive_bar", "jazz_bar", "rooftop_bar", "night_market"];

export type MixerSeat = { character_id: string; name: string; booker: string };

async function mixerSeats(db: Db, nightId: string): Promise<MixerSeat[]> {
  const { rows } = await db.query<MixerSeat>(
    `select gs.character_id, c.name, gs.booker from group_night_seats gs join characters c on c.id = gs.character_id
      where gs.night_id = $1 order by gs.joined_at`,
    [nightId],
  );
  return rows;
}

/** The one open mixer (there's at most one: the next night), with its seats. */
export async function openMixer(db: Db): Promise<{ night: GroupNight; seats: MixerSeat[] } | null> {
  const { rows } = await db.query(`select * from group_nights where kind = 'mixer' and status = 'open' order by created_at limit 1`, [])
  if (!rows.length) return null;
  const g = night(rows[0]);
  return { night: g, seats: await mixerSeats(db, g.id) };
}

export type JoinResult = { ok: true; night: GroupNight; seats: MixerSeat[]; runs: string } | { ok: false; error: string };

/**
 * Put one of your characters in the next mixer (speed-dating night). Joining is consent to its rotations; your
 * character's rotation spends one of your dates when the night runs (the usual booking rules at run time).
 */
export async function joinMixer(db: Db, userId: string, characterId: string, now: Date = new Date()): Promise<JoinResult> {
  const mine = (
    await db.query<{ id: string; name: string }>(`select id, name from characters where id = $1 and owner_id = $2 and not is_house`, [characterId, userId])
  ).rows[0];
  if (!mine) return { ok: false, error: "join: one of your own characters (my_status lists them; create_character makes one)." };
  let open = await openMixer(db);
  if (!open) {
    const id = crypto.randomUUID();
    const venue = MIXER_VENUES[seedFrom(id) % MIXER_VENUES.length];
    const { rows } = await db.query(
      `insert into group_nights (id, kind, venue, created_by, status, couple_a, couple_b)
       values ($1, 'mixer', $2, $3, 'open', '{}'::jsonb, '{}'::jsonb) returning *`,
      [id, venue, userId],
    );
    open = { night: night(rows[0]), seats: [] };
  }
  if (open.seats.length >= MIXER_MAX) {
    return { ok: false, error: `This mixer is full (${MIXER_MAX}); it runs within the hour, and the next opens as soon as someone joins it.` };
  }
  const ins = await db.query(
    `insert into group_night_seats (night_id, character_id, booker) values ($1, $2, $3) on conflict do nothing returning character_id`,
    [open.night.id, characterId, userId],
  );
  if (!ins.rows.length) return { ok: false, error: `${shortName(mine.name)} is already in this mixer.` };
  const seats = await mixerSeats(db, open.night.id);
  const runs =
    seats.length >= MIXER_MIN
      ? `Within the hour (the doors stay open ~${MIXER_DOORS_MINUTES} minutes so others can join).`
      : `Once ${MIXER_MIN} are in (${seats.length} now); called off after ${MIXER_WAIT_HOURS}h if it never fills, and nothing is spent.`;
  void now;
  return { ok: true, night: open.night, seats, runs };
}

/** Take your character back out of a mixer that hasn't run. */
export async function leaveMixer(db: Db, userId: string, characterId: string): Promise<boolean> {
  const r = await db.query(
    `delete from group_night_seats gs using group_nights gn
      where gn.id = gs.night_id and gn.kind = 'mixer' and gn.status = 'open' and gs.character_id = $1 and gs.booker = $2
      returning gs.character_id`,
    [characterId, userId],
  );
  return r.rows.length > 0;
}

/* ------------------------------------------- the web's double picker ------------------------------------------- */

export type DoubleOption = { character_id: string; name: string; partner_id: string; partner_name: string };

/**
 * The couples a signed-in person can bring to a double from the thread's "Make it a double" (M1b): each of their
 * OTHER characters, paired with a dealt house date (the house cast books straight away, so the night always can).
 * `excluding`: the thread's own two characters, so the same character (or house member) isn't at both tables.
 */
export async function doubleOptions(db: Db, userId: string, excluding: string[]): Promise<DoubleOption[]> {
  const { rows } = await db.query<{ id: string; name: string }>(
    `select c.id, c.name from characters c
      where c.owner_id = $1 and not c.is_house and c.id <> all($2) and not ${takenSql("c")}
      order by c.created_at desc limit 6`,
    [userId, excluding],
  );
  const cast = seasonCastIds().filter((id) => !excluding.includes(id));
  if (!cast.length || !rows.length) return [];
  const houses = await loadChars(db, cast);
  return rows.map((c) => {
    const partner = cast[seedFrom(c.id) % cast.length];
    return { character_id: c.id, name: c.name, partner_id: partner, partner_name: houses.get(partner)?.name ?? "a house date" };
  });
}

/** The invite as its people see it on /doubles/[id]: both couples by name, and whose answer it waits on. */
export async function inviteView(
  db: Db,
  userId: string,
  nightId: string,
): Promise<{ id: string; status: GroupNight["status"]; yours_to_answer: boolean; couple_a: string[]; couple_b: string[]; episode_a: string | null; episode_b: string | null } | null> {
  const { rows } = await db.query(`select * from group_nights where id = $1 and kind = 'double' and (created_by = $2 or invite_to = $2)`, [nightId, userId]);
  if (!rows.length) return null;
  const g = night(rows[0]);
  const ids = [g.couple_a.character_id, g.couple_a.partner_id, g.couple_b.character_id, g.couple_b.partner_id];
  const chars = await loadChars(db, ids);
  const nameOf = (id: string) => chars.get(id)?.name ?? "someone";
  return {
    id: g.id,
    status: g.status,
    yours_to_answer: g.status === "invited" && g.invite_to === userId,
    couple_a: [nameOf(g.couple_a.character_id), nameOf(g.couple_a.partner_id)],
    couple_b: [nameOf(g.couple_b.character_id), nameOf(g.couple_b.partner_id)],
    episode_a: g.episode_a,
    episode_b: g.episode_b,
  };
}

export type GroupBooking = { nightId: string; kind: "double" | "mixer"; side: "a" | "b" | number; venue: PlaceId; table: string };

/**
 * What the booking route needs for one table of a night (app/api/episodes/route.ts, input.group_night): which side
 * this couple is, the shared venue, and the line about the other couple. Refused unless the caller is that side's
 * booker, the couple matches exactly, the night is booked (accepted) and that side isn't booked yet.
 */
export async function groupBookingFor(
  db: Db,
  nightId: string,
  userId: string,
  characterId: string,
  partnerId: string,
): Promise<{ ok: true; booking: GroupBooking } | { ok: false; status: number; error: string; message: string }> {
  const { rows } = await db.query(`select * from group_nights where id = $1`, [nightId]);
  if (!rows.length) return { ok: false, status: 404, error: "night_not_found", message: "No group night with that group_night id." };
  const g = night(rows[0]);
  if (g.kind === "mixer") {
    // A mixer rotation: drawn when the night ran (lib/group-dates-run.ts). Joining was the consent; the booker pays.
    const i = (g.rotations ?? []).findIndex((r) => r.a === characterId && r.b === partnerId);
    const r = i >= 0 ? g.rotations![i] : null;
    if (!r) return { ok: false, status: 409, error: "night_mismatch", message: "That pair isn't one of this mixer's rotations." };
    if (r.booker !== userId) return { ok: false, status: 403, error: "not_your_table", message: "This rotation is its own booker's to book." };
    if (g.status !== "running") return { ok: false, status: 409, error: "night_not_open", message: `This mixer is ${g.status}, so its rotations can't be booked.` };
    if (r.episode_id) return { ok: false, status: 409, error: "table_booked", message: "This rotation is already booked." };
    const seats = await mixerSeats(db, g.id);
    const others = seats.filter((x) => x.character_id !== characterId && x.character_id !== partnerId).map((x) => shortName(x.name));
    const table = `It's a speed-dating mixer: six lines with each match before the bell moves everyone on.${others.length ? ` Also here tonight: ${others.join(", ")}.` : ""}`;
    return { ok: true, booking: { nightId: g.id, kind: "mixer", side: i, venue: g.venue as PlaceId, table } };
  }
  const side: "a" | "b" | null =
    g.couple_a.character_id === characterId && g.couple_a.partner_id === partnerId
      ? "a"
      : g.couple_b.character_id === characterId && g.couple_b.partner_id === partnerId
        ? "b"
        : null;
  if (!side) return { ok: false, status: 409, error: "night_mismatch", message: "That couple isn't one of this double date's tables." };
  const booker = side === "a" ? g.created_by : (g.invite_to ?? g.created_by);
  if (booker !== userId) return { ok: false, status: 403, error: "not_your_table", message: "This table is the other couple's booker's to book." };
  if (g.status !== "booked") return { ok: false, status: 409, error: "night_not_open", message: `This double date is ${g.status}, so its tables can't be booked.` };
  if (side === "a" ? g.episode_a : g.episode_b) return { ok: false, status: 409, error: "table_booked", message: "This couple's table is already booked." };
  const other = side === "a" ? g.couple_b : g.couple_a;
  const chars = await loadChars(db, [other.character_id, other.partner_id]);
  const names = { a: chars.get(other.character_id)?.name ?? "someone", b: chars.get(other.partner_id)?.name ?? "someone" };
  return { ok: true, booking: { nightId: g.id, kind: "double", side, venue: g.venue as PlaceId, table: tableLine(names) } };
}

/** Stamps one side's episode on the night (the booking route, after its insert): a double's column, a mixer's rotation. */
export async function markNightBooked(db: Db, booking: GroupBooking, episodeId: string): Promise<void> {
  if (typeof booking.side === "number") {
    await db.query(`update group_nights set rotations = jsonb_set(rotations, $2::text[], to_jsonb($3::text)) where id = $1`, [
      booking.nightId,
      `{${booking.side},episode_id}`,
      episodeId,
    ]);
    return;
  }
  await db.query(`update group_nights set ${booking.side === "a" ? "episode_a" : "episode_b"} = $2 where id = $1`, [booking.nightId, episodeId]);
}

/**
 * The characters at the other table of this episode's night, once both tables exist: when one table airs, their
 * memories are rebuilt too (lib/air.ts, lib/watch.ts), so everyone at the table remembers everyone (David's call).
 */
export async function siblingCharacters(db: Db, episodeId: string): Promise<string[]> {
  const { rows } = await db.query<{ character_a: string; character_b: string }>(
    `select s.character_a, s.character_b
       from episodes e join episodes s on s.group_id = e.group_id and s.id <> e.id
      where e.id = $1 and e.group_id is not null`,
    [episodeId],
  );
  return [...new Set(rows.flatMap((r) => [r.character_a, r.character_b]))];
}

/** The other table's episode of a night this episode belongs to, for the episode page's cross-link. */
export async function siblingEpisode(db: Db, episodeId: string): Promise<{ episode_id: string; names: string[] } | null> {
  const { rows } = await db.query<{ other: string }>(
    `select (case when episode_a = $1 then episode_b else episode_a end) as other
       from group_nights where (episode_a = $1 or episode_b = $1) and episode_a is not null and episode_b is not null and status = 'booked'`,
    [episodeId],
  );
  const other = rows[0]?.other;
  if (!other) return null;
  const pair = await db.query<{ name: string }>(
    `select c.name from episodes e join characters c on c.id in (e.character_a, e.character_b) where e.id = $1 and e.visibility = 'public'`,
    [other],
  );
  return pair.rows.length ? { episode_id: other, names: pair.rows.map((r) => r.name) } : null;
}
