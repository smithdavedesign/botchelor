/**
 * Drawn sets for places of their own (David, 2026-10-19: a place "if they were texting about it and then planned a
 * date… only if the scene doesn't exist already"). A date that goes somewhere the venue library has no set for
 * ("elsewhere@the observatory", lib/places.ts) gets one drawn once on fal.ai: an empty place, nobody in it, screened by
 * Hive before it's kept (David: Hive's screening is enough to show it at once). After that every date there reuses it,
 * and the scene (app/Scene.tsx) layers it over the generic set, which still shows until it exists or if it was refused.
 *
 * One row per place, however it's written (normalizeScene), claimed before it's drawn so two dates can't draw it twice.
 * Paid from the admin's fal and Hive keys (After Dark's settings, lib/adult/settings.ts); with no keys, nothing is drawn.
 *
 * A set whose check couldn't run (Hive answered 429, or was down) isn't refused (David, 2026-10-21: 48 of 57 failed sets
 * were "Hive answered 429", never retried; the #310 fix for look tiles, lib/looks-draw.ts): its picture is kept, never
 * shown, and only the check runs again, with a growing delay, and never while Hive is cooling down from a 429. Nor while
 * Hive is over its daily limit (lib/adult/hive-limit.ts, shared with After Dark): then no set is drawn or checked at all.
 */
import { after } from "next/server";
import { markAiImage } from "./ai-mark";
import { canonicalSet, closestSet } from "./adult/continuity";
import { hivePausedUntil } from "./adult/hive-limit";
import { checkMedia, checkReady, isVerdict } from "./adult/moderation";
import { adultKeys } from "./adult/settings";
import type { Db } from "./db";
import { checkShowText } from "./safety";
import { DATE_VENUES, EXTRA_VENUES, isPlaceholder, normalizeScene, placeLabel } from "./venues";

const LIBRARY: ReadonlySet<string> = new Set([...DATE_VENUES, ...EXTRA_VENUES].map((v) => v.id));

/** FLUX [schnell] (Apache-2.0): fast and about a third of a cent a picture, plenty for an empty room. */
export const SET_MODEL = "fal-ai/flux/schnell";
const FAL_RUN = "https://fal.run";
const MAX_BYTES = 12 * 1024 * 1024;
/** A set that failed to draw for good (not refused, not a passing problem) may be tried again after this long. */
const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;
/** A passing failure is tried again after this long, doubling each time up to RETRY_MAX_MS, at most RETRY_ATTEMPTS times. */
const RETRY_BASE_MS = 10 * 60 * 1000;
const RETRY_MAX_MS = 6 * 60 * 60 * 1000;
export const RETRY_ATTEMPTS = 8;
/** A set "drawing" this long was cut off (its function ended mid-draw): claimable again. */
const STALE_DRAWING_MS = 10 * 60 * 1000;
/** After a Hive 429 nothing is sent to Hive for this long, by any set: one busy night never bursts it. */
const HIVE_COOLDOWN_MS = 5 * 60 * 1000;
/** Hive gave no verdict: a reason to check again, not a refusal. */
const UNCHECKED = /^(unchecked: |the check couldn't run|moderation reply had no child scores)/;
const UNCHECKED_PREFIX = "unchecked: ";
const RATE_LIMITED = /\b429\b/;

/** A failure worth trying again soon: no verdict, a rate limit, a provider outage, or a draw cut off with no reason. */
export const retryableReason = (reason: string | null): boolean =>
  !reason || UNCHECKED.test(reason) || RATE_LIMITED.test(reason) || /fal\.ai 5\d\d|timed? ?out|fetch failed|network|cut off/i.test(reason);
/** The wait before the next try, after `attempts` tries: 10 minutes, doubling, at most 6 hours. */
export const retryDelayMs = (attempts: number): number => Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempts));

export type SetStatus = "drawing" | "ready" | "refused" | "failed";

type Fetch = typeof fetch;
let testFetch: Fetch | null = null;
export function setSetsFetchForTests(f: Fetch | null): void {
  testFetch = f;
}
const doFetch: Fetch = (...a) => (testFetch ?? fetch)(...a);

/** Runs set work after the response (a serverless function would otherwise end mid-draw); right away outside a request. */
export function inBackground(work: () => Promise<unknown>): void {
  const run = () => work().catch(() => {});
  try {
    after(run);
  } catch {
    void run();
  }
}

/** The prompt: the place itself, empty, photographed. Never anyone in it. */
export const setPrompt = (label: string): string =>
  `A photograph of ${label}, completely empty, no people, no figures, no text or signs, wide establishing shot, cinematic evening light, realistic detail, the setting for a scene.`;

