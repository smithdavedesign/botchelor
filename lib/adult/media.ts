/**
 * After dark's pictures and clips, on fal.ai (lib/adult/settings.ts). David's design (2026-10-18):
 *  - one baseline picture per character, made the first time a scene turns explicit, and reused after;
 *  - a new picture only when, in the scene, one character asks for one and the other agrees;
 *  - a private gallery per character for later scenes; a clip is made from a picture on request.
 * Bytes are stored in adult_images and served only to an admin. Every prompt is held to the two lines (no minors, no
 * real people), says the people are adults, and is built from the characters' own sheets.
 */
import type { Character } from "../character";
import type { Db } from "../db";
import { checkAdultText } from "../safety";
import { adultKeys, getAdultSettings } from "./settings";

export type Media = { id: string; character_id: string | null; character_b: string | null; kind: "baseline" | "scene" | "video"; status: string; created_at: string; mime: string };

/** fal's REST endpoints: run (wait for the result) and queue (submit, then poll), by model id. */
const FAL_RUN = "https://fal.run";
const FAL_QUEUE = "https://queue.fal.run";
const MAX_BYTES = 40 * 1024 * 1024;

type Fetch = typeof fetch;
let testFetch: Fetch | null = null;
export function setMediaFetchForTests(f: Fetch | null): void {
  testFetch = f;
}
const doFetch: Fetch = (...a) => (testFetch ?? fetch)(...a);

const who = (c: Character) => {
  const p = c.pronouns?.startsWith("she") ? "woman" : c.pronouns?.startsWith("he") ? "man" : "person";
  return `${c.name}, an adult ${p} aged ${Math.max(18, c.age)}${c.look.appearance ? `: ${c.look.appearance}` : ""}`;
};

/** The first explicit picture of a character, from their own sheet. */
export function baselinePrompt(c: Character): string {
  return `Explicit, uncensored adult photograph of ${who(c)}. Nude, alone, intimate, photorealistic, natural light. Everyone shown is an adult.`;
}

/** A picture the scene asked for, of one or both of them. */
export function scenePrompt(a: Character, b: Character, of: "a" | "b" | "both", description: string): string {
  const people = of === "a" ? who(a) : of === "b" ? who(b) : `${who(a)}, and ${who(b)}`;
  return `Explicit, uncensored adult photograph of ${people}. ${description}. Photorealistic. Everyone shown is an adult.`;
}

async function falKey(db: Db): Promise<string> {
  const { fal } = await adultKeys(db);
  if (!fal) throw new Error("No fal.ai key saved in after dark's settings.");
  return fal;
}

async function download(url: string): Promise<{ bytes: Buffer; mime: string }> {
  const res = await doFetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error("file too large");
  return { bytes, mime: res.headers.get("content-type") ?? "application/octet-stream" };
}

