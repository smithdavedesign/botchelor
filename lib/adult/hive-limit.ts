/**
 * Hive's daily limit (2026-10-23). Self-serve Hive allows 100 visual-moderation requests a day (docs/after-dark-costs.md),
 * and every picture, keyframe and video passes Hive before it's kept (lib/adult/check.ts). That morning's video tests
 * used the day up by about 08:26 UTC, and for the next 12 hours Hive answered every check `429 Too Many Requests`. Each
 * try of David's still drew a picture first (paid, on Venice or Replicate), then threw it away because the check couldn't
 * run: 18 baselines and 2 scene pictures, and with no baseline, no video could start.
 *
 * So a check that ends on a 429 after its retries (a burst is retried, lib/adult/check.ts) pauses pictures and videos:
 *  - The pause is a 'hive' row in adult_media_cooldowns (the providers' cooldowns, lib/adult/fallback.ts, skip it), so
 *    it holds across Vercel's instances.
 *  - While it runs, nothing is drawn: every entry point that would draw a picture or start a keyframe or video asks
 *    hiveGate first and refuses with hivePausedMessage, before anything is spent. A check of something already made
 *    (a video being collected, a kept set or tile) isn't sent: it waits, unchecked and unshown (underHiveLimit).
 *  - When it has run out, the first draw sends one probe first (probeHive: one moderation call on a plain grey PNG): a
 *    429 starts another pause and refuses; an answer ends it. Anything else (Hive down, unreachable) says nothing about
 *    the limit, so the draw goes ahead and its own check decides, failing closed as always.
 *  - Nothing unchecked is ever shown, kept as visible or charged for: a refusal before the draw spends nothing, and a
 *    picture whose check tripped the pause is discarded and its tokens given back, as before. Each is logged in
 *    adult_rejections.
 *
 * Why HIVE_PAUSE_MS is half an hour, probed on expiry, rather than until Hive's day resets: Hive's 429 says nothing about
 * when (no Retry-After, no rate-limit headers, 2026-10-23), and we don't know whether its day resets at midnight UTC, 24
 * hours after the first call, or rolls. A fixed half hour finds the reset within 30 minutes of whenever it happens, and
 * costs at most one moderation call per half hour while someone keeps trying (none while nobody does: the probe runs
 * only before a draw). Waiting until midnight would guess; a shorter pause would mostly ask a Hive that's still out.
 */
import type { Db } from "../db";
import { probeHive, type CheckResult } from "./check";

/** The pause's row in adult_media_cooldowns. */
export const HIVE_ROW = "hive";
/** How long a pause runs before a probe asks Hive again (the reasoning is above). */
export const HIVE_PAUSE_MS = 30 * 60 * 1000;

let clock: () => number = Date.now;
/** Tests move the clock (a pause running out). */
export function setHivePauseClockForTests(now: (() => number) | null): void {
  clock = now ?? Date.now;
}

/** The pause: until when, whether it's still running (`active`), and the 429 that started it. Null: no pause. */
export type HivePause = { until: string; active: boolean; status: number | null; reason: string | null; updated_at: string };

/** The pause, running or run out (a run-out one means the next draw probes first). Null when there's none. */
export async function hivePause(db: Db, now = clock()): Promise<HivePause | null> {
  const r = (
    await db
      .query<{ until: string | Date; status: number | null; reason: string | null; updated_at: string | Date }>(
        `select until, status, reason, updated_at from adult_media_cooldowns where provider = $1`,
        [HIVE_ROW],
      )
      .catch(() => ({ rows: [] as { until: string | Date; status: number | null; reason: string | null; updated_at: string | Date }[] }))
  ).rows[0];
  if (!r) return null;
  const until = new Date(r.until);
  return { until: until.toISOString(), active: until.getTime() > now, status: r.status, reason: r.reason, updated_at: new Date(r.updated_at).toISOString() };
}

/** Starts (or extends) the pause for HIVE_PAUSE_MS, never shortening one already longer. Returns until when it runs. */
export async function pauseHive(db: Db, reason: string, now = clock()): Promise<string> {
  const until = new Date(now + HIVE_PAUSE_MS).toISOString();
  const r = await db
    .query<{ until: string | Date }>(
      `insert into adult_media_cooldowns (provider, until, status, reason, updated_at) values ($1, $2, 429, $3, $4)
       on conflict (provider) do update set until = greatest(adult_media_cooldowns.until, excluded.until), status = excluded.status, reason = excluded.reason, updated_at = excluded.updated_at
       returning until`,
      [HIVE_ROW, until, reason.slice(0, 300), new Date(now).toISOString()],
    )
    .catch(() => null);
  const stored = r?.rows[0]?.until;
  return stored ? new Date(stored).toISOString() : until;
}

/** Ends a pause that has run out, once Hive has answered. One still running (another check's, just now) stays. */
export async function endHivePause(db: Db, now = clock()): Promise<void> {
  await db.query(`delete from adult_media_cooldowns where provider = $1 and until <= $2`, [HIVE_ROW, new Date(now).toISOString()]).catch(() => {});
}

