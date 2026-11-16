/**
 * Creator invites for casting (2026-11-16, "December: first real audience", part C; docs/casting-invites.md). The owner
 * invites original-character creators by hand, and one applicant two weeks out was the problem: friction the cause. A
 * code opens /casting/invite/<code>, and applying a character with it:
 *
 *  - skips the three public dates an audition needs (lib/audition-words.ts AUDITION_MIN_DATES), and only that: every
 *    other rule of lib/auditions.ts auditionBlocks still holds (the owner's own character made on the site, an account,
 *    public, open to dates, PG, a portrait, one audition a person a season, not one turned down this season);
 *  - is pre-approved: the audition goes in 'approved' in the same statement that marks the code used (one code, one
 *    character). The admin can still turn it down on /admin/season, as any audition;
 *  - books an audition date with the casting lead at once (lib/casting.ts castingLead: next month's lead in the
 *    preseason, this month's in season), paid by the show, through the booking route the way a rose's date is booked
 *    (markLeadRequest). It is the character's casting date (met_via 'casting'), so Sunday's roses judge it like any
 *    walk-on's. Nothing is booked when the character already has a casting date with that lead, filming or done (the
 *    builder's instant first date, say). A date that can't be booked (the show paused, no lead picked) leaves the
 *    audition standing; the owner can try the date again from the invite page.
 *
 * Applied during the season, the audition is for the next season (auditionSeasonId) and the date with the lead is still
 * booked: a walk-on. CASTING_INVITES=0 closes the page and refuses every application, without a deploy.
 *
 * Sacred rule: an invite never touches points, odds, pairings or endings. The date's ending is the engine's, as always.
 */
import { randomBytes } from "node:crypto";
import { track } from "./analytics";
import { AUDITION_BLOCKS, auditionBlocks, auditionSeasonId, type AuditionBlock } from "./auditions";
import { markShowPaidRequest } from "./cast-date-request";
import { invitePath, isInviteCode } from "./casting-invite-shared";
import { CASTING_MET_VIA, castingLead, markLeadRequest, optedIn, type Casting } from "./casting";
import { generationPaused } from "./compute";
import type { Db } from "./db";
import { firstDateFormat } from "./first-date";
import { MCP_CALL_URL, USER_COOKIE, type Auth } from "./http";
import { shortName } from "./names";
import { notify } from "./notifications";
import { previousSeasonStart, seasonLabel } from "./season-window";
import { siteUrl } from "./site";

type Env = Record<string, string | undefined>;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The switch: on unless CASTING_INVITES=0. Off, the invite page says invites are closed and applying refuses. */
export function castingInvitesOn(env: Env = process.env): boolean {
  return env.CASTING_INVITES?.trim() !== "0";
}

/** How long a new code lasts unless the admin says otherwise, the most it may, and how many one request makes. */
export const INVITE_DAYS = 30;
export const MAX_INVITE_DAYS = 90;
export const MAX_INVITES_AT_ONCE = 20;

export const CLOSED_MESSAGE = "Creator invites are closed right now.";

/** 10 url-safe characters from 60 random bits (lib/casting-invite-shared.ts isInviteCode). */
export const newInviteCode = (): string => randomBytes(8).toString("base64url").slice(0, 10);

/** The address an invite is sent as: https://botchelor.com/casting/invite/<code> on the live site. */
export const inviteUrl = (code: string, env: Env = process.env): string => `${siteUrl(env)}${invitePath(code)}`;

const iso = (v: Date | string): string => new Date(v).toISOString();

export type InviteRow = {
  code: string;
  season_id: string;
  note: string | null;
  created_at: Date | string;
  expires_at: Date | string;
  used_at: Date | string | null;
  used_by: string | null;
  character_id: string | null;
};

export type InviteStatus = "open" | "used" | "expired";

export const inviteStatus = (r: Pick<InviteRow, "used_at" | "expires_at">, now: Date = new Date()): InviteStatus =>
  r.used_at ? "used" : new Date(r.expires_at).getTime() <= now.getTime() ? "expired" : "open";

