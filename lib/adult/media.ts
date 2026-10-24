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
import { checkMedia, checkReady, mediaGate } from "./moderation";
import { fallbackNote, providerError, runMedia, type Ran } from "./fallback";
import { hivePausedMessage, HivePausedError, hivePausedUntil } from "./hive-limit";
import { attireOf, nudeSql } from "./attire";
import { PICTURE_PRESETS, type PresetId } from "./rating-tags";
import { runModel } from "./replicate";
import { choosePreset, faceReferenceId, NO_STEERING, steeringFor, withSteering } from "./steering";
import { countUse, overCap } from "./usage";
import { adultKeys, getAdultSettings } from "./settings";

/** `clip`: the picture can be made to move (it's on fal; Venice's explicit pictures can't be). */
export type Media = {
  id: string; character_id: string | null; character_b: string | null; kind: "baseline" | "scene" | "video"; status: string; created_at: string; mime: string; clip?: boolean;
  /** A scene picture's chapter and place (lib/adult/auto-pictures.ts draws one per chapter and place); null otherwise. */
  chapter?: number | null;
  place?: string | null;
  /** Who made it ('venice', 'replicate', 'fal'; null before 2026-10-22), and whether that was the fallback provider. */
  provider?: string | null;
  fell_back?: boolean;
  /** "made on Replicate (fallback)" when it was, for the gallery; null otherwise. */
  note?: string | null;
  /** The light and lens it was drawn with (lib/adult/rating-tags.ts PICTURE_PRESETS); null before 2026-10-24. */
  preset?: string | null;
  /** For the gallery's viewer: their 👍 (1) or 👎 (-1) and what was off (lib/adult/steering.ts), and whether it's the face they picked. */
  rating?: 1 | -1 | null;
  tags?: string[];
  face?: boolean;
  /** A baseline drawn nude (lib/adult/attire.ts): the gallery says "undressed". */
  nude?: boolean;
};
/** Where a scene picture was drawn: its chapter and place, for the gallery's caption. */
export type PictureScene = { scene_chapter?: number | null; scene_place?: string | null };

/**
 * Pictures and clips run only with the output check in place (lib/adult/check.ts; docs/after-dark.md #1): the Hive
 * key saved. Without it they stay off: fal's safety checker is off, so nothing else would catch a returned image
 * that shows a minor. Every file is checked before it's stored, and a failure is discarded, never stored.
 */
