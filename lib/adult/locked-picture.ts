/**
 * The locked picture in the show's texts (lib/locked-picture.ts), as After Dark's own rules see a person: who may be
 * told at all, and what the tile is for the viewer in front of it. Nothing here is new access: every answer comes from
 * the rules After Dark already has (lib/adult/entitlement.ts canAfterDark, lib/adult/place.ts accessHere and
 * mediaAllowedFor, lib/jurisdiction.ts, the device lock of lib/adult/privacy.ts, the bridge's switch and destination of
 * lib/adult/bridge.ts), and `public_door` is never read or changed.
 *
 * Nothing of After Dark's content is read: no scene, line, picture, tag or night. The show's thread gets a link and a
 * word for its button, and that is all that crosses.
 *
 * WHO MAY BE TOLD (doorKind, pure; every one must hold):
 *  - the switch is on, After Dark is on at all, and the viewer isn't a crawler or an agent;
 *  - a signed-in account (never a guest) that has said it is 18 or older;
 *  - somewhere After Dark's PICTURES are allowed (lib/jurisdiction.ts mediaAllowed): never a blocked place, where
 *    nothing may say it exists, and never a text-only one, where there is no picture to open;
 *  - After Dark open to them, with pictures (a free taste is the scenes only): the tile opens the couple's night, unless
 *    this device is locked by their PIN, which is shown nothing of After Dark;
 *  - or not open to them: the tile leads to the way in, unless the bridge is off (AD_BRIDGE=0) or the owner declined
 *    their invite request.
 *
 * A text is written by a job, with no request to read a place or a cookie from. So the show remembers, on the account
 * row, what After Dark's rules said the last time that person opened one of their threads having said they're 18+
 * (rememberSeen: the mode alone, never a country, a state or an address), and a text goes only to someone seen in an
 * open place within LOCKED_PICTURE_RULES.seenWithinDays. The tile is then decided again on every view.
 */
import { afterDarkHref } from "../after-dark-host";
import { detectBot } from "../bots";
import type { Db } from "../db";
import type { AfterDarkMode } from "../jurisdiction";
import { mediaAllowed } from "../jurisdiction";
import { LOCKED_PICTURE_RULES, LOCKED_PICTURE_SOURCE, lockedPictureTextsOn, type LockedDoor } from "../locked-picture";
import { pairKey } from "../relationships";
import { shared } from "../shared-cache";
import { billingOn } from "./billing";
import { adBridgeOn, invitePath } from "./bridge";
import { notDrawnSql } from "../art-style";
import { afterDarkHouseIds, eligibleIds } from "./characters";
import { canAfterDark, openEverywhere, type Entitlement } from "./entitlement";
import { getInvite, type InviteStatus } from "./invites";
import { adultAvailable } from "./mode";
import { viewerContinue } from "./overnight";
import { accessHere, mediaAllowedFor } from "./place";
import { isLocked, UNLOCK_COOKIE } from "./privacy";

type Env = Record<string, string | undefined>;

/** After Dark open to them with pictures, open to them without (a free taste: the scenes only), or not open. */
export type Entitled = "full" | "taste" | "no";
export const entitledAs = (e: Entitlement): Entitled => (!e.ok ? "no" : e.why === "taste" ? "taste" : "full");

export type DoorFacts = {
  /** LOCKED_PICTURE_TEXTS isn't 0. */
  on: boolean;
  /** AD_BRIDGE isn't 0: the show may point someone who isn't in at the way in. */
  bridgeOn: boolean;
  /** After Dark is switched on at all (lib/adult/mode.ts adultAvailable). */
  available: boolean;
  /** A signed-in account, not a guest. */
  signedIn: boolean;
  /** They have said they're 18 or older (the gate's cookie on this browser; for a text, when they were last seen). */
  attested: boolean;
  /** What After Dark may be where they are (for a text: where they were last seen). */
  mode: AfterDarkMode;
  entitled: Entitled;
  /** This device hasn't entered the account's PIN (lib/adult/privacy.ts): it's shown nothing of After Dark. */
  locked: boolean;
  /** Their invite request, if they ever made one. */
  invite: InviteStatus | null;
  /** A crawler or an agent. */
  bot: boolean;
};

