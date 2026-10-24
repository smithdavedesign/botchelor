/**
 * Hive's circuit breaker (2026-10-23). Every picture, keyframe and video passes Hive before it's kept
 * (lib/adult/check.ts), and the check fails closed. That day self-serve Hive's 100 moderation requests ran out, and then
 * it answered `429 {"status_code":429,"message":"Too Many Requests"}` even to one request at a time, with no Retry-After:
 * an account limit (quota or plan), not our burst rate, so hive()'s own retries (#732) can't help. Each try still drew a
 * picture first (paid, on Venice or Replicate), then threw it away because the check couldn't run: 17 rejections in
 * production that day, all 429.
 *
 * The breaker (#740 paused on one 429 for a fixed half hour; this is the version David approved):
 *  - **Storage.** A 'hive' row in adult_media_cooldowns (the providers' cooldowns, lib/adult/fallback.ts, skip it), so
 *    every Vercel instance sees it. `failures` counts the checks in a row that couldn't run; `reason` and `status` are
 *    the last one's (Hive's own words, lib/adult/check.ts hiveSaid). A row from before `failures` existed counts as open.
 *  - **Opens** after HIVE_TRIP (2) checks in a row couldn't run: Hive answered 429 or 5xx, or couldn't be reached, after
 *    hive()'s own retries. One alone is a blip: its picture is discarded as before, and nothing is paused.
 *  - **Pause length.** 5 minutes when it opens, doubling with each further failure (10, 20, 40), up to 60. When Hive
 *    sends Retry-After, that's the pause instead (capped at 60 minutes). A pause is never shortened.
 *  - **While it's open,** nothing is drawn: every entry point that would draw a picture or start a keyframe or video
 *    asks hiveGate first and refuses with hivePausedMessage, before anything is spent. A check of something already made
 *    (a video being collected, a kept set or tile) isn't sent: it waits, unchecked and unshown (underHiveLimit).
 *  - **Probing.** When the pause ends, one probe goes through: the first draw claims it (the row's `until` moves on by
 *    HIVE_PROBE_LEASE_MS, atomically, so other instances keep refusing meanwhile) and sends one moderation call on a
 *    plain grey PNG (probeHive). Down again (429, 5xx, unreachable) is a further failure: a longer pause, and a refusal.
 *    An answer closes the breaker and the draw goes ahead. Anything else (a refused key) says nothing about Hive's state:
 *    the draw goes ahead and its own check decides, failing closed as always.
 *  - **Resets.** Any check Hive answers (a pass, or a refusal of its own) closes it: the row is deleted.
 *  - Nothing unchecked is ever shown, kept as visible or charged for: a refusal before the draw spends nothing, and a
 *    picture whose check opened the breaker is discarded and its tokens given back, as before. Each is logged in
 *    adult_rejections, with Hive's last answer.
 */
import type { Db } from "../db";
import { probeHive, type CheckResult } from "./check";
import { pauseClock, type HiveNotice } from "./hive-notice";

export { pauseClock };

/** The breaker's row in adult_media_cooldowns. */
export const HIVE_ROW = "hive";
/** How many checks in a row that couldn't run open the breaker. */
export const HIVE_TRIP = 2;
/** The first pause, doubled with each further failure, up to HIVE_PAUSE_MAX_MS (Retry-After capped at it too). */
export const HIVE_PAUSE_FIRST_MS = 5 * 60 * 1000;
export const HIVE_PAUSE_MAX_MS = 60 * 60 * 1000;
/** How long the one probe holds the breaker shut for everyone else, once the pause has ended. */
export const HIVE_PROBE_LEASE_MS = 60 * 1000;

let clock: () => number = Date.now;
/** Tests move the clock (a pause running out). */
export function setHivePauseClockForTests(now: (() => number) | null): void {
  clock = now ?? Date.now;
}

/** How long the breaker pauses after `failures` checks in a row couldn't run (HIVE_TRIP or more), or what Hive asked. */
export function hivePauseMs(failures: number, retryAfterMs: number | null = null): number {
  if (retryAfterMs !== null && Number.isFinite(retryAfterMs)) return Math.min(HIVE_PAUSE_MAX_MS, Math.max(0, retryAfterMs));
  return Math.min(HIVE_PAUSE_MAX_MS, HIVE_PAUSE_FIRST_MS * 2 ** Math.max(0, failures - HIVE_TRIP));
}

type Row = { until: string | Date; status: number | null; reason: string | null; updated_at: string | Date; failures: number | null };