/** The drawn set for a place, or null. */
export async function getSet(db: Db, normalized: string): Promise<{ mime: string; data: Buffer } | null> {
  const { rows } = await db.query<{ mime: string; data: Buffer }>(`select mime, data from place_sets where normalized = $1 and status = 'ready'`, [normalized]);
  return rows[0] ?? null;
}

/** Where a set stands, for the route: "retrying" is a failure that will be checked or drawn again. */
export async function setStatus(db: Db, normalized: string): Promise<"ready" | "drawing" | "retrying" | "refused" | "failed" | "none"> {
  const r = (await db.query<{ status: SetStatus; reason: string | null; attempts: number }>(`select status, reason, attempts from place_sets where normalized = $1`, [normalized])).rows[0];
  if (!r) return "none";
  if (r.status === "failed" && retryableReason(r.reason) && r.attempts < RETRY_ATTEMPTS) return "retrying";
  return r.status;
}

/**
 * Draws the set for a place if it has none yet (a place id or a bare label). Returns what happened; never throws, so a
 * set can never cost a date.
 */
export async function ensureSet(db: Db, place: string | null | undefined): Promise<SetStatus | "exists" | "skipped"> {
  // A place id ("elsewhere@…"; a library venue or one of their homes has its own set), or a bare label.
  const label = !place ? null : place.includes("@") ? (isPlaceholder(place) ? placeLabel(place) : null) : LIBRARY.has(place) ? null : place.trim() || null;
  const normalized = label ? normalizeScene(label) : "";
  if (!label || !normalized) return "skipped";
  if (!checkShowText({ place: label }).ok) return "skipped";
  try {
    // Claim it: a new place; one whose passing failure is due (a kept picture is only checked again); one whose last
    // try failed for good long enough ago; or one stuck drawing. Ready, refused or being drawn: leave it.
    const claimed = await db.query<{ has_data: boolean }>(
      `insert into place_sets (normalized, label, status) values ($1, $2, 'drawing')
       on conflict (normalized) do update set status = 'drawing', updated_at = now()
         where (place_sets.status = 'failed' and place_sets.retry_at is not null and place_sets.retry_at <= now() and place_sets.attempts < $4)
            or (place_sets.status = 'failed' and place_sets.retry_at is null and place_sets.updated_at < now() - ($3::int * interval '1 millisecond'))
            or (place_sets.status = 'drawing' and place_sets.updated_at < now() - ($5::int * interval '1 millisecond'))
       returning (data is not null) as has_data`,
      [normalized, label, RETRY_AFTER_MS, RETRY_ATTEMPTS, STALE_DRAWING_MS],
    );
    if (!claimed.rows.length) return "exists";
    const wait = await hiveWaitMs(db);
    if (wait > 0) return await later(db, normalized, `${UNCHECKED_PREFIX}waiting for Hive to cool down`, wait);
    return claimed.rows[0].has_data ? await recheck(db, normalized) : await draw(db, normalized, label);
  } catch {
    // Cut off by an error (a timeout, a network failure): a passing problem, so it's tried again with the backoff.
    await failed(db, normalized, "the draw was cut off").catch(() => {});
    return "failed";
  }
}

/**
 * Files a failure. A passing one (retryableReason) gets its next try scheduled, waiting longer each time; the picture,
 * when there is one, is kept to check again and never shown.
 */
async function failed(db: Db, normalized: string, reason: string, picture?: { mime: string; bytes: Buffer }): Promise<SetStatus> {
  const passing = retryableReason(reason);
  await db.query(
    `update place_sets set status = 'failed', reason = $2, mime = coalesce($3, mime), data = coalesce($4, data), model = $5,
            attempts = attempts + 1,
            retry_at = case when $6 then now() + (least($7::bigint, $8::bigint * power(2, attempts)::bigint) * interval '1 millisecond') else null end,
            updated_at = now()
      where normalized = $1`,
    [normalized, reason.slice(0, 300), picture?.mime ?? null, picture?.bytes ?? null, SET_MODEL, passing, RETRY_MAX_MS, RETRY_BASE_MS],
  );
  return "failed";
}

/** A claimed set put back untried (Hive is cooling down): failed for now, due again in `ms`. Not counted as a try. */
async function later(db: Db, normalized: string, reason: string, ms: number): Promise<SetStatus> {
  await db.query(`update place_sets set status = 'failed', reason = coalesce(reason, $2), retry_at = now() + ($3::int * interval '1 millisecond'), updated_at = now() where normalized = $1`, [
    normalized,
    reason,
    ms,
  ]);
  return "failed";
}

