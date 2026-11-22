/**
 * Whose reports take something down by themselves (2026-11-22 audit: a call without a cookie was a new reporter each
 * time, so three calls hid any date, chat message or house line). A report counts toward REPORT_HIDE_THRESHOLD when it
 * comes from a signed-in account, or from an identity at least a day old: its signed session says when it was first
 * signed (lib/auth.ts readSession issuedAt), and a client can't change that. Anyone else's report still reaches the
 * admins where there's a list for it (a date's: lib/content-reports.ts, as a takedown request) and hides nothing until one
 * of them looks. Where bare ids still count (lib/http.ts bareIdsAllowed: local play and the tests) an id is trusted as it
 * always was; the live site never reads one.
 *
 * Every report route also has a limit per address and per identity (REPORT_LIMITS), all kinds of report together.
 */
import type { Db } from "./db";
import { authFromRequest, signedSession } from "./http";
import { overLimit, visitorKey } from "./limits";

/** How old an anonymous identity must be before its reports count. */
export const REPORTER_MIN_AGE_SECONDS = 24 * 60 * 60;
/** Reports of any kind from one address, or one identity: a person who meets something bad reports a few, not dozens. */
export const REPORT_LIMITS = { perHour: 10, perDay: 30 };
export const TOO_MANY_REPORTS = { error: "too_many_reports", message: "That's a lot of reports in a short time. Try again in an hour, or write to us from /report." } as const;

/** Whether this request's report counts toward hiding what it reports. */
export function reportCounts(req: Request, now = Date.now()): boolean {
  const auth = authFromRequest(req);
  if (!auth) return false; // no identity yet: the route mints one for this very call
  if (auth.authenticated) return true;
  const signed = signedSession(req);
  if (!signed) return true; // a bare id, read only where bare ids still count (never on the live site)
  return now / 1000 - signed.issuedAt >= REPORTER_MIN_AGE_SECONDS;
}

/** Whether this address or this identity has sent too many reports (and, when not, counts this one). */
export async function reportLimited(db: Db, req: Request, userId: string): Promise<boolean> {
  const address = visitorKey(req.headers);
  if (address !== null && (await overLimit(db, "report", address, REPORT_LIMITS))) return true;
  return overLimit(db, "report_user", userId, REPORT_LIMITS);
}
