/**
 * After dark's pictures and clips, on fal.ai (lib/adult/settings.ts). David's design (2026-10-18):
 *  - one baseline picture per character, made the first time a scene turns explicit, and reused after;
 *  - a new picture only when, in the scene, one character asks for one and the other agrees;
 *  - a private gallery per character for later scenes; a clip is made from a picture on request.
 * Bytes are stored in adult_images and served only to an admin. Every prompt is held to the two lines (no minors, no
 * real people), says the people are adults, and is built from the characters' own sheets.
 *
 * What a picture knows (David, 2026-10-19: "do all three"): the character's physical look, compacted and put first;
 * where the scene is, how far it's gone and what they just did; and, for a picture of one of them, their baseline as
 * a face reference, so the same face comes back in every picture.
 */
import type { Character } from "../character";
import type { Db } from "../db";
import { ALL_HOUSE_CHARACTERS } from "../house";
import { checkAdultText } from "../safety";
import { checkOutput } from "./check";
import { countUse, overCap } from "./usage";
import { adultKeys, getAdultSettings } from "./settings";

/** `clip`: the picture can be made to move (it's on fal; Venice's explicit pictures can't be). */
export type Media = { id: string; character_id: string | null; character_b: string | null; kind: "baseline" | "scene" | "video"; status: string; created_at: string; mime: string; clip?: boolean };

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

/** A picture on Venice: its bytes come back in the reply (no URL), unblurred with safe_mode off. */
async function venicePicture(db: Db, prompt: string): Promise<{ bytes: Buffer; mime: string }> {
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
      safe_mode: false,
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
  const house = ALL_HOUSE_CHARACTERS.find((h) => h.id === c.id)?.look;
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

const person = (c: Character, undressed: boolean) => {
  const p = c.pronouns?.startsWith("she") ? "woman" : c.pronouns?.startsWith("he") ? "man" : "person";
  const look = physicalLook(c, undressed);
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
 * face reference for every later picture of them, and a face-detection model needs to find it.
 */
export function baselinePrompt(c: Character): string {
  return `Explicit, uncensored adult photograph, ${person(c, true)}. Nude, alone, waist-up, facing the camera, face clearly visible, natural light, photorealistic. Everyone shown is an adult.`;
}

/** A picture the scene asked for, of one or both of them: what it shows first, then who, then where and what just happened. */
export function scenePrompt(a: Character, b: Character, of: "a" | "b" | "both", description: string, ctx?: PictureContext): string {
  const undressed = !ctx || ctx.explicit === true || ctx.stage >= UNDRESSED_FROM;
  const people = of === "a" ? person(a, undressed) : of === "b" ? person(b, undressed) : `${person(a, undressed)} and ${person(b, undressed)}`;
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

/** Whether the picture provider chosen in settings has its key saved. */
export async function pictureKeyReady(db: Db): Promise<boolean> {
  const [k, s] = await Promise.all([adultKeys(db).catch(() => null), getAdultSettings(db)]);
  return Boolean(s.image_provider === "venice" ? k?.venice : k?.fal);
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
    await db.query<{ data: Buffer | Uint8Array | null; mime: string }>(
      `select data, mime from adult_images where character_id = $1 and kind = 'baseline' and status = 'ready' order by created_at limit 1`,
      [characterId],
    )
  ).rows[0];
  return r?.data ? `data:${r.mime};base64,${Buffer.from(r.data).toString("base64")}` : null;
}

/** Makes one picture on fal and stores it. Refuses a prompt that crosses a line. */
export async function makePicture(
  db: Db,
  ownerId: string,
  opts: { prompt: string; kind: "baseline" | "scene"; character_id: string; character_b?: string | null; face_of?: string | null },
): Promise<Media> {
  if (!(await outputCheckReady(db))) throw new Error(PICTURES_OFF_NOTE);
  const capped = await overCap(db, ownerId, "pictures");
  if (capped) throw new Error(capped);
  const check = checkAdultText({ prompt: opts.prompt });
  if (!check.ok) throw new Error(`That picture crosses one of the two lines (${check.reason}).`);
  const { image_model, image_base, image_provider } = await getAdultSettings(db);
  if (image_provider === "venice") {
    const file = await venicePicture(db, opts.prompt);
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
  opts: { prompt: string; kind: "baseline" | "scene"; character_id: string; character_b?: string | null },
  file: { bytes: Buffer; mime: string },
  url: string | null,
): Promise<Media> {
  await countUse(db, ownerId, "pictures");
  const id = crypto.randomUUID();
  await db.query(
    `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, remote_url) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, ownerId, opts.character_id, opts.character_b ?? null, opts.kind, opts.prompt, file.mime, file.bytes, url],
  );
  return { id, character_id: opts.character_id, character_b: opts.character_b ?? null, kind: opts.kind, status: "ready", created_at: new Date().toISOString(), mime: file.mime, clip: url !== null };
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
  if (!(await outputCheckReady(db))) throw new Error(PICTURES_OFF_NOTE);
  if (!pic) throw new Error("No picture with that id.");
  if (!pic.remote_url) throw new Error("Clips run on fal.ai, which doesn't allow explicit pictures, and this one was made on Venice.");
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

/** Checks a pending clip once; stores it when fal has finished. */
export async function pollClip(db: Db, id: string): Promise<string> {
  const row = (await db.query<{ status: string; request_id: string | null; owner_id: string }>(`select status, request_id, owner_id from adult_images where id = $1 and kind = 'video'`, [id])).rows[0];
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
  await db.query(`update adult_images set status = 'ready', data = $2, mime = $3, remote_url = $4 where id = $1`, [id, file.bytes, file.mime, body.video.url]);
  return "ready";
}

/** The gallery: a character's pictures and clips (both of a pair's, when given two), newest first. */
export async function listMedia(db: Db, ids: string[]): Promise<Media[]> {
  const { rows } = await db.query<Media>(
    `select id, character_id, character_b, kind, status, created_at, mime, (kind <> 'video' and remote_url is not null) as clip from adult_images
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