/** The breaker's row, open or not (null: closed, nothing failed since Hive last answered). */
async function readRow(db: Db): Promise<Row | null> {
  return (
    (
      await db
        .query<Row>(`select until, status, reason, updated_at, failures from adult_media_cooldowns where provider = $1`, [HIVE_ROW])
        .catch(() => ({ rows: [] as Row[] }))
    ).rows[0] ?? null
  );
}
/** A row from before `failures` existed was a pause (#740), so it counts as open. */
const isOpen = (r: Row): boolean => r.failures === null || r.failures >= HIVE_TRIP;

/** The pause: until when, whether it's still running (`active`), and the last failure. Null: the breaker is closed. */
export type HivePause = { until: string; active: boolean; status: number | null; reason: string | null; updated_at: string; failures: number };

/** The breaker while it's open, its pause running or ended (an ended one means the next draw probes first). */
export async function hivePause(db: Db, now = clock()): Promise<HivePause | null> {
  const r = await readRow(db);
  if (!r || !isOpen(r)) return null;
  const until = new Date(r.until);
  return {
    until: until.toISOString(),
    active: until.getTime() > now,
    status: r.status,
    reason: r.reason,
    updated_at: new Date(r.updated_at).toISOString(),
    failures: r.failures ?? HIVE_TRIP,
  };
}

/**
 * Counts one check (or probe) that couldn't run: Hive answered 429 or 5xx (`status`), or couldn't be reached (null).
 * The HIVE_TRIP-th in a row opens the breaker for hivePauseMs (or Hive's Retry-After); each one after makes the pause
 * longer. Atomic, so checks on every instance count toward the same breaker. Returns until when it's paused, or null
 * when it's still closed (fewer than HIVE_TRIP in a row).
 */
export async function recordHiveFailure(db: Db, reason: string, status: number | null, retryAfterMs: number | null = null, now = clock()): Promise<string | null> {
  const at = new Date(now).toISOString();
  const r = await db
    .query<{ until: string | Date; failures: number }>(
      `insert into adult_media_cooldowns (provider, until, status, reason, updated_at, failures) values ($1, $2::timestamptz, $3, $4, $2::timestamptz, 1)
       on conflict (provider) do update set
         failures = coalesce(adult_media_cooldowns.failures, $5::int) + 1,
         until = greatest(
           adult_media_cooldowns.until,
           excluded.updated_at + least($6::float8, coalesce($7::float8, $8::float8 * power(2, greatest(0, coalesce(adult_media_cooldowns.failures, $5::int) + 1 - $5::int)))) * interval '1 millisecond'
         ),
         status = excluded.status, reason = excluded.reason, updated_at = excluded.updated_at
       returning until, failures`,
      [HIVE_ROW, at, status, reason.slice(0, 300), HIVE_TRIP, HIVE_PAUSE_MAX_MS, retryAfterMs === null ? null : Math.max(0, retryAfterMs), HIVE_PAUSE_FIRST_MS],
    )
    .catch(() => null);
  const row = r?.rows[0];
  if (!row) return null;
  if (row.failures < HIVE_TRIP) return null;
  console.warn(`[after-dark] Hive's breaker is open after ${row.failures} checks in a row that couldn't run, until ${new Date(row.until).toISOString()}: ${reason.slice(0, 200)}`);
  return new Date(row.until).toISOString();
}

/** Opens the breaker outright (HIVE_TRIP failures in a row), as a check that opened it would. For tests and scripts. */
export async function pauseHive(db: Db, reason: string, status: number | null = 429, now = clock()): Promise<string> {
  let until: string | null = null;
  for (let i = 0; i < HIVE_TRIP && !until; i++) until = await recordHiveFailure(db, reason, status, null, now);
  return until ?? new Date(now + HIVE_PAUSE_FIRST_MS).toISOString();
}

/** Closes the breaker: Hive answered. */
export async function closeHiveBreaker(db: Db): Promise<void> {
  await db.query(`delete from adult_media_cooldowns where provider = $1`, [HIVE_ROW]).catch(() => {});
}

/**
 * Claims the one probe once a pause has ended: the lease (until when the others still see a pause) for the one caller
 * that gets it, null for the rest.
 */
async function claimProbe(db: Db, now: number): Promise<string | null> {
  const lease = new Date(now + HIVE_PROBE_LEASE_MS).toISOString();
  const r = await db
    .query(
      `update adult_media_cooldowns set until = $3::timestamptz where provider = $1 and until <= $2::timestamptz and (failures is null or failures >= $4::int) returning provider`,
      [HIVE_ROW, new Date(now).toISOString(), lease, HIVE_TRIP],
    )
    .catch(() => null);
  return r?.rows.length ? lease : null;
}