/** "21:45 UTC": when a pause ends, as the page and the log say it. */
export const pauseClock = (until: string): string => `${new Date(until).toISOString().slice(11, 16)} UTC`;

/**
 * What the page says while pictures and videos are paused, as it's shown. `discarded`: a picture was drawn and its
 * check found Hive out, so it wasn't kept.
 */
export function hivePausedMessage(until: string, opts: { discarded?: boolean; now?: number } = {}): string {
  const minutes = Math.max(1, Math.ceil((new Date(until).getTime() - (opts.now ?? clock())) / 60_000));
  const when = `${pauseClock(until)} (in about ${minutes === 1 ? "a minute" : `${minutes} minutes`})`;
  return opts.discarded
    ? `Pictures and videos are paused: the safety check every picture has to pass is over its daily limit, so this one couldn't be checked and wasn't kept. Try again after ${when}.`
    : `Pictures and videos are paused: the safety check every picture has to pass is over its daily limit. Try again after ${when}.`;
}

/** Why a check wasn't sent while paused (a shot's reason, a set's): it starts "the check couldn't run", so it's no verdict. */
export const hivePausedReason = (until: string): string => `the check couldn't run (Hive is over its daily limit, paused until ${pauseClock(until)})`;
/** What adult_rejections says when a draw was refused before anything was drawn. */
export const notDrawnReason = (until: string): string => `not drawn: Hive is over its daily limit, paused until ${pauseClock(until)}`;

/** A draw refused, or a picture discarded, because of the pause: the message is the page's, as it's shown. */
export class HivePausedError extends Error {
  constructor(
    readonly until: string,
    message = hivePausedMessage(until),
  ) {
    super(message);
  }
}

export type HiveGate = { ok: true } | { ok: false; until: string; message: string; reason: string };

/**
 * Asked before anything is drawn: go ahead, or the pause (its message for the page, its reason for adult_rejections).
 * A pause that has run out is probed first (probeHive), unless `probe: false` (a drawn set or tile is kept and checked
 * again, so it doesn't need one): a 429 starts another pause; an answer ends it; anything else goes ahead, and the
 * draw's own check decides.
 */
export async function hiveGate(db: Db, key: string | null, opts: { probe?: boolean } = {}): Promise<HiveGate> {
  const pause = await hivePause(db);
  if (!pause) return { ok: true };
  if (pause.active) return refusal(pause.until);
  if (opts.probe === false || !key) return { ok: true };
  const probe = await probeHive(key);
  if (probe === "limited") return refusal(await pauseHive(db, "the probe: Hive answered 429"));
  if (probe === "ok") await endHivePause(db);
  return { ok: true };
}

const refusal = (until: string): HiveGate => ({ ok: false, until, message: hivePausedMessage(until), reason: notDrawnReason(until) });

/** Whether pictures and videos are paused right now (no probe): until when, or null. */
export async function hivePausedUntil(db: Db): Promise<string | null> {
  const pause = await hivePause(db);
  return pause?.active ? pause.until : null;
}

/** Whether Hive gave a verdict (a pass or a refusal of its own), rather than not running at all. */
const hiveAnswered = (v: CheckResult): boolean => v.ok || !/^(the check couldn't run|the output check isn't set up)/.test(v.reason);

/**
 * A Hive check (checkOutput or checkSet, lib/adult/check.ts) held to the pause. While it runs, nothing is sent: the
 * verdict is "the check couldn't run" with `paused` (so whatever was made waits, unchecked, or is discarded). A check
 * that ends on a 429 after its retries starts the pause (`paused` on its verdict), so nothing more goes to Hive. A check
 * Hive answers ends a pause that had run out.
 */
export async function underHiveLimit(db: Db, check: () => Promise<CheckResult>): Promise<CheckResult> {
  const pause = await hivePause(db);
  if (pause?.active) return { ok: false, reason: hivePausedReason(pause.until), paused: pause.until };
  const verdict = await check();
  if (!verdict.ok && verdict.limited) return { ...verdict, paused: await pauseHive(db, verdict.reason) };
  if (pause && hiveAnswered(verdict)) await endHivePause(db);
  return verdict;
}

/** The pauses for the admin: Hive's (running or run out) and each media provider's still running, soonest end first. */
export async function mediaPauses(db: Db, now = clock()): Promise<{ what: string; until: string; active: boolean; status: number | null; reason: string | null }[]> {
  const { rows } = await db
    .query<{ provider: string; until: string | Date; status: number | null; reason: string | null }>(
      `select provider, until, status, reason from adult_media_cooldowns where until > $1 or provider = $2 order by until`,
      [new Date(now).toISOString(), HIVE_ROW],
    )
    .catch(() => ({ rows: [] as { provider: string; until: string | Date; status: number | null; reason: string | null }[] }));
  const name: Record<string, string> = { hive: "Hive (the safety check)", venice: "Venice", replicate: "Replicate" };
  return rows.map((r) => ({ what: name[r.provider] ?? r.provider, until: new Date(r.until).toISOString(), active: new Date(r.until).getTime() > now, status: r.status, reason: r.reason }));
}