/**
 * How long nothing more goes to Hive for a set, in ms (0: go ahead): while Hive is over its daily limit, until that pause
 * is over (lib/adult/hive-limit.ts); after a set's 429, the cool-down.
 */
async function hiveWaitMs(db: Db): Promise<number> {
  const paused = await hivePausedUntil(db);
  if (paused) return Math.max(60_000, new Date(paused).getTime() - Date.now());
  const { rows } = await db.query(`select 1 from place_sets where reason like '%429%' and updated_at > now() - ($1::int * interval '1 millisecond') limit 1`, [HIVE_COOLDOWN_MS]);
  return rows.length > 0 ? HIVE_COOLDOWN_MS : 0;
}
/** Whether Hive is cooling down for sets: then nothing more is sent to it until it's over. */
const hiveCooling = async (db: Db): Promise<boolean> => (await hiveWaitMs(db)) > 0;

async function draw(db: Db, normalized: string, label: string): Promise<SetStatus> {
  const done = (status: "ready" | "refused", reason: string | null, file?: { mime: string; bytes: Buffer }) =>
    db
      .query(`update place_sets set status = $2, reason = $3, mime = $4, data = $5, model = $6, retry_at = null, updated_at = now() where normalized = $1`, [
        normalized,
        status,
        reason?.slice(0, 300) ?? null,
        file?.mime ?? null,
        file?.bytes ?? null,
        SET_MODEL,
      ])
      .then(() => status);
  const keys = await adultKeys(db).catch(() => null);
  if (!keys?.fal || !(await checkReady(db, { pg: true }))) return failed(db, normalized, "no fal key or no checker saved");
  const res = await doFetch(`${FAL_RUN}/${SET_MODEL}`, {
    method: "POST",
    headers: { authorization: `Key ${keys.fal}`, "content-type": "application/json" },
    body: JSON.stringify({ prompt: setPrompt(label), image_size: "landscape_16_9", num_images: 1 }),
  });
  if (!res.ok) {
    const why = `fal.ai ${res.status}: ${(await res.text()).slice(0, 200)}`;
    return res.status === 422 ? done("refused", why) : failed(db, normalized, why);
  }
  const url = ((await res.json()) as { images?: { url?: string }[] }).images?.[0]?.url;
  if (!url) return failed(db, normalized, "fal.ai returned no picture");
  const verdict = await checkMedia(db, url, "set");
  if (isVerdict(verdict)) return done("refused", (verdict as { reason: string }).reason);
  const file = await doFetch(url);
  if (!file.ok) return failed(db, normalized, `download ${file.status}`);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length > MAX_BYTES) return failed(db, normalized, "file too large");
  // Stored with the machine-readable "AI-generated" mark (lib/ai-mark.ts, EU AI Act Art. 50).
  const picture = { mime: file.headers.get("content-type") ?? "image/jpeg", bytes: markAiImage(bytes) };
  // No verdict (a rate limit, an outage): the picture is kept, never shown, and only checked again later.
  if (!verdict.ok) return failed(db, normalized, UNCHECKED.test(verdict.reason) && !verdict.reason.startsWith(UNCHECKED_PREFIX) ? UNCHECKED_PREFIX + verdict.reason : verdict.reason, picture);
  return done("ready", null, picture);
}

/** Checks a kept picture again (nothing new drawn or paid for): ready if it passes, refused if Hive refuses, else later. */
async function recheck(db: Db, normalized: string): Promise<SetStatus> {
  const row = (await db.query<{ mime: string | null; data: Buffer | Uint8Array | null }>(`select mime, data from place_sets where normalized = $1`, [normalized])).rows[0];
  if (!row?.data || !(await checkReady(db, { pg: true }))) return failed(db, normalized, `${UNCHECKED_PREFIX}no picture or no checker to check it with`);
  const data = row.data;
  const verdict = await checkMedia(db, { base64: Buffer.from(data).toString("base64"), mime: row.mime ?? "image/jpeg" }, "set");
  if (verdict.ok) {
    await db.query(`update place_sets set status = 'ready', reason = null, retry_at = null, updated_at = now() where normalized = $1`, [normalized]);
    return "ready";
  }
  if (isVerdict(verdict)) {
    await db.query(`update place_sets set status = 'refused', reason = $2, data = null, retry_at = null, updated_at = now() where normalized = $1`, [normalized, verdict.reason.slice(0, 300)]);
    return "refused";
  }
  return failed(db, normalized, verdict.reason.startsWith(UNCHECKED_PREFIX) ? verdict.reason : UNCHECKED_PREFIX + verdict.reason);
}