/** What the tile is for this person: the couple's night, the way in, or nothing at all. Pure, so the matrix is tested without a page. */
export function doorKind(f: DoorFacts): LockedDoor["state"] | null {
  if (!f.on || !f.available || !f.signedIn || !f.attested || f.bot) return null;
  if (!mediaAllowed({ mode: f.mode })) return null;
  if (f.entitled === "full") return f.locked ? null : "open";
  if (!f.bridgeOn || f.invite === "declined") return null;
  return "way_in";
}

/** Where the way in is: the bridge's own destination, so the day a subscription can be bought the tile leads to it unchanged. */
export const wayInHref = (env: Env = process.env): string => afterDarkHref(invitePath(LOCKED_PICTURE_SOURCE), env);

/* ------------------------------------------------ the tile, for a viewer ------------------------------------------------ */

/** How often an unchanged answer is written again. */
const REWRITE_AFTER_MS = 10 * 60 * 1000;
const written = new Map<string, { mode: AfterDarkMode; at: number }>();

/**
 * Remembers what After Dark's rules said for this account just now (see the header): the mode only. Called only for a
 * signed-in person who has said they're 18+. Best effort: a failed write just means no text until the next visit.
 */
export async function rememberSeen(db: Db, userId: string, mode: AfterDarkMode, now = Date.now()): Promise<void> {
  const last = written.get(userId);
  if (last && last.mode === mode && now - last.at < REWRITE_AFTER_MS) return;
  written.set(userId, { mode, at: now });
  await db
    .query(`update accounts set after_dark_seen_mode = $2, after_dark_seen_at = $3::timestamptz where user_id = $1`, [userId, mode, new Date(now).toISOString()])
    .catch(() => {
      written.delete(userId);
    });
}

/** Tests: forget what was remembered in memory (the column is reset with the database). */
export function forgetSeenForTests(): void {
  written.clear();
}

export type LockedDate = { episodeId: string };

/**
 * The tile for this viewer, per date, on this request: an empty record when no tile may show (the texts then read as
 * plain lines). `remember`: also note, for the job that writes the texts, what the rules said (the thread page asks for
 * that; nothing is remembered for a guest, without the 18+ answer, or with the switch off). `asVisitor`: an admin
 * looking at the tile as someone After Dark isn't open to (the thread page's ?preview=visitor). Never throws.
 */
export async function lockedDoors(
  db: Db,
  auth: { userId: string; authenticated: boolean } | null,
  headers: Headers,
  cookies: { get(name: string): { value: string } | undefined },
  attested: boolean,
  dates: readonly LockedDate[],
  opts: { env?: Env; remember?: boolean; asVisitor?: boolean } = {},
): Promise<Record<string, LockedDoor>> {
  const env = opts.env ?? process.env;
  const on = lockedPictureTextsOn(env);
  const bot = Boolean(detectBot(headers.get("user-agent"), headers.get("signature-agent")));
  const signedIn = Boolean(auth?.authenticated);
  if (!on || !signedIn || !attested || bot) return {};
  try {
    const userId = auth!.userId;
    const [available, here] = await Promise.all([shared("after-dark:available", async () => adultAvailable(db, env)), accessHere(db, auth, headers)]);
    if (opts.remember) await rememberSeen(db, userId, here.mode);
    if (!available || !dates.length) return {};
    const preview = Boolean(opts.asVisitor) && here.admin;
    const entitled: Entitled = preview ? "no" : entitledAs(here.entitled);
    const [locked, invite] = await Promise.all([
      entitled === "full" ? isLocked(db, userId, cookies.get(UNLOCK_COOKIE)?.value ?? null) : false,
      entitled === "full" || preview ? null : getInvite(db, userId),
    ]);
    const kind = doorKind({ on, bridgeOn: adBridgeOn(env), available, signedIn, attested, mode: here.mode, entitled, locked, invite: invite?.status ?? null, bot });
    if (!kind) return {};
    const ids = [...new Set(dates.map((d) => d.episodeId))];
    if (kind === "way_in") {
      const door: LockedDoor = { state: "way_in", href: wayInHref(env), invite_only: !billingOn(env), asked: invite !== null };
      return Object.fromEntries(ids.map((id) => [id, door]));
    }
    const [pairs, mine] = await Promise.all([
      db.query<{ id: string; character_a: string; character_b: string }>(`select id, character_a, character_b from episodes where id = any($1)`, [ids]),
      eligibleIds(db, userId),
    ]);
    const out: Record<string, LockedDoor> = {};
    for (const p of pairs.rows) {
      // The overnight continuation's own entry when it is theirs to continue (lib/adult/overnight.ts: every one of its
      // rules), else the pair's night when both are in this viewer's After Dark, else After Dark's front page.
      const night = await viewerContinue(db, auth, headers, cookies, attested, p.id, env);
      const [lo, hi] = pairKey(p.character_a, p.character_b);
      out[p.id] = { state: "open", href: night?.href ?? afterDarkHref(mine.has(lo) && mine.has(hi) ? `/after-dark/${lo}/${hi}` : "/after-dark", env) };
    }
    return out;
  } catch {
    return {};
  }
}