export type MadeInvite = { code: string; url: string; expires_at: string };

/**
 * Makes `count` codes (1 to MAX_INVITES_AT_ONCE), each good for `days` (INVITE_DAYS unless said), for the season
 * auditions are open for now. `note` is the admin's own: who the code is for.
 */
export async function makeInvites(db: Db, opts: { count: number; note?: string | null; days?: number | null }, now: Date = new Date(), env: Env = process.env): Promise<MadeInvite[]> {
  const count = Math.max(1, Math.min(MAX_INVITES_AT_ONCE, Math.floor(opts.count)));
  const days = Math.max(1, Math.min(MAX_INVITE_DAYS, Math.floor(opts.days ?? INVITE_DAYS)));
  const season = auditionSeasonId(now);
  const expires = new Date(now.getTime() + days * DAY_MS).toISOString();
  const note = opts.note?.trim().slice(0, 200) || null;
  const made: MadeInvite[] = [];
  // A collision of 60 random bits never happens in practice; a bounded redraw keeps it from ever looping.
  for (let tries = 0; made.length < count && tries < count * 3; tries++) {
    const code = newInviteCode();
    const { rows } = await db.query<{ code: string }>(
      `insert into casting_invites (code, season_id, note, created_at, expires_at) values ($1, $2, $3, $4, $5) on conflict (code) do nothing returning code`,
      [code, season, note, now.toISOString(), expires],
    );
    if (rows.length) made.push({ code, url: inviteUrl(code, env), expires_at: expires });
  }
  return made;
}

export type AdminInvite = {
  code: string;
  url: string;
  note: string | null;
  season_id: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  status: InviteStatus;
  /** Who used it: the character it applied (null while unused, or when that character was deleted since). */
  character: { id: string; name: string } | null;
};

/** The admin's list (/admin/season): every invite, newest first, with whether it's open, used (by which character) or expired. */
export async function listInvites(db: Db, now: Date = new Date(), env: Env = process.env): Promise<AdminInvite[]> {
  const { rows } = await db.query<InviteRow & { name: string | null }>(
    `select i.code, i.season_id, i.note, i.created_at, i.expires_at, i.used_at, i.used_by, i.character_id, c.name
       from casting_invites i left join characters c on c.id = i.character_id
      order by i.created_at desc, i.code
      limit 200`,
  );
  return rows.map((r) => ({
    code: r.code,
    url: inviteUrl(r.code, env),
    note: r.note,
    season_id: r.season_id,
    created_at: iso(r.created_at),
    expires_at: iso(r.expires_at),
    used_at: r.used_at ? iso(r.used_at) : null,
    status: inviteStatus(r, now),
    character: r.character_id ? { id: r.character_id, name: r.name ?? "" } : null,
  }));
}

/** One invite by its code; null for none (a string that isn't a code is never looked up). */
export async function loadInvite(db: Db, code: string): Promise<InviteRow | null> {
  if (!isInviteCode(code)) return null;
  const { rows } = await db.query<InviteRow>(
    `select code, season_id, note, created_at, expires_at, used_at, used_by, character_id from casting_invites where code = $1`,
    [code],
  );
  return rows[0] ?? null;
}

/**
 * What the invite page shows for a code: closed (the switch), not found, expired, used by someone else, open, or
 * "yours" (this person used it: how their application stands, and the date's retry).
 */
export type InviteView =
  | { state: "closed" | "invalid" | "expired" | "used" }
  | { state: "open"; expires_at: string }
  | { state: "yours"; character_id: string | null; used_at: string };

export function inviteView(row: InviteRow | null, viewerId: string | null, now: Date = new Date(), env: Env = process.env): InviteView {
  if (!castingInvitesOn(env)) return { state: "closed" };
  if (!row) return { state: "invalid" };
  if (row.used_at) return viewerId && row.used_by === viewerId ? { state: "yours", character_id: row.character_id, used_at: iso(row.used_at) } : { state: "used" };
  if (inviteStatus(row, now) === "expired") return { state: "expired" };
  return { state: "open", expires_at: iso(row.expires_at) };
}

