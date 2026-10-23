/**
 * After dark's pictures and clips, on fal.ai (lib/adult/settings.ts). David's design (2026-10-18):
 *  - one baseline picture per character, made the first time a scene turns explicit, and reused after;
 *  - a new picture only when, in the scene, one character asks for one and the other agrees;
 *  - a private gallery per character for later scenes; a clip is made from a picture on request.
 * Bytes are stored in the private bucket (lib/object-store.ts; adult_images.data before it, and still when it isn't
 * configured) and served only to an admin. Every prompt is held to the two lines (no minors, no
 * real people), says the people are adults, and is built from the characters' own sheets.
 *
 * What a picture knows (David, 2026-10-19: "do all three"): the character's physical look, compacted and put first;
 * where the scene is, how far it's gone and what they just did; and, for a picture of one of them, their baseline as
 * a face reference, so the same face comes back in every picture.
 *
 * Explicit pictures are made on Venice, or on Replicate when it's After Dark's media provider (lib/adult/replicate.ts,
 * the backup; drawPicture). Either way the bytes pass the output check before they're stored.
 */
import type { Character } from "../character";
import type { Db } from "../db";
import { ALL_HOUSE_CHARACTERS } from "../house";
import { looksPictureWords } from "../looks";
import { createHmac, timingSafeEqual } from "node:crypto";
import { dataColumn, keepBytes, objectStore, readBytes } from "../object-store";
import { checkAdultText } from "../safety";
import { checkOutput } from "./check";
import { runModel } from "./replicate";
import { countUse, overCap } from "./usage";
import { adultKeys, getAdultSettings } from "./settings";

/** `clip`: the picture can be made to move (it's on fal; Venice's explicit pictures can't be). */
export type Media = {
  id: string; character_id: string | null; character_b: string | null; kind: "baseline" | "scene" | "video"; status: string; created_at: string; mime: string; clip?: boolean;
  /** A scene picture's chapter and place (lib/adult/auto-pictures.ts draws one per chapter and place); null otherwise. */
  chapter?: number | null;
  place?: string | null;
};
/** Where a scene picture was drawn: its chapter and place, for the gallery's caption. */
export type PictureScene = { scene_chapter?: number | null; scene_place?: string | null };

/**
 * Pictures and clips run only with the output check in place (lib/adult/check.ts; docs/after-dark.md #1): the Hive
 * key saved. Without it they stay off: fal's safety checker is off, so nothing else would catch a returned image
 * that shows a minor. Every file is checked before it's stored, and a failure is discarded, never stored.
 */
export async function outputCheckReady(db: Db): Promise<boolean> {
  const k = await adultKeys(db).catch(() => null);
  return Boolean(k?.hive);
}
export const PICTURES_OFF_NOTE =
  "Pictures and clips are off until the output check is set up (the Hive key in after dark's settings): every image is checked after it's made, not only our prompt.";

/** Logs a refusal (never the file), so the admin can see the check working. */
async function logRejection(db: Db, ownerId: string, kind: string, reason: string): Promise<void> {
  await db.query(`insert into adult_rejections (id, owner_id, kind, reason) values ($1, $2, $3, $4)`, [crypto.randomUUID(), ownerId, kind, reason.slice(0, 300)]).catch(() => {});
}

/** On every picture: away from anyone young-looking, and from cartoon styles the face-age check can't read. */
export const NEGATIVE_PROMPT = "child, children, kid, teen, teenager, minor, underage, young-looking, school uniform, cartoon, anime, illustration";

/** fal's REST endpoints: run (wait for the result) and queue (submit, then poll), by model id. */
const FAL_RUN = "https://fal.run";
const FAL_QUEUE = "https://queue.fal.run";
const MAX_BYTES = 40 * 1024 * 1024;
export const VENICE_IMAGE = "https://api.venice.ai/api/v1/image/generate";

/**
 * A picture on Venice: its bytes come back in the reply (no URL), unblurred with safe_mode off. `safe` turns Venice's
 * safe mode on, for the show's own (PG) portraits (lib/season-gen.ts).
 */
