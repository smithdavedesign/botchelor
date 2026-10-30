/**
 * The sound of a place (docs/PRDs/theater-immersion.md #6; David, 2026-10-29: "make the theater even more immersive"): a
 * quiet bed of sound per place, a jazz bar's murmur, waves, rain on a window, under the voices while 🔈 is on. Made once
 * per place on Venice's ElevenLabs sound effects (the model that loops without a seam, about 5¢ for 20 s) and shared by
 * every night there, like a drawn set (lib/sets.ts): nobody's in it, so it's nobody's.
 *
 * Keyed by the stage's place (AfterDarkTheater's stageFor): a library venue by its id, anywhere else by its words
 * (normalizeScene). Asked for when a theater with 🔈 on reaches a place with none; at most DAILY_NEW a day are started.
 * Queued at Venice and collected on the next ask, like a clip.
 */
import type { Db } from "../db";
import { keepBytes, readBytes } from "../object-store";
import { checkShowText } from "../safety";
import { normalizeScene, placeLabel, venueName } from "../venues";
import { providerError } from "./fallback";
import { logRequest } from "./request-log";
import { adultKeys, getAdultSettings } from "./settings";

const VENICE = "https://api.venice.ai/api/v1";
/** A bed's length: long enough not to be noticed looping, the model's limit is 22 s. */
const SECONDS = 20;
/** New places' sounds started a day, at most: about $1 if every one is new. */
export const DAILY_NEW = 20;
/** One not back by then is given up, and asked for again later (one took about 9 minutes). */
const GIVE_UP_MS = 20 * 60 * 1000;
/** A failed one is tried again after this long. */
const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;
const MAX_BYTES = 8 * 1024 * 1024;