/** What stands between a character and applying with an invite: an audition's blocks, without the three-date wait. */
export async function inviteBlocks(db: Db, auth: Auth, characterId: string, now: Date = new Date()): Promise<AuditionBlock[]> {
  return (await auditionBlocks(db, auth, characterId, now)).filter((b) => b !== "dates");
}

/**
 * The character's casting date with this casting's lead, filming or done: one in this casting (from the month before the
 * lead's season, its preseason, on). An invite books none when there is one already.
 */
export async function castingDateWith(db: Db, characterId: string, casting: Pick<Casting, "season_id" | "lead">): Promise<{ id: string; status: string } | null> {
  const since = previousSeasonStart(new Date(`${casting.season_id}T00:00:00.000Z`));
  const { rows } = await db.query<{ id: string; status: string }>(
    `select e.id, e.status from episodes e
      where ((e.character_a = $1 and e.character_b = $2) or (e.character_a = $2 and e.character_b = $1))
        and e.setup->>'met_via' = $3 and e.varies_episode_id is null and e.created_at >= $4
      order by e.created_at desc
      limit 1`,
    [characterId, casting.lead.id, CASTING_MET_VIA, since.toISOString()],
  );
  return rows[0] ?? null;
}

export type InviteDate =
  | { booked: true; episode_id: string; fresh: boolean }
  | { booked: false; reason: "no_lead" | "on_cast" | "paused" | "refused"; message: string };

type Booking = { lead: { id: string; name: string } | null; date: InviteDate };

/**
 * The audition date with the casting lead, booked through the ordinary booking route as the owner on a show-paid request
 * (none of the owner's dates are spent), in the first-date format, public (an audition is a public character's), marked
 * so the lead can be booked by name and the date counts as the casting date. Skipped, saying why, when there's no lead to
 * meet, it has its casting date already, it's on the lead's season's cast, or the show is paused.
 */
async function bookAuditionDate(db: Db, ownerId: string, characterId: string, now: Date, env: Env): Promise<Booking> {
  const casting = await castingLead(db, now, env).catch(() => null);
  if (!casting) {
    return { lead: null, date: { booked: false, reason: "no_lead", message: "No lead is taking audition dates right now, so there's no date to book yet." } };
  }
  const lead = { id: casting.lead.id, name: casting.lead.name };
  const first = shortName(lead.name);
  const already = await castingDateWith(db, characterId, casting);
  if (already) return { lead, date: { booked: true, episode_id: already.id, fresh: false } };
  const onCast = await db.query(`select 1 from season_casts where season_id = $1 and character_id = $2 and withdrawn_at is null`, [casting.season_id, characterId]);
  if (onCast.rows.length) return { lead, date: { booked: false, reason: "on_cast", message: `It's on the cast already: its dates with ${first} are the show's.` } };
  if (generationPaused(env)) {
    return { lead, date: { booked: false, reason: "paused", message: `The show is paused right now, so the date with ${first} isn't booked yet.` } };
  }
  // Imported here: the booking route is an app module, loaded only when a date is booked.
  const { POST: postEpisode } = await import("@/app/api/episodes/route");
  const req = markLeadRequest(
    markShowPaidRequest(
      new Request(MCP_CALL_URL, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `${USER_COOKIE}=${ownerId}` },
        body: JSON.stringify({ character_id: characterId, partner_id: lead.id, format: firstDateFormat(env), visibility: "public" }),
      }),
    ),
    { audition: true },
  );
  const res = await postEpisode(req).catch(() => null);
  const out = (res ? await res.json().catch(() => ({})) : {}) as { id?: string; message?: string };
  if (res?.ok && out.id) return { lead, date: { booked: true, episode_id: out.id, fresh: true } };
  return { lead, date: { booked: false, reason: "refused", message: out.message ?? `The date with ${first} couldn't be booked just now.` } };
}