export async function venicePicture(db: Db, prompt: string, opts: { safe?: boolean } = {}): Promise<{ bytes: Buffer; mime: string }> {
  const { venice } = await adultKeys(db);
  if (!venice) throw new Error("No Venice key saved in after dark's settings.");
  const { venice_image_model } = await getAdultSettings(db);
  const res = await doFetch(VENICE_IMAGE, {
    method: "POST",
    headers: { authorization: `Bearer ${venice}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: venice_image_model,
      prompt,
      // Steer away from anyone young-looking, on top of the output check (never instead of it).
      negative_prompt: NEGATIVE_PROMPT,
      width: 832,
      height: 1104,
      format: "png",
      safe_mode: opts.safe === true,
      hide_watermark: true,
    }),
  });
  if (!res.ok) throw new Error(`Venice refused the picture (${res.status}): ${(await res.text()).slice(0, 200)}`);
  if (res.headers.get("x-venice-is-content-violation") === "true") throw new Error("Venice flagged the picture as against its terms.");
  const body = (await res.json()) as { images?: string[] };
  const b64 = body.images?.[0];
  if (!b64) throw new Error("Venice returned no picture.");
  const bytes = Buffer.from(b64, "base64");
  if (bytes.length > MAX_BYTES) throw new Error("file too large");
  return { bytes, mime: "image/png" };
}

/**
 * A picture's inputs on Replicate: its safety checker off (ours runs on what comes back, never instead of it), and
 * steered away from anyone young-looking. Qwen-Image takes an aspect ratio and a format; an SDXL-style model
 * (RealVisXL…) a width and height, Venice's 832×1104.
 */
export function replicatePictureInput(model: string, prompt: string): Record<string, unknown> {
  const common = { prompt, negative_prompt: NEGATIVE_PROMPT, disable_safety_checker: true };
  return /qwen-image/i.test(model) ? { ...common, aspect_ratio: "3:4", output_format: "png" } : { ...common, width: 832, height: 1104, num_outputs: 1 };
}

/** A picture on Replicate (lib/adult/replicate.ts): its bytes, downloaded at once (Replicate deletes them within the hour). */
export async function replicatePicture(db: Db, prompt: string): Promise<{ bytes: Buffer; mime: string }> {
  const { replicate } = await adultKeys(db);
  if (!replicate) throw new Error("No Replicate key saved in after dark's settings.");
  const { replicate_picture_model } = await getAdultSettings(db);
  const file = await runModel(replicate, replicate_picture_model, replicatePictureInput(replicate_picture_model, prompt), { maxBytes: MAX_BYTES });
  if (!file.mime.startsWith("image/")) throw new Error("Replicate returned no picture.");
  return file;
}

/** An explicit picture, from After Dark's media provider: Venice, or Replicate as the backup. */
export async function drawPicture(db: Db, prompt: string): Promise<{ bytes: Buffer; mime: string }> {
  const { media_provider } = await getAdultSettings(db);
  return media_provider === "replicate" ? replicatePicture(db, prompt) : venicePicture(db, prompt);
}

type Fetch = typeof fetch;
let testFetch: Fetch | null = null;
export function setMediaFetchForTests(f: Fetch | null): void {
  testFetch = f;
}
const doFetch: Fetch = (...a) => (testFetch ?? fetch)(...a);

/** A look's words past this are dropped: the face-reference model reads only the start of a prompt (~77 tokens). */
const LOOK_WORDS = 24;

/**
 * How a character looks, for a picture: a house character's `look` (lib/house.ts: written for the portrait generator,
 * physical where `appearance` is a vibe like "always mid-laugh"), else their sheet's appearance line. Never their name
 * (a name can pull a real person's face). Undressed, what they wear is left out ("in a patterned jacket").
 */
export function physicalLook(c: Character, undressed = false): string {
  const house = ALL_HOUSE_CHARACTERS.find((h) => h.id === c.id)?.look ?? c.look.physical;
  let look = (house || c.look.appearance || "").trim().replace(/[.\s]+$/, "");
  // "a man in his mid-thirties with…": the person() around it already says who; the age and colouring stay.
  look = look.replace(/^an?\s+((?:[\w-]+\s+)?)(?:man|woman|person)\b\s*/i, "$1").replace(/^,\s*/, "");
  // Clothes are "in a…", "wearing…"; never "in his mid-thirties".
  if (undressed) look = look.replace(/,?\s*\b(?:in an?|wearing|dressed in)\s+[^,]*/gi, "");
  // "laughing", "always mid-laugh": a mood, not a look, and a picture's expression comes from the scene.
  look = look.replace(/,\s*(?:laughing|smiling|grinning|always [^,]+)(?=,|$)/gi, "");
  // Whole phrases only, up to the word budget: "in an oversized" cut short is worse than nothing.
  const kept: string[] = [];
  let n = 0;
  for (const part of look.split(/,\s*/).filter(Boolean)) {
    const w = part.split(/\s+/).length;
    if (kept.length && n + w > LOOK_WORDS) break;
    kept.push(part);
    n += w;
  }
  return kept.join(", ");
}

/**
 * A character built in the looks builder (lib/looks.ts) is drawn from every pick, its outfit included until they
 * undress; the private After Dark picks only in a picture its owner (`viewer`) makes.
 */
const picks = (c: Character, viewer?: string | null) => looksPictureWords(c.extras?.looks, Boolean(viewer) && c.ownerId === viewer);

/** How a picture describes a character's look: their looks-builder picks when they have them, else physicalLook. */
export function lookWords(c: Character, undressed: boolean, viewer?: string | null): string {
  const picked = picks(c, viewer);
  return picked.body ? [picked.body, !undressed && picked.outfit ? `wearing ${picked.outfit}` : ""].filter(Boolean).join(", ") : physicalLook(c, undressed);
}

const person = (c: Character, undressed: boolean, viewer?: string | null) => {
  const p = c.pronouns?.startsWith("she") ? "woman" : c.pronouns?.startsWith("he") ? "man" : "person";
  const look = lookWords(c, undressed, viewer);
  return `a ${Math.max(18, c.age)}-year-old adult ${p}${look ? `, ${look}` : ""}`;
};

/**
 * Where a scene is when a picture is taken: the place, how far it's gone (lib/adult/stages.ts), whether the model
 * called these lines explicit, and what they just did.
 */
export type PictureContext = { place: string | null; stage: number; explicit?: boolean; recent: string[] };

/** The last few actions from a scene's lines ("*pulls her closer*"), the freshest last: what a picture should show. */
export function recentActions(lines: { text: string }[], n = 2): string[] {
  return lines
    .map((l) => l.text.match(/^\*([^*]+)\*/)?.[1]?.trim())
    .filter((x): x is string => Boolean(x))
    .slice(-n)
    .map((x) => x.split(/\s+/).slice(0, 12).join(" "));
}

/** From "undressing" (stage 4 of 5) on, what they wear is left out of their look. */
const UNDRESSED_FROM = 3;

/**
 * The first explicit picture of a character, from their own sheet. Facing the camera, face clear, waist up: it's the
 * face reference for every later picture of them, and a face-detection model needs to find it. In the outfit they
 * picked (a swimsuit stays a swimsuit), nude when they picked none or Nude.
 */
export function baselinePrompt(c: Character, viewer?: string | null): string {
  const { outfit } = picks(c, viewer);
  const [opener, worn] = outfit ? ["Uncensored adult photograph", `Wearing ${outfit}`] : ["Explicit, uncensored adult photograph", "Nude"];
  return `${opener}, ${person(c, true, viewer)}. ${worn}, alone, waist-up, facing the camera, face clearly visible, natural light, photorealistic. Everyone shown is an adult.`;
}

/** A picture the scene asked for, of one or both of them: what it shows first, then who, then where and what just happened. */
export function scenePrompt(a: Character, b: Character, of: "a" | "b" | "both", description: string, ctx?: PictureContext, viewer?: string | null): string {
  const undressed = !ctx || ctx.explicit === true || ctx.stage >= UNDRESSED_FROM;
  const who = (c: Character) => person(c, undressed, viewer);
  const people = of === "a" ? who(a) : of === "b" ? who(b) : `${who(a)} and ${who(b)}`;
  const opener = undressed ? "Explicit, uncensored adult photograph" : "Candid adult photograph";
  return [
    `${opener}: ${description.trim().replace(/\.$/, "")}.`,
    `${people[0].toUpperCase()}${people.slice(1)}.`,
    ctx?.place ? `Setting: ${ctx.place}.` : "",
    ctx?.recent.length ? `Just now: ${ctx.recent.join("; ")}.` : "",
    "Photorealistic. Everyone shown is an adult.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Whether the picture provider chosen in settings has its key saved (the explicit one: Venice, or Replicate). */
export async function pictureKeyReady(db: Db): Promise<boolean> {
  const [k, s] = await Promise.all([adultKeys(db).catch(() => null), getAdultSettings(db)]);
  return Boolean(s.image_provider === "venice" ? (s.media_provider === "replicate" ? k?.replicate : k?.venice) : k?.fal);
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

/**
 * fal's face-reference model: SDXL with IP-Adapter FaceID, on the same photoreal base, given one face to keep. It reads
 * a single face, so a picture of both of them goes without one.
 */
export const FACE_MODEL = "fal-ai/ip-adapter-face-id";

/** A character's baseline as a data URI, for the face-reference model (no public URL: the bytes are ours, private). */
async function baselineFace(db: Db, characterId: string): Promise<string | null> {
  const r = (
    await db.query<{ data: Buffer | Uint8Array | null; object_key: string | null; mime: string }>(
      `select ${dataColumn()}, object_key, mime from adult_images where character_id = $1 and kind = 'baseline' and status = 'ready' order by created_at limit 1`,
      [characterId],
    )
  ).rows[0];
  const bytes = r ? await readBytes(r) : null;
  return bytes ? `data:${r!.mime};base64,${bytes.toString("base64")}` : null;
}

/** Makes one picture on fal and stores it. Refuses a prompt that crosses a line. */
export async function makePicture(
  db: Db,
  ownerId: string,
  opts: { prompt: string; kind: "baseline" | "scene"; character_id: string; character_b?: string | null; face_of?: string | null } & PictureScene,
): Promise<Media> {
  if (!(await outputCheckReady(db))) throw new Error(PICTURES_OFF_NOTE);
  const capped = await overCap(db, ownerId, "pictures");
  if (capped) throw new Error(capped);
  const check = checkAdultText({ prompt: opts.prompt });
  if (!check.ok) throw new Error(`That picture crosses one of the two lines (${check.reason}).`);
  const { image_model, image_base, image_provider } = await getAdultSettings(db);
  if (image_provider === "venice") {
    const file = await drawPicture(db, opts.prompt);
    // The output check on the bytes themselves, before anything is stored: a failure is discarded.
    const verdict = await checkOutput((await adultKeys(db)).hive, { base64: file.bytes.toString("base64"), mime: file.mime }, "image");
    if (!verdict.ok) {
      await logRejection(db, ownerId, opts.kind, verdict.reason);
      throw new Error(`The picture was discarded by the output check (${verdict.reason}).`);
    }
    return storePicture(db, ownerId, opts, file, null);
  }
  const key = await falKey(db);
  const run = (model: string, input: Record<string, unknown>) =>
    doFetch(`${FAL_RUN}/${model}`, {
      method: "POST",
      headers: { authorization: `Key ${key}`, "content-type": "application/json" },
      // Steer away from anyone young-looking, on top of the output check (never instead of it).
      body: JSON.stringify({ prompt: opts.prompt, negative_prompt: NEGATIVE_PROMPT, enable_safety_checker: false, ...input }),
    });
  const face = opts.face_of ? await baselineFace(db, opts.face_of) : null;
  let res: Response | null = null;
  if (face) {
    res = await run(FACE_MODEL, { face_image_url: face, model_type: "SDXL-v2-plus", base_sdxl_model_repo: image_base, width: 768, height: 1024 });
    // No face found in the reference, or the model's down: the picture still comes, from the words alone.
    if (!res.ok && res.status !== 401 && res.status !== 403) res = null;
  }
  res ??= await run(image_model, {
    ...(image_model === "fal-ai/lora" ? { model_name: image_base, prompt_weighting: true } : {}),
    image_size: "portrait_4_3",
    num_images: 1,
  });
  if (!res.ok) throw new Error(`fal.ai refused the picture (${res.status}): ${(await res.text()).slice(0, 200)}`);
  // The face model returns one `image`; the others an `images` list.
  const body = (await res.json()) as { images?: { url?: string }[]; image?: { url?: string } };
  const url = body.images?.[0]?.url ?? body.image?.url;
  if (!url) throw new Error("fal.ai returned no picture.");
  // The output check, before anything is stored: a failure is discarded.
  const verdict = await checkOutput((await adultKeys(db)).hive, url, "image");
  if (!verdict.ok) {
    await logRejection(db, ownerId, opts.kind, verdict.reason);
    throw new Error(`The picture was discarded by the output check (${verdict.reason}).`);
  }
  return storePicture(db, ownerId, opts, await download(url), url);
}

/** Stores a picture that passed the output check, and counts it. */
async function storePicture(
  db: Db,
  ownerId: string,
  opts: { prompt: string; kind: "baseline" | "scene"; character_id: string; character_b?: string | null } & PictureScene,
  file: { bytes: Buffer; mime: string },
  url: string | null,
): Promise<Media> {
  await countUse(db, ownerId, "pictures");
  const id = crypto.randomUUID();
  const kept = await keepBytes("after-dark", id, file.bytes, file.mime);
  const chapter = opts.scene_chapter ?? null;
  const place = opts.scene_place?.slice(0, 120) ?? null;
  await db.query(
    `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, object_key, remote_url, scene_chapter, scene_place) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [id, ownerId, opts.character_id, opts.character_b ?? null, opts.kind, opts.prompt, file.mime, kept.data, kept.object_key, url, chapter, place],
  );
  return { id, character_id: opts.character_id, character_b: opts.character_b ?? null, kind: opts.kind, status: "ready", created_at: new Date().toISOString(), mime: file.mime, clip: url !== null, chapter, place };
}

/** The character's baseline, making it the first time it's needed. */
export async function ensureBaseline(db: Db, ownerId: string, c: Character): Promise<Media | null> {
  const have = (await db.query<{ id: string }>(`select id from adult_images where character_id = $1 and kind = 'baseline' and status = 'ready' limit 1`, [c.id])).rows[0];
  if (have) return null;
  return makePicture(db, ownerId, { prompt: baselinePrompt(c, ownerId), kind: "baseline", character_id: c.id });
}

/**
 * A picture or clip is its maker's (an admin's, as moderator, too): `$n` is the viewer. Every by-id lookup carries it, so
 * once after dark has subscribers one can't open, poll or animate another's by knowing its id.
 */
const viewableBy = (n: number) => `(owner_id = $${n} or exists (select 1 from admins a where a.user_id = $${n}))`;

/** Starts a clip from one of the gallery's pictures (fal's queue: it takes a minute or more). */
export async function startClip(db: Db, ownerId: string, imageId: string, motion: string): Promise<Media> {
  const pic = (await db.query<{ remote_url: string | null; character_id: string | null; character_b: string | null; prompt: string }>(
    `select remote_url, character_id, character_b, prompt from adult_images where id = $1 and kind not in ('video', 'audio') and status = 'ready' and ${viewableBy(2)}`,
    [imageId, ownerId],
  )).rows[0];
  if (!(await outputCheckReady(db))) throw new Error(PICTURES_OFF_NOTE);
  if (!pic) throw new Error("No picture with that id.");
  if (!pic.remote_url) throw new Error("Clips run on fal.ai, which doesn't allow explicit pictures, and this one was made on Venice or Replicate.");
  const capped = await overCap(db, ownerId, "clips");
  if (capped) throw new Error(capped);
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
  await countUse(db, ownerId, "clips");
  const id = crypto.randomUUID();
  await db.query(
    `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, status, request_id, source_image)
     values ($1, $2, $3, $4, 'video', $5, 'video/mp4', 'pending', $6, $7)`,
    [id, ownerId, pic.character_id, pic.character_b, prompt, request_id, imageId],
  );
  return { id, character_id: pic.character_id, character_b: pic.character_b, kind: "video", status: "pending", created_at: new Date().toISOString(), mime: "video/mp4" };
}

/** Checks one of the viewer's pending clips once; stores it when fal has finished. */
export async function pollClip(db: Db, id: string, viewerId: string): Promise<string> {
  const row = (
    await db.query<{ status: string; request_id: string | null; owner_id: string }>(
      `select status, request_id, owner_id from adult_images where id = $1 and kind = 'video' and ${viewableBy(2)}`,
      [id, viewerId],
    )
  ).rows[0];
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
  // The output check on the clip itself, before it's stored: a failure is discarded.
  const verdict = await checkOutput((await adultKeys(db)).hive, body.video.url, "video");
  if (!verdict.ok) {
    await logRejection(db, row.owner_id, "video", verdict.reason);
    await db.query(`update adult_images set status = 'failed' where id = $1`, [id]);
    return "failed";
  }
  const file = await download(body.video.url);
  const kept = await keepBytes("after-dark", id, file.bytes, file.mime);
  await db.query(`update adult_images set status = 'ready', data = $2, object_key = $3, mime = $4, remote_url = $5 where id = $1`, [id, kept.data, kept.object_key, file.mime, body.video.url]);
  return "ready";
}

/** The gallery: a character's pictures and clips (both of a pair's, when given two), newest first. */
export async function listMedia(db: Db, ids: string[]): Promise<Media[]> {
  // Theirs alone, or of these characters together: never a picture or video with someone else in it (a character's
  // night with another partner stays on that pair's page). A reel's keyframes and voices stay with its shots.
  const { rows } = await db.query<Media>(
    `select id, character_id, character_b, kind, status, created_at, mime, (kind <> 'video' and remote_url is not null) as clip, scene_chapter as chapter, scene_place as place from adult_images
      where character_id = any($1) and (character_b is null or character_b = any($1)) and kind not in ('frame', 'audio')
      order by created_at desc limit 60`,
    [ids],
  );
  return rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString() }));
}