const minutesLeft = (until: string, now: number): number => Math.max(1, Math.ceil((new Date(until).getTime() - now) / 60_000));

/**
 * What the caller is told while the breaker is open, as it's shown: "Hive (the safety check) has hit its limit, so
 * nothing is drawn until it answers again (about N minutes). Your tokens are untouched." `discarded`: a picture was
 * drawn and its check opened the breaker, so it wasn't kept. `tokens`: what's said about tokens ("untouched" when
 * nothing was spent, the default before a draw; "back" when they were refunded; "none" to say nothing, the default for
 * a discarded picture, whose caller says it).
 */
export function hivePausedMessage(until: string, opts: { discarded?: boolean; tokens?: "untouched" | "back" | "none"; now?: number } = {}): string {
  const minutes = minutesLeft(until, opts.now ?? clock());
  const about = `about ${minutes === 1 ? "a minute" : `${minutes} minutes`}`;
  const tokens = opts.tokens ?? (opts.discarded ? "none" : "untouched");
  const tail = tokens === "untouched" ? " Your tokens are untouched." : tokens === "back" ? " Your tokens are back." : "";
  return opts.discarded
    ? `Hive (the safety check) has hit its limit, so this one couldn't be checked and wasn't kept, and nothing more is drawn until it answers again (${about}).${tail}`
    : `Hive (the safety check) has hit its limit, so nothing is drawn until it answers again (${about}).${tail}`;
}

