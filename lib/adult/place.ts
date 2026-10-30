/**
 * After Dark's regional rules applied to a viewer (lib/jurisdiction.ts, docs/after-dark-legal-review.md). Every After
 * Dark API and page asks through adultViewer (lib/adult/mode.ts), which reads the place here: blocked places get the
 * same not-found as a stranger, text-only places get the scenes but every picture, video and voiced line is refused
 * (mediaRefusal), and admins, the operator, are open wherever they are.
 *
 * The mode is remembered per person (adult_viewer_places: a country and a US state, never an address or an IP), so work
 * that runs without a request, such as a chapter's automatic picture, asks mediaAllowedFor and draws nothing for someone
 * last seen in a text-only or blocked place.
 */
import { isAdmin } from "../admins";
import type { Db } from "../db";
import { json } from "../http";
import { adminAccess, afterDarkAccess, mediaAllowed, type Access, type AfterDarkMode, type Place } from "../jurisdiction";
import { requestPlace } from "../place";
import { canAfterDark, openEverywhere, REVIEWER_PROVIDER, type Entitlement } from "./entitlement";

/** How often an unchanged place is written again (it's read by background work, so a stale row would mislead it). */
const REWRITE_AFTER_MS = 10 * 60 * 1000;
const written = new Map<string, { key: string; at: number }>();

/** What After Dark may be for this person, from this place. */
export const accessFor = (where: Place, everywhere: boolean): Access => (everywhere ? adminAccess(where) : afterDarkAccess(where));

/** Remembers the person's mode and place, when it changed or the last write is old. Best effort: a failed write is logged. */
export async function rememberAccess(db: Db, userId: string, access: Access, now = Date.now()): Promise<void> {
  const key = `${access.mode}|${access.place.country ?? ""}|${access.place.region ?? ""}`;
  const last = written.get(userId);
  if (last && last.key === key && now - last.at < REWRITE_AFTER_MS) return;
  written.set(userId, { key, at: now });
  await db
    .query(
      `insert into adult_viewer_places (user_id, mode, country, region, seen_at) values ($1, $2, $3, $4, now())
       on conflict (user_id) do update set mode = excluded.mode, country = excluded.country, region = excluded.region, seen_at = now()`,
      [userId, access.mode, access.place.country, access.place.region],
    )
    .catch((err: unknown) => {
      written.delete(userId);
      console.error("[after-dark] could not remember where a viewer is:", err instanceof Error ? err.message : "unknown");
    });
}

/** The viewer's access from this request's place, remembered for background work. */
export async function viewerAccess(db: Db, userId: string, admin: boolean, headers: Headers): Promise<Access> {
  const access = accessFor(requestPlace(headers), admin);
  await rememberAccess(db, userId, access);
  return access;
}

/** Whether pictures, video and voiced lines may be made for this person: an admin, a reviewer, or last seen in an open place. */
export async function mediaAllowedFor(db: Db, userId: string): Promise<boolean> {
  if (await isAdmin(db, userId)) return true;
  if (await isReviewer(db, userId)) return true;
  const row = (await db.query<{ mode: AfterDarkMode }>(`select mode from adult_viewer_places where user_id = $1`, [userId])).rows[0];
  return row ? mediaAllowed(row) : false;
}

/** Whether this person holds a reviewer pass still running (lib/adult/entitlement.ts). */
async function isReviewer(db: Db, userId: string): Promise<boolean> {
  const r = await db.query(
    `select 1 from adult_entitlements where user_id = $1 and provider = $2 and subscription_status = 'active' and (period_end is null or period_end > now())`,
    [userId, REVIEWER_PROVIDER],
  );
  return r.rows.length > 0;
}

/** The refusal a media API gives in a text-only (or blocked) place, or null when media is allowed. */
export async function mediaRefusal(db: Db, userId: string): Promise<Response | null> {
  if (await mediaAllowedFor(db, userId)) return null;
  return json(
    {
      error: "media_not_available_here",
      message: "Pictures, video and voiced lines aren't available where you're connecting from, because of the law there. The scenes are.",
    },
    451,
  );
}

/** The request's headers on a server page or route, or none outside one (a test calling a helper directly). */
export async function pageHeaders(): Promise<Headers> {
  try {
    const { headers } = await import("next/headers");
    return new Headers(await headers());
  } catch {
    return new Headers();
  }
}

export type Here = Access & { entitled: Entitlement; admin: boolean };

/**
 * After Dark for this visitor, here: their entitlement and what the place allows (admins open everywhere). For the
 * surfaces that show or link to it (the nav, the account card, teasers, the looks builder's After Dark tab), which must
 * say nothing of it where it isn't offered.
 */
export async function accessHere(db: Db, auth: { userId: string; authenticated: boolean } | null, headers?: Headers): Promise<Here> {
  const entitled = await canAfterDark(db, auth);
  const admin = entitled.ok && entitled.why === "admin";
  const access = accessFor(requestPlace(headers ?? (await pageHeaders())), openEverywhere(entitled));
  return { ...access, entitled, admin };
}

/** Tests: forget what was remembered in memory (the table is reset with the database). */
export function forgetRememberedPlacesForTests(): void {
  written.clear();
}