/**
 * A link to one picture that works without a session for a few minutes, for a provider to fetch as a video's start
 * frame (lib/adult/reels.ts). HMAC over the id and the expiry with SESSION_SECRET; pictures only, never clips.
 */
export const MEDIA_LINK_MS = 30 * 60 * 1000;
const mediaMac = (id: string, until: number, secret: string) => createHmac("sha256", secret).update(`after-dark-media:${id}:${until}`).digest("base64url");
export function signedMediaUrl(id: string, baseUrl: string, now = Date.now(), env: Record<string, string | undefined> = process.env): string {
  const secret = env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  const until = now + MEDIA_LINK_MS;
  return `${baseUrl.replace(/\/$/, "")}/api/admin/after-dark/media/${encodeURIComponent(id)}?until=${until}&sig=${mediaMac(id, until, secret)}`;
}
export function mediaLinkValid(id: string, until: string | null, sig: string | null, now = Date.now(), env: Record<string, string | undefined> = process.env): boolean {
  const secret = env.SESSION_SECRET;
  const t = Number(until);
  if (!secret || !sig || !Number.isFinite(t) || t < now || t > now + MEDIA_LINK_MS) return false;
  const want = Buffer.from(mediaMac(id, t, secret));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

/**
 * A ready file, to its viewer: theirs or, for an admin, anyone's (viewableBy). Null only for a signed link, which names
 * the one picture itself.
 */
const readyFor = (id: string, viewerId: string | null): { where: string; params: string[] } =>
  viewerId === null
    ? { where: `id = $1 and status = 'ready'`, params: [id] }
    : { where: `id = $1 and status = 'ready' and ${viewableBy(2)}`, params: [id, viewerId] };

/** Where a ready file is: its bucket key (when it's been moved there), and its mime. Null when there's no such file. */
export async function mediaRef(db: Db, id: string, viewerId: string | null): Promise<{ mime: string; key: string | null } | null> {
  const { where, params } = readyFor(id, viewerId);
  const r = (
    await db.query<{ mime: string; object_key: string | null; has_data: boolean }>(
      `select mime, object_key, data is not null as has_data from adult_images where ${where}`,
      params,
    )
  ).rows[0];
  if (!r || (!r.object_key && !r.has_data)) return null;
  // A key with no bucket configured (the settings removed): the column, if it's still there, is all there is.
  return { mime: r.mime, key: r.object_key && objectStore() ? r.object_key : null };
}

/**
 * A short-lived link straight to a file in the bucket, so its bytes never pass through a function or Postgres; null
 * when the file isn't in the bucket. Only for someone the caller has already let in: the bucket is private, and the
 * link is the only way in.
 */
export async function mediaLink(key: string, now = Date.now()): Promise<{ url: string; maxAge: number } | null> {
  const store = objectStore();
  return store ? store.presign(key, now) : null;
}

export async function mediaBytes(db: Db, id: string, viewerId: string | null): Promise<{ data: Buffer; mime: string } | null> {
  const { where, params } = readyFor(id, viewerId);
  const r = (
    await db.query<{ data: Buffer | Uint8Array | null; object_key: string | null; mime: string }>(
      `select ${dataColumn()}, object_key, mime from adult_images where ${where}`,
      params,
    )
  ).rows[0];
  const data = r ? await readBytes(r) : null;
  return data ? { data, mime: r!.mime } : null;
}