export async function outputCheckReady(db: Db): Promise<boolean> {
  // Hive's key, or an alternative checker the mode uses (lib/adult/moderation.ts).
  return checkReady(db).catch(() => false);
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
export async function venicePicture(db: Db, prompt: string, opts: { safe?: boolean; negative?: string; model?: string; key?: string } = {}): Promise<{ bytes: Buffer; mime: string }> {
  // The Studio passes its picked model, and an owner's own key (lib/adult/studio.ts); otherwise the settings' own.
  const venice = opts.key ?? (await adultKeys(db)).venice;
  if (!venice) throw new Error("No Venice key saved in after dark's settings.");
  const venice_image_model = opts.model ?? (await getAdultSettings(db)).venice_image_model;
  const res = await doFetch(VENICE_IMAGE, {
    method: "POST",
    headers: { authorization: `Bearer ${venice}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: venice_image_model,
      prompt,
      // Steer away from anyone young-looking, on top of the output check (never instead of it), and from what the
      // viewer's ratings said was off (lib/adult/steering.ts).
      negative_prompt: opts.negative ?? NEGATIVE_PROMPT,
      width: 832,
      height: 1104,
      format: "png",
      safe_mode: opts.safe === true,
      hide_watermark: true,
    }),
  });
  if (!res.ok) throw await providerError(res, (status, text) => `Venice refused the picture (${status}): ${text.slice(0, 200)}`);
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
export function replicatePictureInput(model: string, prompt: string, negative: string = NEGATIVE_PROMPT): Record<string, unknown> {
  const common = { prompt, negative_prompt: negative, disable_safety_checker: true };
  return /qwen-image/i.test(model) ? { ...common, aspect_ratio: "3:4", output_format: "png" } : { ...common, width: 832, height: 1104, num_outputs: 1 };
}

/** A picture on Replicate (lib/adult/replicate.ts): its bytes, downloaded at once (Replicate deletes them within the hour). */
export async function replicatePicture(db: Db, prompt: string, negative?: string): Promise<{ bytes: Buffer; mime: string }> {
  const { replicate } = await adultKeys(db);
  if (!replicate) throw new Error("No Replicate key saved in after dark's settings.");
  const { replicate_picture_model } = await getAdultSettings(db);
  const file = await runModel(replicate, replicate_picture_model, replicatePictureInput(replicate_picture_model, prompt, negative), { maxBytes: MAX_BYTES });
  if (!file.mime.startsWith("image/")) throw new Error("Replicate returned no picture.");
  return file;
}

/**
 * An explicit picture, from After Dark's media provider: Venice, or Replicate as the backup; the other one when the
 * configured one is limited (lib/adult/fallback.ts). Says who made it.
 */
export async function drawPicture(db: Db, prompt: string, negative?: string): Promise<Ran<{ bytes: Buffer; mime: string }>> {
  return runMedia(db, "picture", (p) => (p === "replicate" ? replicatePicture(db, prompt, negative) : venicePicture(db, prompt, { negative })));
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

/**
 * How a picture describes a character's look: their looks-builder picks when they have them, else physicalLook.
 * Undressed, what shows only then (the private grooming pick), except in a waist-up picture (the baseline, or the words
 * a keyframe tells two of them apart by), which never names what's below its frame.
 */
export function lookWords(c: Character, undressed: boolean, viewer?: string | null, waistUp = false): string {
  const picked = picks(c, viewer);
  if (!picked.body) return physicalLook(c, undressed);
  return [picked.body, !undressed && picked.outfit ? `wearing ${picked.outfit}` : "", undressed && !waistUp ? picked.undressed : ""].filter(Boolean).join(", ");
}

const person = (c: Character, undressed: boolean, viewer?: string | null, waistUp = false) => {
  const p = c.pronouns?.startsWith("she") ? "woman" : c.pronouns?.startsWith("he") ? "man" : "person";
  const look = lookWords(c, undressed, viewer, waistUp);
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
export function baselinePrompt(c: Character, viewer?: string | null, light = "natural light", opts: { nude?: boolean } = {}): string {
  // `nude`: the nude baseline a character who wears something has too, for undressed moments (lib/adult/attire.ts).
  const outfit = opts.nude ? null : picks(c, viewer).outfit;
  const [opener, worn] = outfit ? ["Uncensored adult photograph", `Wearing ${outfit}`] : ["Explicit, uncensored adult photograph", "Nude"];
  // The framing never changes (waist-up, facing the camera, the face clear): it's the face every later picture keeps.
  // Only the light does (lib/adult/rating-tags.ts PICTURE_PRESETS: "draw three to pick from").
  return `${opener}, ${person(c, true, viewer, true)}. ${worn}, alone, waist-up, facing the camera, face clearly visible, ${light}, photorealistic. Everyone shown is an adult.`;
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

/**
 * The face this viewer keeps for a character (lib/adult/steering.ts faceReferenceId), as a data URI for the
 * face-reference model (no public URL: the bytes are ours, private).
 */
async function baselineFace(db: Db, characterId: string, viewerId: string): Promise<string | null> {
  const id = await faceReferenceId(db, viewerId, characterId);
  if (!id) return null;
  const r = (
    await db.query<{ data: Buffer | Uint8Array | null; object_key: string | null; mime: string }>(
      `select ${dataColumn()}, object_key, mime from adult_images where id = $1 and status = 'ready'`,
      [id],
    )
  ).rows[0];
  const bytes = r ? await readBytes(r) : null;
  return bytes ? `data:${r!.mime};base64,${bytes.toString("base64")}` : null;
}

/** The output check refused a picture: logged, and thrown as what the page says (the pause's own message when Hive was out). */
async function discarded(db: Db, ownerId: string, kind: string, verdict: { reason: string; paused?: string }): Promise<never> {
  await logRejection(db, ownerId, kind, verdict.reason);
  if (verdict.paused) throw new HivePausedError(verdict.paused, hivePausedMessage(verdict.paused, { discarded: true }), true);
  throw new Error(`The picture was discarded by the output check (${verdict.reason}).`);
}

/**
 * Makes one picture and stores it. Refuses a prompt that crosses a line. What the viewer's ratings of these characters
 * said goes in (lib/adult/steering.ts): their fixes, and for a picture of one of them a preset (the light and lens the
 * per-character test picks; a baseline's is `opts.preset`, its light already in the prompt).
 */
export async function makePicture(
  db: Db,
  ownerId: string,
  opts: { prompt: string; kind: "baseline" | "scene"; character_id: string; character_b?: string | null; face_of?: string | null; preset?: PresetId | null } & PictureScene,
): Promise<Media> {
  if (!(await outputCheckReady(db))) throw new Error(PICTURES_OFF_NOTE);
  const capped = await overCap(db, ownerId, "pictures");
  if (capped) throw new Error(capped);
  const steer = await steeringFor(db, ownerId, [opts.character_id, opts.character_b]).catch(() => NO_STEERING);
  const preset =
    opts.kind === "baseline"
      ? (PICTURE_PRESETS.find((p) => p.id === opts.preset) ?? PICTURE_PRESETS[0])
      : opts.character_b
        ? null
        : await choosePreset(db, ownerId, opts.character_id).catch(() => null);
  opts = { ...opts, prompt: withSteering(opts.prompt, steer, opts.kind === "scene" ? (preset?.words ?? null) : null), preset: preset?.id ?? null };
  const negative = [NEGATIVE_PROMPT, ...steer.negative].join(", ");
  const check = checkAdultText({ prompt: opts.prompt });
  if (!check.ok) throw new Error(`That picture crosses one of the two lines (${check.reason}).`);
  // Hive over its daily limit (lib/adult/hive-limit.ts): nothing is drawn (or paid for) while no checker can run.
  const gate = await mediaGate(db);
  if (!gate.ok) {
    await logRejection(db, ownerId, opts.kind, gate.reason);
    throw new HivePausedError(gate.until, gate.message);
  }
  const { image_model, image_base, image_provider, venice_image_model, replicate_picture_model } = await getAdultSettings(db);
  if (image_provider === "venice") {
    const drawn = await drawPicture(db, opts.prompt, negative);
    const file = drawn.value;
    // The output check on the bytes themselves, before anything is stored, whoever made them: a failure is discarded.
    const verdict = await checkMedia(db, { base64: file.bytes.toString("base64"), mime: file.mime }, "image");
    if (!verdict.ok) return discarded(db, ownerId, opts.kind, verdict);
    const model = drawn.provider === "replicate" ? replicate_picture_model : venice_image_model;
    return storePicture(db, ownerId, opts, file, null, { provider: drawn.provider, fell_back: drawn.fell_back, model });
  }
  const key = await falKey(db);
  const run = (model: string, input: Record<string, unknown>) =>
    doFetch(`${FAL_RUN}/${model}`, {
      method: "POST",
      headers: { authorization: `Key ${key}`, "content-type": "application/json" },
      // Steer away from anyone young-looking, on top of the output check (never instead of it).
      body: JSON.stringify({ prompt: opts.prompt, negative_prompt: negative, enable_safety_checker: false, ...input }),
    });
  const face = opts.face_of ? await baselineFace(db, opts.face_of, ownerId) : null;
  let res: Response | null = null;
  let model = image_model;
  if (face) {
    model = FACE_MODEL;
    res = await run(FACE_MODEL, { face_image_url: face, model_type: "SDXL-v2-plus", base_sdxl_model_repo: image_base, width: 768, height: 1024 });
    // No face found in the reference, or the model's down: the picture still comes, from the words alone.
    if (!res.ok && res.status !== 401 && res.status !== 403) {
      res = null;
      model = image_model;
    }
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
  const verdict = await checkMedia(db, url, "image");
  if (!verdict.ok) return discarded(db, ownerId, opts.kind, verdict);
  return storePicture(db, ownerId, opts, await download(url), url, { provider: "fal", fell_back: false, model });
}

/** Stores a picture that passed the output check, and counts it. */
async function storePicture(
  db: Db,
  ownerId: string,
  opts: { prompt: string; kind: "baseline" | "scene"; character_id: string; character_b?: string | null; preset?: string | null } & PictureScene,
  file: { bytes: Buffer; mime: string },
  url: string | null,
  made: { provider: string; fell_back: boolean; model?: string | null },
): Promise<Media> {
  await countUse(db, ownerId, "pictures");
  const id = crypto.randomUUID();
  const kept = await keepBytes("after-dark", id, file.bytes, file.mime);
  const chapter = opts.scene_chapter ?? null;
  const place = opts.scene_place?.slice(0, 120) ?? null;
  const preset = opts.preset ?? null;
  const attire = attireOf(opts.kind, opts.prompt);
  await db.query(
    `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, object_key, remote_url, scene_chapter, scene_place, provider, fell_back, model, preset, attire) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
    [id, ownerId, opts.character_id, opts.character_b ?? null, opts.kind, opts.prompt, file.mime, kept.data, kept.object_key, url, chapter, place, made.provider, made.fell_back, made.model ?? null, preset, attire],
  );
  return {
    id, character_id: opts.character_id, character_b: opts.character_b ?? null, kind: opts.kind, status: "ready", created_at: new Date().toISOString(), mime: file.mime, clip: url !== null, chapter, place,
    provider: made.provider, fell_back: made.fell_back, note: fallbackNote(made.provider, made.fell_back), preset, rating: null, tags: [], face: false,
  };
}

/**
 * "Draw three to pick from" (David, 2026-10-24): a new baseline of the character in each of the presets' light, from
 * their look as it is now (picks changed since the first one are in). Each is checked like any picture; one that doesn't
 * come through is left out and said why. The viewer picks one as the face (lib/adult/steering.ts setFaceReference).
 */
export async function drawBaselineChoices(db: Db, ownerId: string, c: Character, opts: { nude?: boolean } = {}): Promise<{ pictures: Media[]; failed: string[] }> {
  const pictures: Media[] = [];
  const failed: string[] = [];
  for (const p of PICTURE_PRESETS) {
    try {
      pictures.push(await makePicture(db, ownerId, { prompt: baselinePrompt(c, ownerId, p.light, opts), kind: "baseline", character_id: c.id, preset: p.id }));
    } catch (e) {
      // Hive out for the day, or this month's pictures used up (lib/adult/usage.ts overCap): the rest would fail the same way.
      if (e instanceof HivePausedError) throw e;
      failed.push(e instanceof Error ? e.message : String(e));
      if (/this month's .* reset on the 1st/i.test(String((e as Error)?.message))) break;
    }
  }
  return { pictures, failed };
}

/** The character's baseline, making it the first time it's needed. */
export async function ensureBaseline(db: Db, ownerId: string, c: Character): Promise<Media | null> {
  const have = (await db.query<{ id: string }>(`select id from adult_images where character_id = $1 and kind = 'baseline' and status = 'ready' limit 1`, [c.id])).rows[0];
  if (have) return null;
  return makePicture(db, ownerId, { prompt: baselinePrompt(c, ownerId), kind: "baseline", character_id: c.id });
}

/**
 * The character's nude baseline, for undressed moments (lib/adult/attire.ts), made the first time it's needed: the same
 * look and framing as their baseline, without the outfit. A character who wears nothing has one already, their baseline.
 */
export async function ensureNudeBaseline(db: Db, ownerId: string, c: Character): Promise<Media | null> {
  const have = (
    await db.query<{ id: string }>(
      `select id from adult_images where character_id = $1 and character_b is null and kind = 'baseline' and status = 'ready' and ${nudeSql("adult_images")} limit 1`,
      [c.id],
    )
  ).rows[0];
  if (have) return null;
  return makePicture(db, ownerId, { prompt: baselinePrompt(c, ownerId, undefined, { nude: true }), kind: "baseline", character_id: c.id });
}

/**
 * A picture or clip is its maker's (an admin's, as moderator, too): `$n` is the viewer. Every by-id lookup carries it, so
 * once after dark has subscribers one can't open, poll or animate another's by knowing its id.
 */
export const viewableBy = (n: number) => `(owner_id = $${n} or exists (select 1 from admins a where a.user_id = $${n}))`;

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
  // A clip's frames pass Hive once it's made: none is started while Hive is over its daily limit (lib/adult/hive-limit.ts).
  const gate = await mediaGate(db, { video: true });
  if (!gate.ok) {
    await logRejection(db, ownerId, "video", gate.reason);
    throw new HivePausedError(gate.until, gate.message);
  }
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
  // Hive over its daily limit: the clip waits at fal, unchecked, until its check can run (lib/adult/hive-limit.ts).
  if (await hivePausedUntil(db)) return "pending";
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
  // The output check on the clip itself, before it's stored: a failure is discarded. Hive out of its daily allowance isn't
  // a verdict: the clip stays pending, unchecked and unstored, and is checked once the pause is over.
  const verdict = await checkMedia(db, body.video.url, "video");
  if (!verdict.ok && verdict.paused) return "pending";
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
export async function listMedia(db: Db, ids: string[], viewerId: string | null = null): Promise<Media[]> {
  // Theirs alone, or of these characters together: never a picture or video with someone else in it (a character's
  // night with another partner stays on that pair's page). A reel's keyframes and voices stay with its shots, and a shot
  // taken out of its video is in the Archive, not here (lib/adult/reels.ts archiveShot). With a viewer: only what they
  // can open (theirs; an admin's, everyone's: viewableBy), their rating of each, and which are the faces they picked
  // (lib/adult/steering.ts).
  const { rows } = await db.query<Media & { face_of: string | null }>(
    `select i.id, i.character_id, i.character_b, i.kind, i.status, i.created_at, i.mime, (i.kind <> 'video' and i.remote_url is not null) as clip,
            i.scene_chapter as chapter, i.scene_place as place, i.provider, coalesce(i.fell_back, false) as fell_back, i.preset,
            r.rating, coalesce(r.tags, '[]'::jsonb) as tags, coalesce(f.character_id, n.character_id) as face_of,
            (i.kind = 'baseline' and ${nudeSql("i")}) as nude
       from adult_images i
       left join adult_media_thumbs r on r.media_id = i.id and r.owner_id = $2
       left join adult_face_refs f on f.image_id = i.id and f.owner_id = $2
       left join adult_nude_refs n on n.image_id = i.id and n.owner_id = $2
      where i.character_id = any($1) and (i.character_b is null or i.character_b = any($1)) and i.kind not in ('frame', 'audio')
        and ($2::text is null or i.owner_id = $2 or exists (select 1 from admins a where a.user_id = $2))
        and (i.kind <> 'video' or not exists (
          select 1 from adult_reels v cross join lateral jsonb_array_elements(v.shots) s
           where v.owner_id = i.owner_id and s->>'media_id' = i.id and s ? 'archived_at'))
      order by i.created_at desc limit 60`,
    [ids, viewerId],
  );
  return rows.map(({ face_of, ...r }) => ({ ...r, rating: r.rating ?? null, created_at: new Date(r.created_at).toISOString(), note: fallbackNote(r.provider, r.fell_back), face: Boolean(face_of) }));
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
 * A video's keyframe (a 'frame') passed only Hive's age question (lib/adult/check.ts "keyframe"): its moderation is its
 * shot's, which samples the shot's frames, the first of them the keyframe. So it's shown on its own (this media route,
 * a Short's cover, the admin's pair view) only once a video made from it has passed and been kept; before that only a
 * video provider gets it, by a signed link, to start the shot from. SQL on an unaliased adult_images.
 */
export const FRAME_SHOWN =
  "(adult_images.kind <> 'frame' or exists (select 1 from adult_images shot where shot.source_image = adult_images.id and shot.kind = 'video' and shot.status = 'ready'))";

/**
 * A ready file, to its viewer: theirs or, for an admin, anyone's (viewableBy), a keyframe once its shot has passed
 * (FRAME_SHOWN). Null only for a signed link, which names the one picture itself, and for a Short's own route, which
 * lets through only its cover and its shots that came through (lib/adult/shorts.ts shortMediaAllowed).
 */
const readyFor = (id: string, viewerId: string | null): { where: string; params: string[] } =>
  viewerId === null
    ? { where: `id = $1 and status = 'ready'`, params: [id] }
    : { where: `id = $1 and status = 'ready' and ${viewableBy(2)} and ${FRAME_SHOWN}`, params: [id, viewerId] };

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