/** Makes one picture on fal and stores it. Refuses a prompt that crosses a line. */
export async function makePicture(
  db: Db,
  ownerId: string,
  opts: { prompt: string; kind: "baseline" | "scene"; character_id: string; character_b?: string | null },
): Promise<Media> {
  const check = checkAdultText({ prompt: opts.prompt });
  if (!check.ok) throw new Error(`That picture crosses one of the two lines (${check.reason}).`);
  const key = await falKey(db);
  const { image_model } = await getAdultSettings(db);
  const res = await doFetch(`${FAL_RUN}/${image_model}`, {
    method: "POST",
    headers: { authorization: `Key ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ prompt: opts.prompt, image_size: "portrait_4_3", num_images: 1, enable_safety_checker: false }),
  });
  if (!res.ok) throw new Error(`fal.ai refused the picture (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { images?: { url?: string }[] };
  const url = body.images?.[0]?.url;
  if (!url) throw new Error("fal.ai returned no picture.");
  const file = await download(url);
  const id = crypto.randomUUID();
  await db.query(
    `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, remote_url) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, ownerId, opts.character_id, opts.character_b ?? null, opts.kind, opts.prompt, file.mime, file.bytes, url],
  );
  return { id, character_id: opts.character_id, character_b: opts.character_b ?? null, kind: opts.kind, status: "ready", created_at: new Date().toISOString(), mime: file.mime };
}

/** The character's baseline, making it the first time it's needed. */
export async function ensureBaseline(db: Db, ownerId: string, c: Character): Promise<Media | null> {
  const have = (await db.query<{ id: string }>(`select id from adult_images where character_id = $1 and kind = 'baseline' and status = 'ready' limit 1`, [c.id])).rows[0];
  if (have) return null;
  return makePicture(db, ownerId, { prompt: baselinePrompt(c), kind: "baseline", character_id: c.id });
}

/** Starts a clip from one of the gallery's pictures (fal's queue: it takes a minute or more). */
export async function startClip(db: Db, ownerId: string, imageId: string, motion: string): Promise<Media> {
  const pic = (await db.query<{ remote_url: string | null; character_id: string | null; character_b: string | null; prompt: string }>(
    `select remote_url, character_id, character_b, prompt from adult_images where id = $1 and kind <> 'video' and status = 'ready'`,
    [imageId],
  )).rows[0];
  if (!pic?.remote_url) throw new Error("No picture with that id.");
  const prompt = `${motion.trim() || "Slow, natural movement"}. Everyone shown is an adult.`;
  const check = checkAdultText({ prompt });
  if (!check.ok) throw new Error(`That clip crosses one of the two lines (${check.reason}).`);
  const key = await falKey(db);
  const { video_model } = await getAdultSettings(db);
  const res = await doFetch(`${FAL_QUEUE}/${video_model}`, {
    method: "POST",
    headers: { authorization: `Key ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ prompt, image_url: pic.remote_url, enable_safety_checker: false }),
  });
  if (!res.ok) throw new Error(`fal.ai refused the clip (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const { request_id } = (await res.json()) as { request_id?: string };
  if (!request_id) throw new Error("fal.ai returned no request id.");
  const id = crypto.randomUUID();
  await db.query(
    `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, status, request_id, source_image)
     values ($1, $2, $3, $4, 'video', $5, 'video/mp4', 'pending', $6, $7)`,
    [id, ownerId, pic.character_id, pic.character_b, prompt, request_id, imageId],
  );
  return { id, character_id: pic.character_id, character_b: pic.character_b, kind: "video", status: "pending", created_at: new Date().toISOString(), mime: "video/mp4" };
}

/** Checks a pending clip once; stores it when fal has finished. */
export async function pollClip(db: Db, id: string): Promise<string> {
  const row = (await db.query<{ status: string; request_id: string | null }>(`select status, request_id from adult_images where id = $1 and kind = 'video'`, [id])).rows[0];
  if (!row || row.status !== "pending" || !row.request_id) return row?.status ?? "missing";
  const key = await falKey(db);
  const { video_model } = await getAdultSettings(db);
  // fal's queue URLs use the model's app id (its first two path parts).
  const app = video_model.split("/").slice(0, 2).join("/");
  const status = await doFetch(`${FAL_QUEUE}/${app}/requests/${row.request_id}/status`, { headers: { authorization: `Key ${key}` } });
  const s = (await status.json().catch(() => ({}))) as { status?: string };
  if (s.status !== "COMPLETED") return "pending";
  const done = await doFetch(`${FAL_QUEUE}/${app}/requests/${row.request_id}`, { headers: { authorization: `Key ${key}` } });
  const body = (await done.json().catch(() => ({}))) as { video?: { url?: string } };
  if (!body.video?.url) {
    await db.query(`update adult_images set status = 'failed' where id = $1`, [id]);
    return "failed";
  }
  const file = await download(body.video.url);
  await db.query(`update adult_images set status = 'ready', data = $2, mime = $3, remote_url = $4 where id = $1`, [id, file.bytes, file.mime, body.video.url]);
  return "ready";
}

/** The gallery: a character's pictures and clips (both of a pair's, when given two), newest first. */
export async function listMedia(db: Db, ids: string[]): Promise<Media[]> {
  const { rows } = await db.query<Media>(
    `select id, character_id, character_b, kind, status, created_at, mime from adult_images
      where character_id = any($1) or character_b = any($1)
      order by created_at desc limit 60`,
    [ids],
  );
  return rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString() }));
}

export async function mediaBytes(db: Db, id: string): Promise<{ data: Buffer; mime: string } | null> {
  const r = (await db.query<{ data: Buffer | Uint8Array | null; mime: string }>(`select data, mime from adult_images where id = $1 and status = 'ready'`, [id])).rows[0];
  return r?.data ? { data: Buffer.from(r.data), mime: r.mime } : null;
}