/* ------------------------------------------------ who a text may go to ------------------------------------------------ */

/**
 * Of these people, who may be sent the text about this pair now, and which tile they would see: decided without a
 * request, from what was remembered (rememberSeen) and After Dark's own rules as they stand. Left out:
 *  - anyone without an account, or never seen 18+ in an open place within LOCKED_PICTURE_RULES.seenWithinDays (an
 *    admin or a processor's reviewer is open wherever they are, as everywhere else);
 *  - anyone for whom the pair's night could never open: each of the two must be in After Dark for everyone (this
 *    season's cast, the open agent cast) or be that person's own, and not drawn (anime or 2.5D, lib/art-style.ts). Another person's character is
 *    never in someone's After Dark (lib/adult/characters.ts), so a text about a night with one would promise nothing;
 *  - in After Dark already, but without pictures (a taste; last seen by After Dark where pictures aren't allowed:
 *    mediaAllowedFor), or with one of the two not in THEIR After Dark (their own character isn't switched in: that
 *    yes is theirs to give, and this never asks for it);
 *  - not in After Dark, while the bridge is off (AD_BRIDGE=0) or after the owner declined their invite request.
 */
export async function whoMayBeSent(db: Db, userIds: readonly string[], pair: readonly [string, string], now: Date = new Date(), env: Env = process.env): Promise<Map<string, LockedDoor["state"]>> {
  const out = new Map<string, LockedDoor["state"]>();
  const ids = [...new Set(userIds)];
  if (!ids.length || !lockedPictureTextsOn(env)) return out;
  if (!(await adultAvailable(db, env).catch(() => false))) return out;
  const since = new Date(now.getTime() - LOCKED_PICTURE_RULES.seenWithinDays * 86_400_000).toISOString();
  const [people, two] = await Promise.all([
    db.query<{ user_id: string; seen_open: boolean }>(
      `select user_id, coalesce(after_dark_seen_mode = 'open' and after_dark_seen_at >= $2::timestamptz, false) as seen_open from accounts where user_id = any($1)`,
      [ids, since],
    ),
    db.query<{ id: string; owner_id: string | null; open_to_all: boolean; drawn: boolean }>(
      `select c.id, c.owner_id, (c.after_dark_open and c.visibility <> 'private') as open_to_all, not ${notDrawnSql("c")} as drawn from characters c where c.id = any($1)`,
      [[...pair]],
    ),
  ]);
  if (two.rows.length !== 2) return out;
  const cast = new Set(afterDarkHouseIds());
  const couldOpenFor = (userId: string) => two.rows.every((c) => cast.has(c.id) || (!c.drawn && (c.open_to_all || c.owner_id === userId)));
  for (const r of people.rows) {
    if (!couldOpenFor(r.user_id)) continue;
    const entitlement = await canAfterDark(db, { userId: r.user_id, authenticated: true }, now);
    const entitled = entitledAs(entitlement);
    if (!r.seen_open && !openEverywhere(entitlement)) continue;
    if (entitled === "taste") continue;
    if (entitled === "full") {
      if (!(await mediaAllowedFor(db, r.user_id))) continue;
      const mine = await eligibleIds(db, r.user_id);
      if (pair.every((id) => mine.has(id))) out.set(r.user_id, "open");
      continue;
    }
    const invite = await getInvite(db, r.user_id);
    const kind = doorKind({ on: true, bridgeOn: adBridgeOn(env), available: true, signedIn: true, attested: true, mode: "open", entitled, locked: false, invite: invite?.status ?? null, bot: false });
    if (kind) out.set(r.user_id, kind);
  }
  return out;
}