type Fetch = typeof fetch;
let testFetch: Fetch | null = null;
export function setPlaceSoundFetchForTests(f: Fetch | null): void {
  testFetch = f;
}
const doFetch: Fetch = (...a) => (testFetch ?? fetch)(...a);
/** Venice's audio calls are slow (a bed took about 9 minutes, and letting it go hung, 2026-10-29): none holds a request long. */
const CALL_MS = 30_000;
async function venice(key: string, path: string, body: unknown): Promise<Response> {
  if (path === "/audio/queue") logRequest(`${VENICE}${path}`, body);
  return doFetch(`${VENICE}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CALL_MS),
  });
}

/** The place a stage shows, as a sound's key and words: a library venue by its id, anywhere else by its words. */
export function soundPlace(venue: string | null | undefined): { key: string; label: string } | null {
  if (!venue) return null;
  const words = placeLabel(venue);
  if (words) {
    const key = normalizeScene(words);
    return key ? { key: `place:${key}`, label: words } : null;
  }
  const name = venueName(venue);
  return name ? { key: `venue:${venue}`, label: name } : null;
}

/** What's asked for: the place itself, heard from inside it, and nobody in it. */
export const soundPrompt = (label: string): string =>
  `The ambient sound of ${label}, heard from inside: its quiet, continuous atmosphere, room tone and soft distant sounds of the place. ` +
  `Calm and even, nothing sudden. Any music is soft, distant and without vocals. No voices, no speech, no talking, no people.`;

export type PlaceSound = { status: "ready"; id: string } | { status: "making" } | { status: "off" | "failed" | "none"; reason?: string };

type Row = { id: string; status: "making" | "ready" | "failed"; model: string | null; queue_id: string | null; created_at: Date | string; updated_at: Date | string };

/**
 * The place's sound: ready (its id), being made (collected here if it's done), or started now when there's none, it's
 * on, and today's new ones aren't used up.
 */
export async function placeSound(db: Db, venue: string | null | undefined): Promise<PlaceSound> {
  const place = soundPlace(venue);
  if (!place) return { status: "none" };
  const settings = await getAdultSettings(db);
  if (!settings.place_sounds) return { status: "off" };
  const keys = await adultKeys(db);
  const row = (await db.query<Row>(`select id, status, model, queue_id, created_at, updated_at from place_sounds where key = $1`, [place.key])).rows[0];
  if (row?.status === "ready") return { status: "ready", id: row.id };
  if (!keys.venice) return { status: "off", reason: "no Venice key" };
  if (row?.status === "making") return collect(db, keys.venice, row);
  if (row?.status === "failed" && Date.now() - new Date(row.updated_at).getTime() < RETRY_AFTER_MS) return { status: "failed" };
  // Nothing yet (or failed long enough ago): started, unless the words won't do or today's are used up.
  if (!checkShowText({ place: place.label }).ok) return { status: "none", reason: "the place's words" };
  const today = (await db.query<{ n: number }>(`select count(*)::int as n from place_sounds where created_at > now() - interval '1 day'`)).rows[0]?.n ?? 0;
  if (today >= DAILY_NEW) return { status: "none", reason: "today's new places are used up" };
  const id = crypto.randomUUID();
  const model = settings.place_sound_model;
  // Claimed before it's queued, so two theaters at the same place start it once.
  const claimed = await db.query(
    `insert into place_sounds (id, key, label, status, model) values ($1, $2, $3, 'making', $4)
     on conflict (key) do update set id = excluded.id, status = 'making', model = excluded.model, queue_id = null, error = null, created_at = now(), updated_at = now()
       where place_sounds.status = 'failed'
     returning id`,
    [id, place.key, place.label.slice(0, 200), model],
  );
  if (!claimed.rows.length) return { status: "making" };
  try {
    const res = await venice(keys.venice, "/audio/queue", { model, prompt: soundPrompt(place.label).slice(0, 450), duration_seconds: SECONDS, loop: true });
    if (!res.ok) throw await providerError(res, (status, text) => `Venice ${status}: ${text.slice(0, 160)}`);
    const q = (await res.json()) as { queue_id?: string };
    if (!q.queue_id) throw new Error("Venice returned no queue id");
    await db.query(`update place_sounds set queue_id = $2, updated_at = now() where id = $1`, [id, q.queue_id]);
    return { status: "making" };
  } catch (err) {
    const why = err instanceof Error ? err.message.slice(0, 200) : "error";
    await db.query(`update place_sounds set status = 'failed', error = $2, updated_at = now() where id = $1`, [id, why]);
    return { status: "failed", reason: why };
  }
}

/** A sound being made: kept if Venice has it, given up if it's been too long, else still making. */
async function collect(db: Db, key: string, row: Row): Promise<PlaceSound> {
  const fail = async (why: string): Promise<PlaceSound> => {
    await db.query(`update place_sounds set status = 'failed', error = $2, updated_at = now() where id = $1 and status = 'making'`, [row.id, why.slice(0, 200)]);
    return { status: "failed", reason: why };
  };
  if (Date.now() - new Date(row.created_at).getTime() > GIVE_UP_MS) return fail("gave up waiting");
  if (!row.queue_id || !row.model) return { status: "making" };
  const res = await venice(key, "/audio/retrieve", { model: row.model, queue_id: row.queue_id }).catch(() => null);
  // No answer in time: still making, asked again next time.
  if (!res) return { status: "making" };
  if (!res.ok) return fail(`Venice ${res.status}`);
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!type.startsWith("audio/")) {
    const body = (await res.json().catch(() => ({}))) as { status?: string };
    return body.status && !/PROCESSING|QUEUED|PENDING/i.test(body.status) ? fail(`Venice said ${body.status}`) : { status: "making" };
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) return fail("Venice returned no usable audio");
  const kept = await keepBytes("after-dark", row.id, bytes, type);
  const done = await db.query(
    `update place_sounds set status = 'ready', mime = $2, data = $3, object_key = $4, error = null, updated_at = now() where id = $1 and status = 'making' returning id`,
    [row.id, type, kept.data, kept.object_key],
  );
  // Venice's copy let go, without waiting on it.
  void venice(key, "/audio/retrieve", { model: row.model, queue_id: row.queue_id, delete_media_on_completion: true }).catch(() => {});
  return done.rows.length ? { status: "ready", id: row.id } : { status: "making" };
}

/** A ready sound's stored copy, for its route. */
export async function placeSoundFile(db: Db, id: string): Promise<{ mime: string; object_key: string | null; data: Buffer | null } | null> {
  const r = (await db.query<{ mime: string | null; object_key: string | null; data: Buffer | null }>(`select mime, object_key, data from place_sounds where id = $1 and status = 'ready'`, [id])).rows[0];
  return r?.mime ? { mime: r.mime, object_key: r.object_key, data: r.data } : null;
}
export const placeSoundBytes = (f: { object_key: string | null; data: Buffer | null }) => readBytes(f);