/** The character's own words when it hears (lib/companion.ts postFromCharacter): written here, no model. */
export const inviteLines = (lead: string | null, onNow: boolean): string[] => [
  "I'm on the shortlist. No waiting in line.",
  ...(lead ? [onNow ? `My audition date with ${lead} is on right now. Come watch.` : `My date with ${lead} counts as my audition.`] : []),
];

/** The owner hears it's in, and how the date stands; the character texts them too when they opted in to its texts. */
async function tellOwner(db: Db, ownerId: string, characterId: string, season: string, code: string, booking: Booking, now: Date): Promise<void> {
  const name = (await db.query<{ name: string }>(`select name from characters where id = $1`, [characterId])).rows[0]?.name ?? "Your character";
  const first = shortName(name);
  const label = seasonLabel(season);
  const lead = booking.lead ? shortName(booking.lead.name) : null;
  const { date } = booking;
  const how = date.booked
    ? date.fresh
      ? `Its audition date with ${lead} is on now, paid by the show, and Sunday's roses judge it.`
      : `Its date with ${lead} counts as its audition, and Sunday's roses judge it.`
    : `${date.message} The application stands.`;
  await notify(db, ownerId, {
    kind: "audition",
    title: `🌹 ${first} is shortlisted for ${label}`,
    body: `Invited, so no three-date wait. ${how} The audience's votes decide the places when ${label} starts.`,
    link: date.booked ? `/episodes/${date.episode_id}?play=1` : invitePath(code),
  });
  if (await optedIn(db, ownerId, characterId).catch(() => false)) {
    const { postFromCharacter } = await import("./companion");
    await postFromCharacter(db, {
      userId: ownerId,
      characterId,
      lines: inviteLines(lead, date.booked && date.fresh),
      now,
      kind: "casting_invite",
      dedupeKey: `casting_invite:${code}`,
    }).catch(() => null);
  }
}

export type InviteCredit = { handle: string; display_name: string };

export type ApplyResult =
  | {
      ok: true;
      season_id: string;
      character_id: string;
      /** The same person and character again: only the date was tried again. */
      again: boolean;
      lead: { id: string; name: string } | null;
      date: InviteDate;
    }
  | { ok: false; status: number; error: string; message: string; blocks?: AuditionBlock[]; field?: string };

const refuse = (status: number, error: string, message: string, extra: { blocks?: AuditionBlock[]; field?: string } = {}): ApplyResult => ({ ok: false, status, error, message, ...extra });

/**
 * Applies a character with an invite (POST /api/casting/invite/[code]); the page puts the terms on the button, so the
 * caller has the owner's consent. `credit`: the creator name the casting board and the character's page credit them by
 * (lib/showcase.ts creator_profiles), saved first when given. The same person with the same character again (the page's
 * retry) only tries the date again.
 */
