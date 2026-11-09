/**
 * "Bring a friend" double-date links (docs/audits/2026-11-07-audit-and-benchmark.md item 12: "Make a character and
 * double-date mine". Tinder's Double Date found nearly 15% of invite accepters were new or returning). A couple's
 * owner shares botchelor.com/double/<code>; whoever opens it brings one of their characters, or makes one (the create
 * wizard comes back here), with a house date dealt from the season cast, and one click books both tables of a double
 * date (lib/group-dates.ts) through the usual route (lib/group-dates-run.ts bookDoubleNight). The shared link is the
 * inviting couple's yes, so nobody waits on an answer, and each side spends one date.
 *
 * Rules: one open link per couple, and a link books one night (then it's used; a new one can be made). It lasts
 * LINK_DAYS. Never your own link, never across a block (with either character's owner), never a private character on
 * it, and the character you bring can't be taken by someone else or already at the table. Both bookers must have a
 * date on hand before anything is made, so a link that can't book spends nothing. A link whose couple can no longer
 * book (a block, a break-up) closes, and its owner hears why.
 */
import { track } from "./analytics";
import type { Db } from "./db";
import { DOUBLE_VENUE, dealtHouseDate, INVITE_DAYS, type Couple, type GroupNight } from "./group-dates";
import { bookDoubleNight, datesOnHand, doubleShortfall } from "./group-dates-run";
import { shortName } from "./names";
import { notify } from "./notifications";
import { takenSql } from "./partners";

/** How long a link stays open: as long as a double-date invite. */
export const LINK_DAYS = INVITE_DAYS;
/** Open links one person may have at once (each could spend one of their dates). */
export const OPEN_LINKS_MAX = 5;

const DAY_MS = 24 * 60 * 60_000;
/** A code: unguessable enough not to be walked, short enough to paste. */
const newCode = (): string => crypto.randomUUID().replace(/-/g, "").slice(0, 12);

export const doubleLinkPath = (code: string): string => `/double/${code}`;

type Refusal = { ok: false; status: number; error: string; message: string };
const refuse = (status: number, error: string, message: string): Refusal => ({ ok: false, status, error, message });

const openSince = (now: Date): string => new Date(now.getTime() - LINK_DAYS * DAY_MS).toISOString();

/** A pair of creators where either blocked the other (or the same person: never a block). */
async function blockedBetween(db: Db, a: string, b: string | null): Promise<boolean> {
  if (!b || a === b) return false;
  const { rows } = await db.query(`select 1 from blocks where (blocker_id = $1 and blocked_id = $2) or (blocker_id = $2 and blocked_id = $1) limit 1`, [a, b]);
  return rows.length > 0;
}

type CharRow = { id: string; name: string; owner_id: string | null; is_house: boolean; visibility: string };

/**
 * The couple's link, made the first time it's asked for (one open link per couple). The owner of `characterId` only;
 * its partner is its date on the thread (another creator's character or the house cast). Neither may be private: the
 * link shows both.
 */