/**
 * Checks again the sets whose check couldn't run and are due, oldest due first, one at a time with a pause, stopping at
 * the first rate limit (never a burst on Hive). Only kept pictures: nothing new is drawn (or paid for) here.
 */
export async function retryDueSets(db: Db, limit = 2, pauseMs = 1500): Promise<{ label: string; status: string }[]> {
  if (await hiveCooling(db)) return [];
  const { rows } = await db.query<{ normalized: string; label: string }>(
    `select normalized, label from place_sets where status = 'failed' and data is not null and retry_at <= now() and attempts < $2 order by retry_at limit $1`,
    [Math.max(1, Math.min(limit, 10)), RETRY_ATTEMPTS],
  );
  const out: { label: string; status: string }[] = [];
  for (const [i, r] of rows.entries()) {
    if (i && pauseMs) await new Promise((res) => setTimeout(res, pauseMs));
    const claimed = await db.query(`update place_sets set status = 'drawing', updated_at = now() where normalized = $1 and status = 'failed' returning 1`, [r.normalized]);
    if (!claimed.rows.length) continue;
    const status = await recheck(db, r.normalized).catch(() => failed(db, r.normalized, "the draw was cut off"));
    out.push({ label: r.label, status });
    if (status === "failed" && (await hiveCooling(db))) break;
  }
  return out;
}

/** The owner's possessive as the label writes it ("Lexi's", "James'"), apostrophe straightened, for canonicalSet's owner. */
function ownerAsWritten(label: string, owner: string): string {
  for (const m of label.matchAll(/[\p{L}\p{N}-]+['’]s?(?![\p{L}])/gu)) {
    const said = m[0].replace(/’/g, "'");
    if (said.toLowerCase().replace(/'s?$/, "") === owner) return said;
  }
  return `${owner.charAt(0).toUpperCase()}${owner.slice(1)}'s`;
}

/**
 * The name to draw a place's set under: its canonical name ("bedroom"), and a home as the room you'd walk into. Whose it
 * is stays (v2.2, Lexi × Dex on prod, 2026-10-22, a night shown in "Lexis bedroom"): a move to "Lexi's bedroom" used to
 * come out as plain "bedroom", or another pair's drawn one; now it's "Lexi's bedroom", and "Lexi's living room" for her
 * place. The set's key is its normalized name (lib/venues.ts normalizeScene), the one the theater asks for, so what's
 * stored, what's shown and what's drawn all say "Lexi's".
 */
export function drawLabel(label: string): string {
  const c = canonicalSet(label);
  if (!c.known) return label.trim().replace(/’/g, "'");
  if (c.owner) return `${ownerAsWritten(label, c.owner)} ${c.canonical === "home" ? "living room" : c.canonical}`;
  return c.canonical === "home" ? "apartment living room" : c.canonical;
}

/**
 * The set for a place a scene names (After Dark): the closest set already drawn for the same place ("bedroom glow" → the
 * ready "cozy bedroom"), else its canonical name, drawn once in the background. Returns the label the scene stands on.
 */
export async function resolveSet(db: Db, label: string): Promise<string> {
  const ready = (await db.query<{ label: string }>(`select label from place_sets where status = 'ready'`)).rows.map((r) => r.label);
  const reuse = closestSet(label, ready);
  if (reuse) return reuse;
  const name = drawLabel(label).slice(0, 40);
  inBackground(() => ensureSet(db, name));
  return name;
}

/**
 * resolveSet that draws nothing: the closest ready set for a place, else the name it would be drawn under. The ready
 * sets are read once, up front (the After Dark eval route writes nothing, not even a set to draw).
 */
export async function readySetResolver(db: Db): Promise<(label: string) => string> {
  const ready = (await db.query<{ label: string }>(`select label from place_sets where status = 'ready'`)).rows.map((r) => r.label);
  return (label: string) => closestSet(label, ready) ?? drawLabel(label).slice(0, 40);
}

/** Draws sets for the places asked for most that have none yet (the admin's backfill). */
export async function drawMissingSets(db: Db, limit = 10): Promise<{ label: string; status: string }[]> {
  const { rows } = await db.query<{ label: string }>(
    `select min(r.label) as label from scene_requests r
      where not exists (select 1 from place_sets s where s.normalized = r.normalized and s.status in ('ready', 'refused', 'drawing'))
      group by r.normalized order by count(*) desc limit $1`,
    [limit],
  );
  const out: { label: string; status: string }[] = [];
  for (const r of rows) out.push({ label: r.label, status: await ensureSet(db, r.label) });
  return out;
}