export async function applyWithInvite(
  db: Db,
  auth: Auth,
  code: string,
  characterId: string,
  opts: { credit?: InviteCredit | null; now?: Date; env?: Env } = {},
): Promise<ApplyResult> {
  const now = opts.now ?? new Date();
  const env = opts.env ?? process.env;
  if (!castingInvitesOn(env)) return refuse(403, "invites_closed", CLOSED_MESSAGE);
  const invite = await loadInvite(db, code);
  if (!invite) return refuse(404, "invite_not_found", "We can't find that invite. Check the link, or ask whoever sent it.");
  if (invite.used_at) {
    if (invite.used_by !== auth.userId || invite.character_id !== characterId) return refuse(409, "invite_used", "This invite has already been used.");
    // The retry: only while the application it made still stands (not withdrawn, not turned down) and is still theirs.
    const season = auditionSeasonId(new Date(invite.used_at));
    const standing = await db.query(
      `select 1 from cast_auditions a join characters c on c.id = a.character_id
        where a.season_id = $1 and a.character_id = $2 and a.owner_id = $3 and c.owner_id = $3 and a.status in ('open', 'approved')`,
      [season, characterId, auth.userId],
    );
    if (!standing.rows.length) return refuse(409, "not_auditioning", "Its application isn't in any more, so there's no audition date to book.");
    const retry = await bookAuditionDate(db, auth.userId, characterId, now, env);
    if (retry.date.booked && retry.date.fresh) track("casting_invite_used", { code, character_id: characterId, step: "date_retry", booked: true });
    return { ok: true, season_id: season, character_id: characterId, again: true, ...retry };
  }
  if (inviteStatus(invite, now) === "expired") return refuse(410, "invite_expired", "This invite has expired. Ask whoever sent it for a new one.");

  const blocks = await inviteBlocks(db, auth, characterId, now);
  if (blocks.length) {
    const status = blocks.includes("not_yours") ? 404 : blocks.includes("sign_in") ? 401 : 409;
    return refuse(status, blocks[0] === "not_yours" ? "character_not_found" : "cannot_audition", AUDITION_BLOCKS[blocks[0]], { blocks });
  }
  if (opts.credit) {
    // lib/showcase.ts holds the creator-name rules (public words, the show's lines, one handle each); loaded only here.
    const { saveCreatorProfile } = await import("./showcase");
    // Their creator page's bio, when they have one, stays as it is: the invite asks only for the name.
    const had = (await db.query<{ bio: string | null }>(`select bio from creator_profiles where user_id = $1`, [auth.userId])).rows[0];
    const saved = await saveCreatorProfile(db, auth.userId, { ...opts.credit, bio: had?.bio ?? null });
    if (!saved.ok) return refuse(saved.status, saved.error, saved.message, { field: "credit" });
  }

  // One statement, so one transaction: the code is claimed (still unused, still in date) and the audition goes in
  // approved, or neither happens. Another audition of theirs this season (cast_auditions_one_each) undoes both.
  const season = auditionSeasonId(now);
  const claimed = await db
    .query<{ code: string }>(
      `with claimed as (
         update casting_invites set used_at = $5, used_by = $3, character_id = $4
          where code = $1 and used_at is null and expires_at > $5
          returning code
       ), approved as (
         insert into cast_auditions (season_id, character_id, owner_id, status, created_at, decided_at)
         select $2, $4, $3, 'approved', $5, $5 from claimed
         on conflict (season_id, character_id) do update
           set status = 'approved', owner_id = excluded.owner_id, decided_at = excluded.decided_at,
               created_at = case when cast_auditions.status = 'withdrawn' then excluded.created_at else cast_auditions.created_at end
         returning character_id
       )
       select code from claimed where exists (select 1 from approved)`,
      [code, season, auth.userId, characterId, now.toISOString()],
    )
    .catch((err: unknown) => {
      if ((err as { code?: string })?.code === "23505") return null;
      throw err;
    });
  if (!claimed) return refuse(409, "cannot_audition", AUDITION_BLOCKS.one_each, { blocks: ["one_each"] });
  if (!claimed.rows.length) return refuse(409, "invite_used", "This invite has just been used.");

  const booking = await bookAuditionDate(db, auth.userId, characterId, now, env);
  await tellOwner(db, auth.userId, characterId, season, code, booking, now).catch(() => {});
  // The same event /casting's own audition sends, said to come from an invite; and the invite's own, for the admin's count.
  track("audition", { source: "invite" });
  track("casting_invite_used", {
    code,
    character_id: characterId,
    season_id: season,
    step: "applied",
    booked: booking.date.booked,
    fresh: booking.date.booked ? booking.date.fresh : undefined,
    reason: booking.date.booked ? undefined : booking.date.reason,
  });
  return { ok: true, season_id: season, character_id: characterId, again: false, ...booking };
}

/** The creator name this person is credited by, if they have one that isn't hidden (lib/showcase.ts creator_profiles). */
export async function creditOf(db: Db, userId: string): Promise<{ handle: string; display_name: string; hidden: boolean } | null> {
  const { rows } = await db.query<{ handle: string; display_name: string; hidden: boolean }>(`select handle, display_name, hidden from creator_profiles where user_id = $1`, [userId]);
  return rows[0] ?? null;
}