export async function ensureDoubleLink(
  db: Db,
  userId: string,
  characterId: string,
  partnerId: string,
  now: Date = new Date(),
): Promise<{ ok: true; code: string; expires_at: string; made: boolean } | Refusal> {
  if (characterId === partnerId) return refuse(400, "same_character", "A couple is two different characters.");
  const { rows } = await db.query<CharRow>(`select id, name, owner_id, is_house, visibility from characters where id = any($1)`, [[characterId, partnerId]]);
  const mine = rows.find((r) => r.id === characterId);
  const partner = rows.find((r) => r.id === partnerId);
  if (!mine || mine.is_house || mine.owner_id !== userId) return refuse(404, "character_not_found", "Share a link for one of your own characters and their date.");
  if (!partner || (partner.visibility === "private" && partner.owner_id !== userId)) return refuse(404, "partner_not_found", "No character with that id to bring as the date.");
  if (mine.visibility === "private" || (!partner.is_house && partner.visibility === "private")) {
    return refuse(409, "private", "A double-date link shows both characters, so neither can be private: make them public first.");
  }
  if (await blockedBetween(db, userId, partner.owner_id)) return refuse(404, "partner_not_found", "No character with that id to bring as the date.");
  const taken = (await db.query<{ taken: boolean }>(`select ${takenSql("c", "$2")} as taken from characters c where c.id = $1`, [mine.id, partner.id])).rows[0]?.taken;
  if (taken) return refuse(409, "taken", `${shortName(mine.name)} is with someone else and only dates them right now.`);

  const live = (
    await db.query<{ code: string; created_at: string }>(
      `select code, created_at from double_links where character_id = $1 and partner_id = $2 and revoked_at is null and night_id is null`,
      [mine.id, partner.id],
    )
  ).rows[0];
  if (live) {
    const expires = new Date(new Date(live.created_at).getTime() + LINK_DAYS * DAY_MS);
    if (expires > now) return { ok: true, code: live.code, expires_at: expires.toISOString(), made: false };
    // Lapsed: closed, so a fresh one can take its place.
    await db.query(`update double_links set revoked_at = $2 where code = $1 and revoked_at is null`, [live.code, now.toISOString()]);
  }
  const open = (
    await db.query<{ n: number }>(`select count(*)::int as n from double_links where created_by = $1 and revoked_at is null and night_id is null and created_at > $2`, [
      userId,
      openSince(now),
    ])
  ).rows[0].n;
  if (open >= OPEN_LINKS_MAX) return refuse(429, "too_many_links", `You have ${OPEN_LINKS_MAX} double-date links open. Turn one off, or wait for one to be taken.`);
  const code = newCode();
  const made = await db.query(
    `insert into double_links (code, created_by, character_id, partner_id, created_at) values ($1, $2, $3, $4, $5) on conflict do nothing returning code`,
    [code, userId, mine.id, partner.id, now.toISOString()],
  );
  if (!made.rows.length) {
    // Two taps at once: the other one made it.
    const again = (
      await db.query<{ code: string; created_at: string }>(
        `select code, created_at from double_links where character_id = $1 and partner_id = $2 and revoked_at is null and night_id is null`,
        [mine.id, partner.id],
      )
    ).rows[0];
    if (!again) return refuse(409, "try_again", "That didn't work; try again in a moment.");
    return { ok: true, code: again.code, expires_at: new Date(new Date(again.created_at).getTime() + LINK_DAYS * DAY_MS).toISOString(), made: false };
  }
  track("double_link_made", { code });
  return { ok: true, code, expires_at: new Date(now.getTime() + LINK_DAYS * DAY_MS).toISOString(), made: true };
}

/** Turn a couple's open link off (a new one can be made after). */
export async function revokeDoubleLink(db: Db, userId: string, characterId: string, partnerId: string, now: Date = new Date()): Promise<boolean> {
  const r = await db.query(
    `update double_links set revoked_at = $4 where created_by = $1 and character_id = $2 and partner_id = $3 and revoked_at is null and night_id is null returning code`,
    [userId, characterId, partnerId, now.toISOString()],
  );
  return r.rows.length > 0;
}

export type DoubleLinkStatus = "open" | "used" | "closed" | "expired";

export type DoubleLink = {
  code: string;
  created_by: string;
  character_id: string;
  partner_id: string;
  /** The inviting couple's names: its first character's, then its date's. */
  names: [string, string];
  created_at: string;
  expires_at: string;
  status: DoubleLinkStatus;
  /** The night it booked, once used (its two episodes when they exist). */
  night_id: string | null;
  episode_a: string | null;
  episode_b: string | null;
};

/** A link and where it stands. Closed: turned off, or its couple can't be shown any more (made private, or its character changed hands). */
export async function loadDoubleLink(db: Db, code: string, now: Date = new Date()): Promise<DoubleLink | null> {
  if (!/^[a-z0-9]{6,32}$/.test(code)) return null;
  const r = (
    await db.query<{
      code: string;
      created_by: string;
      character_id: string;
      partner_id: string;
      a_name: string;
      b_name: string;
      a_owner: string | null;
      a_private: boolean;
      b_private: boolean;
      b_house: boolean;
      created_at: string;
      revoked_at: string | null;
      night_id: string | null;
      episode_a: string | null;
      episode_b: string | null;
    }>(
      `select l.code, l.created_by, l.character_id, l.partner_id, a.name as a_name, b.name as b_name, a.owner_id as a_owner,
              a.visibility = 'private' as a_private, b.visibility = 'private' as b_private, b.is_house as b_house,
              l.created_at, l.revoked_at, l.night_id, g.episode_a, g.episode_b
         from double_links l
         join characters a on a.id = l.character_id
         join characters b on b.id = l.partner_id
         left join group_nights g on g.id = l.night_id
        where l.code = $1`,
      [code],
    )
  ).rows[0];
  if (!r) return null;
  const created = new Date(r.created_at);
  const expires = new Date(created.getTime() + LINK_DAYS * DAY_MS);
  const status: DoubleLinkStatus = r.night_id
    ? "used"
    : r.revoked_at || r.a_owner !== r.created_by || r.a_private || (!r.b_house && r.b_private)
      ? "closed"
      : expires <= now
        ? "expired"
        : "open";
  return {
    code: r.code,
    created_by: r.created_by,
    character_id: r.character_id,
    partner_id: r.partner_id,
    names: [r.a_name, r.b_name],
    created_at: created.toISOString(),
    expires_at: expires.toISOString(),
    status,
    night_id: r.night_id,
    episode_a: r.episode_a,
    episode_b: r.episode_b,
  };
}

