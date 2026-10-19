/**
 * Drawn sets for places of their own (David, 2026-10-19: a place "if they were texting about it and then planned a
 * date… only if the scene doesn't exist already"). A date that goes somewhere the venue library has no set for
 * ("elsewhere@the observatory", lib/places.ts) gets one drawn once on fal.ai: an empty place, nobody in it, screened by
 * Hive before it's kept (David: Hive's screening is enough to show it at once). After that every date there reuses it,
 * and the scene (app/Scene.tsx) layers it over the generic set, which still shows until it exists or if it was refused.
 *
 * One row per place, however it's written (normalizeScene), claimed before it's drawn so two dates can't draw it twice.
 * Paid from the admin's fal and Hive keys (After Dark's settings, lib/adult/settings.ts); with no keys, nothing is drawn.
 */
import { checkSet } from "./adult/check";
import { adultKeys } from "./adult/settings";
import type { Db } from "./db";
import { checkShowText } from "./safety";
import { DATE_VENUES, EXTRA_VENUES, isPlaceholder, normalizeScene, placeLabel } from "./venues";

const LIBRARY: ReadonlySet<string> = new Set([...DATE_VENUES, ...EXTRA_VENUES].map((v) => v.id));

/** FLUX [schnell] (Apache-2.0): fast and about a third of a cent a picture, plenty for an empty room. */
export const SET_MODEL = "fal-ai/flux/schnell";
const FAL_RUN = "https://fal.run";
const MAX_BYTES = 12 * 1024 * 1024;
/** A set that failed to draw (not refused) may be tried again after this long. */
const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;

export type SetStatus = "drawing" | "ready" | "refused" | "failed";

type Fetch = typeof fetch;
let testFetch: Fetch | null = null;
export function setSetsFetchForTests(f: Fetch | null): void {
  testFetch = f;
}
const doFetch: Fetch = (...a) => (testFetch ?? fetch)(...a);

/** The prompt: the place itself, empty, photographed. Never anyone in it. */
export const setPrompt = (label: string): string =>
  `A photograph of ${label}, completely empty, no people, no figures, no text or signs, wide establishing shot, cinematic evening light, realistic detail, the setting for a scene.`;

/** The drawn set for a place, or null. */
export async function getSet(db: Db, normalized: string): Promise<{ mime: string; data: Buffer } | null> {
  const { rows } = await db.query<{ mime: string; data: Buffer }>(`select mime, data from place_sets where normalized = $1 and status = 'ready'`, [normalized]);
  return rows[0] ?? null;
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
    // Claim it: a new place, or one whose last try failed long enough ago. Ready, refused or being drawn: leave it.
    const claimed = await db.query(
      `insert into place_sets (normalized, label, status) values ($1, $2, 'drawing')
       on conflict (normalized) do update set status = 'drawing', label = excluded.label, updated_at = now()
         where place_sets.status = 'failed' and place_sets.updated_at < now() - ($3::int * interval '1 millisecond')
       returning 1`,
      [normalized, label, RETRY_AFTER_MS],
    );
    if (!claimed.rows.length) return "exists";
    const status = await draw(db, normalized, label);
    return status;
  } catch {
    await db.query(`update place_sets set status = 'failed', updated_at = now() where normalized = $1 and status = 'drawing'`, [normalized]).catch(() => {});
    return "failed";
  }
}

async function draw(db: Db, normalized: string, label: string): Promise<SetStatus> {
  const done = (status: SetStatus, reason: string | null, file?: { mime: string; bytes: Buffer }) =>
    db
      .query(`update place_sets set status = $2, reason = $3, mime = $4, data = $5, model = $6, updated_at = now() where normalized = $1`, [
        normalized,
        status,
        reason?.slice(0, 300) ?? null,
        file?.mime ?? null,
        file?.bytes ?? null,
        SET_MODEL,
      ])
      .then(() => status);
  const keys = await adultKeys(db).catch(() => null);
  if (!keys?.fal || !keys.hive) return done("failed", "no fal or Hive key saved");
  const res = await doFetch(`${FAL_RUN}/${SET_MODEL}`, {
    method: "POST",
    headers: { authorization: `Key ${keys.fal}`, "content-type": "application/json" },
    body: JSON.stringify({ prompt: setPrompt(label), image_size: "landscape_16_9", num_images: 1 }),
  });
  if (!res.ok) return done(res.status === 422 ? "refused" : "failed", `fal.ai ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const url = ((await res.json()) as { images?: { url?: string }[] }).images?.[0]?.url;
  if (!url) return done("failed", "fal.ai returned no picture");
  const verdict = await checkSet(keys.hive, url);
  if (!verdict.ok) return done(verdict.reason.startsWith("moderation:") ? "refused" : "failed", verdict.reason);
  const file = await doFetch(url);
  if (!file.ok) return done("failed", `download ${file.status}`);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length > MAX_BYTES) return done("failed", "file too large");
  return done("ready", null, { mime: file.headers.get("content-type") ?? "image/jpeg", bytes });
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