/** Why a check wasn't sent while paused (a shot's reason, a set's): it starts "the check couldn't run", so it's no verdict. */
export const hivePausedReason = (until: string): string => `the check couldn't run (Hive is paused until ${pauseClock(until)})`;
/** What adult_rejections says when a draw was refused before anything was drawn, with Hive's last answer. */
export const notDrawnReason = (until: string, last?: string | null): string =>
  `not drawn: Hive is paused until ${pauseClock(until)}${last ? ` (last: ${last.replace(/^the check couldn't run \((.*)\)$/, "$1")})` : ""}`;

/** A draw refused, or a picture discarded, because the breaker is open: the message is the page's, as it's shown. */
export class HivePausedError extends Error {
  constructor(
    readonly until: string,
    message = hivePausedMessage(until),
    readonly discarded = false,
  ) {
    super(message);
  }
}

/** The page's message for a HivePausedError once the caller knows what happened to the tokens (refunded or not spent). */
export const hivePausedErrorMessage = (err: HivePausedError, refunded: boolean): string =>
  hivePausedMessage(err.until, { discarded: err.discarded, tokens: refunded ? "back" : err.discarded ? "none" : "untouched" });

export type HiveGate = { ok: true } | { ok: false; until: string; message: string; reason: string };

/**
 * Asked before anything is drawn: go ahead, or the pause (its message for the page, its reason for adult_rejections).
 * A pause that has ended lets one probe through (probeHive), unless `probe: false` (a drawn set or tile is kept and
 * checked again, so it doesn't need one): down again means a longer pause; an answer closes the breaker; anything else
 * goes ahead, and the draw's own check decides.
 */
export async function hiveGate(db: Db, key: string | null, opts: { probe?: boolean } = {}): Promise<HiveGate> {
  const pause = await hivePause(db);
  if (!pause) return { ok: true };
  if (pause.active) return refusal(pause);
  if (opts.probe === false || !key) return { ok: true };
  // One probe at a time, across instances: whoever doesn't get it waits out the probe's lease like a pause.
  const now = clock();
  const lease = await claimProbe(db, now);
  if (!lease) {
    const held = await hivePause(db);
    return held?.active ? refusal(held) : { ok: true };
  }
  const probe = await probeHive(key);
  if (probe.result === "ok") {
    await closeHiveBreaker(db);
    return { ok: true };
  }
  if (probe.result === "down") {
    await recordHiveFailure(db, `the probe: ${probe.error}`, probe.status, probe.retry_after_ms);
    const again = await hivePause(db);
    if (again?.active) return refusal(again);
    return { ok: true };
  }
  // Neither: the probe's lease is given back (unless something has moved the pause on since), so the draw's own check is
  // sent and decides.
  await db
    .query(`update adult_media_cooldowns set until = $3::timestamptz where provider = $1 and until = $2::timestamptz`, [HIVE_ROW, lease, new Date(now).toISOString()])
    .catch(() => {});
  return { ok: true };
}

const refusal = (p: HivePause): HiveGate => ({ ok: false, until: p.until, message: hivePausedMessage(p.until), reason: notDrawnReason(p.until, p.reason) });

/** Whether pictures and videos are paused right now (no probe): until when, or null. */
export async function hivePausedUntil(db: Db): Promise<string | null> {
  const pause = await hivePause(db);
  return pause?.active ? pause.until : null;
}

/** Whether Hive gave a verdict (a pass or a refusal of its own), rather than not running at all. */
const hiveAnswered = (v: CheckResult): boolean => v.ok || !/^(the check couldn't run|the output check isn't set up)/.test(v.reason);

/**
 * A Hive check (checkOutput or checkSet, lib/adult/check.ts) held to the breaker. While its pause runs, nothing is
 * sent: the verdict is "the check couldn't run" with `paused` (so whatever was made waits, unchecked, or is discarded).
 * A check that couldn't run counts toward the breaker, and `paused` says until when if it opened it, so nothing more
 * goes to Hive. A check Hive answers closes the breaker.
 */
export async function underHiveLimit(db: Db, check: () => Promise<CheckResult>): Promise<CheckResult> {
  const row = await readRow(db);
  const now = clock();
  if (row && isOpen(row) && new Date(row.until).getTime() > now) {
    const until = new Date(row.until).toISOString();
    return { ok: false, reason: hivePausedReason(until), paused: until };
  }
  const verdict = await check();
  if (!verdict.ok && verdict.unavailable) {
    const until = await recordHiveFailure(db, verdict.reason, verdict.unavailable.status, verdict.unavailable.retry_after_ms);
    return until ? { ...verdict, paused: until } : verdict;
  }
  if (row && hiveAnswered(verdict)) await closeHiveBreaker(db);
  return verdict;
}

/** Hive's state for the admin (the settings page, its API, MCP after_dark_settings). */
export type HiveState = {
  /** "ok": closed, nothing failing; "failing": closed, but the last check(s) couldn't run; "paused": open, pause
   * running; "probe_next": open, pause ended, the next draw probes first. */
  state: "ok" | "failing" | "paused" | "probe_next";
  until: string | null;
  failures: number;
  status: number | null;
  last_error: string | null;
  at: string | null;
  /** One line, as the page shows it. */
  summary: string;
};

export async function hiveState(db: Db, now = clock()): Promise<HiveState> {
  const r = await readRow(db);
  if (!r) return { state: "ok", until: null, failures: 0, status: null, last_error: null, at: null, summary: "OK: answering" };
  const until = new Date(r.until).toISOString();
  const failures = r.failures ?? HIVE_TRIP;
  const base = { failures, status: r.status, last_error: r.reason, at: new Date(r.updated_at).toISOString() };
  const last = r.reason ? ` Last error: ${r.reason}` : "";
  if (!isOpen(r)) return { state: "failing", until: null, ...base, summary: `OK, but the last check couldn't run (${failures} of ${HIVE_TRIP} before it pauses).${last}` };
  if (new Date(r.until).getTime() > now) return { state: "paused", until, ...base, summary: `Paused until ${pauseClock(until)}: nothing is drawn.${last}` };
  return { state: "probe_next", until, ...base, summary: `Pause ended at ${pauseClock(until)}: the next picture or video asks Hive first.${last}` };
}

/** The scene page's notice while pictures and videos are paused (lib/adult/hive-notice.ts), or null. */
export async function hiveNotice(db: Db, now = clock()): Promise<HiveNotice | null> {
  const p = await hivePause(db, now);
  return p?.active ? { until: p.until, status: p.status } : null;
}

/** The pauses for the admin: Hive's (while its breaker is open) and each media provider's still running, soonest end first. */
export async function mediaPauses(db: Db, now = clock()): Promise<{ what: string; until: string; active: boolean; status: number | null; reason: string | null }[]> {
  const { rows } = await db
    .query<{ provider: string; until: string | Date; status: number | null; reason: string | null }>(
      `select provider, until, status, reason from adult_media_cooldowns where (provider <> $2 and until > $1) or (provider = $2 and (failures is null or failures >= $3::int)) order by until`,
      [new Date(now).toISOString(), HIVE_ROW, HIVE_TRIP],
    )
    .catch(() => ({ rows: [] as { provider: string; until: string | Date; status: number | null; reason: string | null }[] }));
  const name: Record<string, string> = { hive: "Hive (the safety check)", venice: "Venice", replicate: "Replicate" };
  return rows.map((r) => ({ what: name[r.provider] ?? r.provider, until: new Date(r.until).toISOString(), active: new Date(r.until).getTime() > now, status: r.status, reason: r.reason }));
}