/** One of the viewer's characters that could take the link, with the house date the show deals them. */
export type DoubleLinkOption = { character_id: string; name: string; partner_id: string; partner_name: string };

/**
 * The viewer's characters that could bring a date to this link's table: their own, not house, not taken by someone
 * else, not already at it. Each comes with its dealt house date (the same one every time for the same character).
 */
export async function doubleLinkOptions(db: Db, userId: string, link: Pick<DoubleLink, "character_id" | "partner_id">): Promise<DoubleLinkOption[]> {
  const table = [link.character_id, link.partner_id];
  const { rows } = await db.query<{ id: string; name: string }>(
    `select c.id, c.name from characters c
      where c.owner_id = $1 and not c.is_house and c.id <> all($2) and not ${takenSql("c")}
      order by c.created_at desc limit 12`,
    [userId, table],
  );
  const dealt = rows.map((c) => ({ c, partner: dealtHouseDate(c.id, table) })).filter((x): x is { c: { id: string; name: string }; partner: string } => x.partner !== null);
  if (!dealt.length) return [];
  const names = new Map(
    (await db.query<{ id: string; name: string }>(`select id, name from characters where id = any($1)`, [[...new Set(dealt.map((x) => x.partner))]])).rows.map((r) => [r.id, r.name]),
  );
  return dealt.map(({ c, partner }) => ({ character_id: c.id, name: c.name, partner_id: partner, partner_name: names.get(partner) ?? "a house date" }));
}

/** Whether the link's owner has a date on hand for their table, and when theirs come back if not. */
export async function ownerCanBook(db: Db, link: Pick<DoubleLink, "created_by">): Promise<{ ok: boolean; resets_at: string }> {
  const { have, resets_at } = await datesOnHand(db, link.created_by);
  return { ok: have >= 1, resets_at };
}

export type TakeResult =
  | { ok: true; night_id: string; episode_a: string; episode_b: string }
  | (Refusal & { episode_a?: string });

/**
 * Take a link with one of your characters: a double night is made (the link's couple at one table, yours with its
 * dealt house date at the other) and both tables book at once, each booker spending one date. Nothing is made when
 * either side has no date on hand. If only the first table books, its date goes ahead solo (bookDoubleNight) and
 * the link is used; if nothing books, the link is open again, unless its own couple's table was the one refused,
 * which closes it and tells its owner.
 */
export async function takeDoubleLink(db: Db, userId: string, code: string, characterId: string, now: Date = new Date()): Promise<TakeResult> {
  const link = await loadDoubleLink(db, code, now);
  if (!link || link.status !== "open") return refuse(404, "link_not_found", "This double-date link isn't open any more.");
  if (link.created_by === userId) return refuse(409, "own_link", "That's your own couple's link: share it with a friend.");
  const partnerOwner = (await db.query<{ owner_id: string | null }>(`select owner_id from characters where id = $1`, [link.partner_id])).rows[0]?.owner_id ?? null;
  if ((await blockedBetween(db, userId, link.created_by)) || (await blockedBetween(db, userId, partnerOwner))) {
    return refuse(404, "link_not_found", "This double-date link isn't open any more.");
  }
  const mine = (
    await db.query<{ id: string; name: string; is_house: boolean; taken: boolean }>(
      `select c.id, c.name, c.is_house, ${takenSql("c")} as taken from characters c where c.id = $1 and c.owner_id = $2`,
      [characterId, userId],
    )
  ).rows[0];
  if (!mine || mine.is_house) return refuse(404, "character_not_found", "Take the link with one of your own characters.");
  if (mine.id === link.character_id || mine.id === link.partner_id) return refuse(409, "already_at_table", `${shortName(mine.name)} is already at this table.`);
  if (mine.taken) return refuse(409, "taken", `${shortName(mine.name)} is with someone and only dates them right now.`);
  const houseDate = dealtHouseDate(mine.id, [link.character_id, link.partner_id]);
  if (!houseDate) return refuse(503, "no_house_date", "There's no house date free for the double right now. Try again in a moment.");

  const coupleA: Couple = { character_id: link.character_id, partner_id: link.partner_id };
  const coupleB: Couple = { character_id: mine.id, partner_id: houseDate };
  const draft: GroupNight = {
    id: "draft",
    kind: "double",
    venue: DOUBLE_VENUE,
    created_by: link.created_by,
    status: "booked",
    invite_to: userId,
    couple_a: coupleA,
    couple_b: coupleB,
    episode_a: null,
    episode_b: null,
    rotations: null,
    created_at: now.toISOString(),
  };
  // Dates first: nothing is made, and nothing spent, while either side has none.
  const short = await doubleShortfall(db, draft);
  if (short) {
    const back = new Date(short.resets_at).toUTCString().replace(":00 GMT", " UTC");
    return short.booker === userId
      ? refuse(402, "no_dates", `Taking it spends one of your dates, and you have none left. They come back ${back}, or a pack from the shop (/shop) adds dates.`)
      : refuse(409, "owner_out_of_dates", `${shortName(link.names[0])}'s creator is out of dates for now, so it can't book. Try again after ${back}.`);
  }
  // Claimed before anything books, so two people taking it at once can't both book it.
  const claimed = await db.query(
    `update double_links set taken_by = $2, taken_at = $3
      where code = $1 and taken_by is null and night_id is null and revoked_at is null and created_at > $4 returning code`,
    [code, userId, now.toISOString(), openSince(now)],
  );
  if (!claimed.rows.length) return refuse(409, "being_taken", "Someone's taking this link right now. Try again in a moment.");

  const inserted = (
    await db.query(
      `insert into group_nights (id, kind, venue, created_by, status, invite_to, couple_a, couple_b, decided_at)
       values ($1, 'double', $2, $3, 'booked', $4, $5::jsonb, $6::jsonb, $7) returning *`,
      [crypto.randomUUID(), DOUBLE_VENUE, link.created_by, userId, JSON.stringify(coupleA), JSON.stringify(coupleB), now.toISOString()],
    )
  ).rows[0] as Record<string, unknown>;
  const night: GroupNight = { ...draft, id: String(inserted.id), created_at: new Date(inserted.created_at as string).toISOString() };
  const names = new Map(
    (await db.query<{ id: string; name: string }>(`select id, name from characters where id = any($1)`, [[mine.id, houseDate]])).rows.map((r) => [r.id, shortName(r.name)]),
  );
  const [a, b] = link.names.map(shortName);
  const booked = await bookDoubleNight(db, night, undefined, userId, {
    // The link's owner hears who took it, in place of the usual "booked" notice.
    notice: (to) =>
      to === link.created_by
        ? {
            title: `💌 ${names.get(mine.id) ?? "Someone"} took your double-date link`,
            body: `${names.get(mine.id) ?? "Their character"} and ${names.get(houseDate) ?? "a house date"} join ${a} and ${b}: both tables are booked and being written now, and each couple's date airs the usual way.`,
          }
        : null,
  });

  if (booked.ok) {
    await db.query(`update double_links set night_id = $2 where code = $1`, [code, night.id]);
    const firstChar = (await db.query<{ first: string }>(`select min(created_at) as first from characters where owner_id = $1`, [userId])).rows[0]?.first;
    track("double_link_taken", { code, night: night.id, new_creator: firstChar ? new Date(firstChar) >= new Date(link.created_at) : undefined });
    return { ok: true, night_id: night.id, episode_a: booked.episode_a, episode_b: booked.episode_b };
  }
  if (booked.episode_a) {
    // Only the first table booked: its date goes ahead on its own (a spent date is a real date), so the link is used.
    await db.query(`update double_links set night_id = $2 where code = $1`, [code, night.id]);
    return { ...refuse(502, "half_booked", booked.error), episode_a: booked.episode_a };
  }
  // Nothing booked. A dates race leaves the night 'invited' (lib/group-dates-run.ts); a link has no invite to keep.
  const after = (await db.query<{ status: string }>(`select status from group_nights where id = $1`, [night.id])).rows[0]?.status;
  if (after === "invited") await db.query(`update group_nights set status = 'lapsed', decided_at = $2 where id = $1`, [night.id, now.toISOString()]);
  if (after === "lapsed" && (await ownerCanBook(db, link)).ok) {
    // The link's own couple couldn't book, with dates on hand (a block, a break-up): closed, and its owner told. When
    // their dates ran out in the meantime instead, bookDoubleNight told them, and the link stays open for later.
    await db.query(`update double_links set revoked_at = $2, taken_by = null, taken_at = null where code = $1`, [code, now.toISOString()]);
    await notify(db, link.created_by, {
      kind: "double_date",
      title: "💞 Your double-date link closed",
      body: `Someone took it, but ${a} and ${b}'s table couldn't be booked, so nothing was booked and nothing was spent. Make a new link from their thread when they can date again.`,
      link: null,
    }).catch(() => {});
  } else {
    await db.query(`update double_links set taken_by = null, taken_at = null where code = $1`, [code]);
  }
  return refuse(422, "double_failed", booked.error);
}
