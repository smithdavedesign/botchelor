/**
 * A character's face kit (docs/PRDs/digital-human.md, Tier 0; David 2026-11-13): the still portrait on a companion call
 * replaced by a face that moves with the voice, for nothing a minute. Made once per approved safe portrait:
 *
 *  - **The portrait:** them from the collarbones up, mouth closed, looking at the camera (an edit of the approved safe
 *    portrait, lib/adult/presence.ts PORTRAIT_PROMPT's cousin). The base of the rest, and the still the call shows.
 *  - **Six more stills** (FACE_STILLS), each an edit of that portrait with one thing changed: lips parted, mouth open,
 *    lips rounded; eyes closed; a smile; a gasp. The browser flips between them with the voice's loudness
 *    (lib/face-kit-shared.ts mouthFor), blinks, and shows a look when a line laughs or gasps.
 *  - **The loop:** five seconds of them still and natural, from the portrait itself, played while they listen
 *    (Replicate's Wan 2.2 image-to-video at 480p, the showcase's living portraits' model with its safety checker on).
 *
 * Every still goes through the PG check (lib/adult/moderation.ts checkRating: clothing and age) before it's kept, and the
 * loop by three of its frames (start, middle, end), as the showcase's clips are (lib/showcase-loops.ts). Kept in
 * face_kits (bytes in the companion area of the object store), served by /api/face-kit/<id> to anyone: PG, checked, and
 * a character's public face.
 *
 * Who pays: nobody per use. A kit is drawn when an account with the plan (or an admin) starts a call with a character
 * that has none (ensureFaceKit), a few a day at most (FACE_KIT_PER_DAY, about 30¢ each on Replicate), or by an admin
 * (/api/admin/face-kit). A new approved portrait means a new kit; the old one stays until it's made.
 */
import { track } from "./analytics";
import type { Db } from "./db";
import { keepBytes, readBytes } from "./object-store";
import { characterPortrait } from "./portraits";
import { overLimit } from "./limits";
import { checkRating } from "./adult/moderation";
import { createPrediction, downloadOutput, getPrediction, isDone, noOutput, outputUrls, runModel } from "./adult/replicate";
import { adultKeys, getAdultSettings } from "./adult/settings";
import { frameAt, videoDuration } from "./media-tools/ffmpeg";
import { checkPgPictureText } from "./safety";
import { resizedWebp } from "./thumbs";
import { FACE_PARTS, FACE_STILLS, type FaceKit, type FacePart, type FaceStill } from "./face-kit-shared";

export { FACE_PARTS, FACE_STILLS, type FaceKit, type FacePart, type FaceStill } from "./face-kit-shared";

const SAME = "Make one photograph of the person in Picture 1: exactly the same person, the same face, features, hair, skin tone, clothes, framing, light and background.";

/** Their portrait, the base of the kit: a plain, fully clothed head-and-shoulders picture with the mouth closed. */
export const FACE_PORTRAIT_PROMPT =
  "Make one photograph of the person in Picture 1: exactly the same person, the same face, features, hair and skin tone. " +
  "A close head-and-shoulders portrait from the collarbones up, centred, facing the camera, looking into the lens with a calm, friendly, relaxed expression, " +
  "mouth closed, eyes open, in a simple plain top, fully clothed, soft even light, a plain softly blurred background. Photorealistic. An adult, safe for work.";

/** Each still's edit: the portrait, with one thing changed. */
export const FACE_PROMPTS: Record<Exclude<FaceStill, "portrait">, string> = {
  mouth_small: `${SAME} Change only their mouth: lips slightly parted, as if in the middle of a soft word, the rest of the face relaxed. Photorealistic. An adult, safe for work.`,
  mouth_open: `${SAME} Change only their mouth: open as if saying "ah" mid-sentence, teeth just visible, jaw relaxed, eyes unchanged. Photorealistic. An adult, safe for work.`,
  mouth_round: `${SAME} Change only their mouth: lips rounded into a small "oh", as if mid-word, eyes unchanged. Photorealistic. An adult, safe for work.`,
  blink: `${SAME} Change only their eyes: both eyes gently closed in a natural blink, the mouth closed and relaxed as before. Photorealistic. An adult, safe for work.`,
  smile: `${SAME} Change only their expression: a warm, natural smile with the eyes smiling too. Photorealistic. An adult, safe for work.`,
  surprised: `${SAME} Change only their expression: pleasantly surprised, eyebrows raised, eyes a little wider, mouth slightly open. Photorealistic. An adult, safe for work.`,
};

/** The loop's direction: still and natural, ending as it began, so it plays over the portrait and fades back into it. */
export const FACE_LOOP_PROMPT =
  "The person in the picture stays still and natural, as if listening: they breathe, blink, and glance at the camera with a small natural smile. " +
  "The camera doesn't move. No talking, no gestures, nobody else comes in, the same clothes, place and light. They end as they began. Fully clothed, safe for work. Photorealistic. An adult.";

/** What one kit costs, about: seven Qwen edits and one Wan 2.2 clip at 480p (docs/costs.md). */
export const FACE_STILL_USD = 0.03;
export const FACE_LOOP_USD = 0.05;
export const FACE_KIT_USD = FACE_STILLS.length * FACE_STILL_USD + FACE_LOOP_USD;

/** Kits started on calls across everyone: a few a day (about $3.50 at the default), never a burst. Admins' are uncounted. */
export const FACE_KIT_LIMITS = { perHour: 4, perDay: 12 };
export function faceKitLimits(env: Record<string, string | undefined> = process.env): { perHour: number; perDay: number } {
  const raw = env.FACE_KIT_PER_DAY?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? { perHour: Math.min(FACE_KIT_LIMITS.perHour, Math.max(1, Math.floor(n))), perDay: Math.floor(n) } : FACE_KIT_LIMITS;
}

/** Stills drawn at once. */
const AT_ONCE = 3;
/** A still "making" this long was lost with its request: it counts as failed, and is drawn again next time. */
const STILL_LOST_MS = 10 * 60 * 1000;
/** A loop not back from Replicate by then is given up. */
const LOOP_GIVE_UP_MS = 20 * 60 * 1000;
/** A kit that failed is not tried again on a call for this long (an admin can at once). */
const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
/** Stills kept at this width (they show at 136 px or less), as WebP. */
const STILL_WIDTH = 512;

export const faceKitUrl = (id: string) => `/api/face-kit/${encodeURIComponent(id)}`;

type Row = { id: string; part: FacePart; status: "making" | "ready" | "failed"; error: string | null; queue_id: string | null; updated_at: Date | string; created_at: Date | string };

/** The portrait a character's kit is made from: its newest approved safe portrait (the ledger's), or a house character's reviewed file. */
export async function faceSource(db: Db, characterId: string, baseUrl: string): Promise<{ id: string; url: string } | null> {
  const { rows } = await db.query<{ id: string; url: string }>(
    `select id, url from character_assets where character_id = $1 and kind = 'portrait' and review_status = 'approved' and content_rating = 'pg' and url is not null
      order by created_at desc limit 1`,
    [characterId],
  );
  const a = rows[0];
  if (a) return { id: a.id, url: new URL(a.url.startsWith("/") ? a.url : `/api/assets/${a.id}`, baseUrl).toString() };
  const house = characterPortrait(characterId);
  return house ? { id: `static:${house}`, url: new URL(house, baseUrl).toString() } : null;
}

async function rowsFor(db: Db, characterId: string, sourceId: string): Promise<Row[]> {
  const { rows } = await db.query<Row>(`select id, part, status, error, queue_id, updated_at, created_at from face_kits where character_id = $1 and source_id = $2`, [characterId, sourceId]);
  return rows.map((r) => (r.part !== "loop" && r.status === "making" && Date.now() - new Date(r.updated_at).getTime() > STILL_LOST_MS ? { ...r, status: "failed", error: "it was lost while being drawn" } : r));
}

function kitOf(rows: Row[]): FaceKit | null {
  if (!rows.length) return null;
  const kit: FaceKit = { stills: {}, loop: null, making: false, failed: null };
  for (const r of rows) {
    if (r.status === "making") kit.making = true;
    if (r.status !== "ready") continue;
    if (r.part === "loop") kit.loop = faceKitUrl(r.id);
    else kit.stills[r.part] = faceKitUrl(r.id);
  }
  const failed = rows.filter((r) => r.status === "failed").sort((x, y) => Number(y.part === "portrait") - Number(x.part === "portrait"))[0];
  if (failed) kit.failed = `${failed.part === "portrait" ? "their portrait" : failed.part === "loop" ? "the living portrait" : `the ${failed.part.replace("_", " ")} still`}: ${failed.error ?? "it failed"}`;
  return kit;
}

/** A character's face kit for the page (made from the portrait they have now), or null when there's none at all. */
export async function faceKitOf(db: Db, characterId: string, baseUrl = "http://localhost"): Promise<FaceKit | null> {
  const source = await faceSource(db, characterId, baseUrl);
  if (!source) return null;
  return kitOf(await rowsFor(db, characterId, source.id));
}

export type FaceKitBlocked = { ok: false; status: number; error: string; message: string };
export type FaceKitResult = { ok: true; made: number; queued: boolean; failed: string[] } | FaceKitBlocked;

/** Why a kit can't be made now, or null. `count`: a call's kit counts against the day's few (an admin's doesn't). */
export async function faceKitBlocked(db: Db, characterId: string, baseUrl: string, opts: { count?: boolean } = {}): Promise<FaceKitBlocked | null> {
  const fail = (status: number, error: string, message: string): FaceKitBlocked => ({ ok: false, status, error, message });
  const c = (await db.query<{ id: string }>(`select id from characters where id = $1`, [characterId])).rows[0];
  if (!c) return fail(404, "not_found", "There's no such character.");
  if (!(await faceSource(db, characterId, baseUrl))) return fail(409, "no_portrait", "They have no approved safe portrait yet, so there's nothing to bring to life.");
  if (!(await adultKeys(db)).replicate) return fail(409, "not_set_up", "A face kit needs the Replicate key in After Dark's settings.");
  if (opts.count && (await overLimit(db, "face_kit", "all", faceKitLimits()))) return fail(429, "capped", "Enough faces were drawn for today; theirs comes next time.");
  return null;
}

/**
 * Makes what's missing of a character's kit from the portrait they have now: their portrait first (checked), then the
 * loop queued from it (collected by collectFaceKits as the page polls) and the stills a few at a time (each checked).
 * What's ready stays; a failed part is tried again. A new portrait starts the rest over.
 */
export async function makeFaceKit(db: Db, characterId: string, baseUrl: string, opts: { count?: boolean } = {}): Promise<FaceKitResult> {
  const blocked = await faceKitBlocked(db, characterId, baseUrl, opts);
  if (blocked) return blocked;
  const source = (await faceSource(db, characterId, baseUrl))!;
  const [keys, settings] = await Promise.all([adultKeys(db), getAdultSettings(db)]);
  const token = keys.replicate!;
  const editModel = settings.replicate_keyframe_model;
  let have = await rowsFor(db, characterId, source.id);
  const done = (part: FacePart) => have.some((r) => r.part === part && r.status !== "failed");
  const failed: string[] = [];
  let made = 0;
  const startedAt = Date.now();

  /** One still: the edit (Replicate's own safety checker on), the PG check, kept small as WebP. */
  const still = async (part: FaceStill, prompt: string, from: string): Promise<string | null> => {
    const set = (status: Row["status"], more: { error?: string; file?: { bytes: Buffer; mime: string } } = {}) => upsert(db, { character: characterId, source: source.id, part, status, model: editModel, ...more });
    try {
      const drawn = await runModel(token, editModel, { prompt, image: [from], aspect_ratio: "1:1", output_format: "png", go_fast: true }, { maxBytes: 25 * 1024 * 1024, timeoutMs: 150_000 });
      if (!drawn.mime.startsWith("image/")) throw new Error(`Replicate returned ${drawn.mime}, not a picture`);
      const v = await checkRating(db, { base64: drawn.bytes.toString("base64"), mime: drawn.mime });
      if (!v.ok || v.rating !== "pg") {
        const why = v.ok ? `it came out ${v.clothing.toLowerCase()}, not plainly dressed` : v.reason;
        await set("failed", { error: why });
        failed.push(`${part}: ${why}`);
        return null;
      }
      const small = await resizedWebp(drawn.bytes, STILL_WIDTH, { square: true });
      const id = await set("ready", { file: small ? { bytes: small, mime: "image/webp" } : { bytes: drawn.bytes, mime: drawn.mime } });
      made++;
      return id;
    } catch (err) {
      const why = err instanceof Error ? err.message.slice(0, 200) : "error";
      await set("failed", { error: why });
      failed.push(`${part}: ${why}`);
      return null;
    }
  };

  // The portrait, the base of the rest.
  let portrait = have.find((r) => r.part === "portrait" && r.status === "ready")?.id ?? null;
  if (!portrait) {
    await upsert(db, { character: characterId, source: source.id, part: "portrait", status: "making", model: editModel });
    portrait = await still("portrait", FACE_PORTRAIT_PROMPT, source.url);
    if (!portrait) {
      track("face_kit", { character_id: characterId, made: 0, failed: failed.length, ms: Date.now() - startedAt });
      return { ok: true, made: 0, queued: false, failed };
    }
    // A new portrait: whatever was made from an older one isn't this face.
    await db.query(`delete from face_kits where character_id = $1 and source_id = $2 and id <> $3`, [characterId, source.id, portrait]);
    have = [];
  }
  const base = new URL(faceKitUrl(portrait), baseUrl).toString();

  // The loop, queued (Replicate takes a minute or more over it) while the stills are drawn; collectFaceKits keeps it.
  let queued = false;
  if (!done("loop")) {
    const model = settings.replicate_video_model;
    try {
      const p = await createPrediction(token, model, { prompt: FACE_LOOP_PROMPT, image: base, num_frames: 81, resolution: "480p", frames_per_second: 16, go_fast: true }, { cancelAfter: "20m" });
      await upsert(db, { character: characterId, source: source.id, part: "loop", status: "making", model, queue: p.id });
      queued = true;
    } catch (err) {
      const why = err instanceof Error ? err.message.slice(0, 200) : "error";
      await upsert(db, { character: characterId, source: source.id, part: "loop", status: "failed", model, error: why });
      failed.push(`the living portrait: ${why}`);
    }
  }

  // The stills, a few at a time, each marked making first so the page knows to wait.
  const todo = FACE_STILLS.filter((p): p is Exclude<FaceStill, "portrait"> => p !== "portrait" && !done(p));
  for (const part of todo) await upsert(db, { character: characterId, source: source.id, part, status: "making", model: editModel });
  for (let i = 0; i < todo.length; i += AT_ONCE) await Promise.all(todo.slice(i, i + AT_ONCE).map((part) => still(part, FACE_PROMPTS[part], base)));
  track("face_kit", { character_id: characterId, made, queued, failed: failed.length, usd: Math.round((made * FACE_STILL_USD + (queued ? FACE_LOOP_USD : 0)) * 100) / 100, ms: Date.now() - startedAt });
  return { ok: true, made, queued, failed };
}

/**
 * The loops being made, collected (the page asks as it polls): a finished one is checked by three of its frames and
 * kept, or marked failed; one not back in LOOP_GIVE_UP_MS is given up. `characterId` narrows it to one character's.
 */
export async function collectFaceKits(db: Db, characterId?: string): Promise<number> {
  const { rows } = await db.query<{ id: string; character_id: string; model: string; queue_id: string; created_at: Date | string }>(
    `select id, character_id, model, queue_id, created_at from face_kits where part = 'loop' and status = 'making' and queue_id is not null and ($1::text is null or character_id = $1) order by created_at limit 3`,
    [characterId ?? null],
  );
  if (!rows.length) return 0;
  const token = (await adultKeys(db)).replicate;
  if (!token) return 0;
  let kept = 0;
  for (const r of rows) {
    const fail = (why: string) => db.query(`update face_kits set status = 'failed', error = $2, updated_at = now() where id = $1 and status = 'making'`, [r.id, why.slice(0, 200)]);
    if (Date.now() - new Date(r.created_at).getTime() > LOOP_GIVE_UP_MS) {
      await fail("gave up waiting");
      continue;
    }
    try {
      const p = await getPrediction(token, r.queue_id);
      if (!isDone(p)) continue;
      const missing = noOutput(p);
      if (missing) {
        await fail(missing);
        continue;
      }
      const file = await downloadOutput(outputUrls(p.output)[0], token, 40 * 1024 * 1024);
      if (!file.mime.startsWith("video/")) {
        await fail(`Replicate returned ${file.mime}, not a video`);
        continue;
      }
      // Three frames, each through the PG check (and its age question): the start, the middle, the end.
      const seconds = await videoDuration(file.bytes);
      let why: string | null = null;
      for (const at of [0.1, seconds / 2, "end" as const]) {
        const frame = await frameAt(file.bytes, at);
        const v = await checkRating(db, { base64: frame.png.toString("base64"), mime: "image/png" });
        if (!v.ok || v.rating !== "pg") {
          why = `a frame didn't pass: ${v.ok ? `it came out ${v.clothing.toLowerCase()}` : v.reason}`;
          break;
        }
      }
      if (why) {
        await fail(why);
        continue;
      }
      const stored = await keepBytes("companion", r.id, file.bytes, "video/mp4");
      const claimed = await db.query(`update face_kits set status = 'ready', mime = 'video/mp4', data = $2, object_key = $3, error = null, updated_at = now() where id = $1 and status = 'making' returning id`, [
        r.id,
        stored.data,
        stored.object_key,
      ]);
      if (claimed.rows.length) kept++;
    } catch (err) {
      // Replicate unreachable: asked again on the next poll.
      console.error(`[face-kit] collecting ${r.character_id}'s loop: ${err instanceof Error ? err.message.slice(0, 160) : "error"}`);
    }
  }
  return kept;
}

/**
 * A call started with this character: their kit is made if they have none from the portrait they have now, nothing
 * failed in the last day, and the day's few aren't used up. Quiet about everything: the call doesn't wait for it.
 */
export async function ensureFaceKit(db: Db, characterId: string, baseUrl: string): Promise<FaceKitResult | null> {
  const source = await faceSource(db, characterId, baseUrl);
  if (!source) return null;
  const have = await rowsFor(db, characterId, source.id);
  if (have.length && have.every((r) => r.status === "ready") && FACE_PARTS.every((p) => have.some((r) => r.part === p))) return null;
  if (have.some((r) => r.status === "making")) return null;
  const lately = have.filter((r) => r.status === "failed" && Date.now() - new Date(r.updated_at).getTime() < RETRY_AFTER_MS);
  if (lately.length) return null;
  const made = await makeFaceKit(db, characterId, baseUrl, { count: true });
  if (!made.ok) return made;
  if (made.failed.length) console.error(`[face-kit] ${characterId}: ${made.failed.join("; ").slice(0, 400)}`);
  return made;
}

/** One kit file, ready: its stored copy and type. */
export async function faceKitFile(db: Db, id: string): Promise<{ mime: string; object_key: string | null; data: Buffer | null } | null> {
  const r = (await db.query<{ mime: string | null; object_key: string | null; data: Buffer | null }>(`select mime, object_key, data from face_kits where id = $1 and status = 'ready'`, [id])).rows[0];
  return r?.mime ? { mime: r.mime, object_key: r.object_key, data: r.data } : null;
}
export const faceKitBytes = (f: { object_key: string | null; data: Buffer | null }) => readBytes(f);

/** Every prompt here holds to the show's own PG word check (tests). */
export function facePromptsPass(): boolean {
  return [FACE_PORTRAIT_PROMPT, FACE_LOOP_PROMPT, ...Object.values(FACE_PROMPTS)].every((prompt) => checkPgPictureText({ prompt }).ok);
}

async function upsert(db: Db, p: { character: string; source: string; part: FacePart; status: Row["status"]; model?: string; queue?: string; error?: string; file?: { bytes: Buffer; mime: string } }): Promise<string> {
  const id = crypto.randomUUID();
  const kept = p.file ? await keepBytes("companion", id, p.file.bytes, p.file.mime) : { data: null, object_key: null };
  const { rows } = await db.query<{ id: string }>(
    `insert into face_kits (id, character_id, source_id, part, status, model, queue_id, mime, data, object_key, error)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     on conflict (character_id, source_id, part) do update
       set status = excluded.status, model = excluded.model, queue_id = excluded.queue_id, mime = excluded.mime,
           data = excluded.data, object_key = excluded.object_key, error = excluded.error, updated_at = now()
     returning id`,
    [id, p.character, p.source, p.part, p.status, p.model ?? null, p.queue ?? null, p.file?.mime ?? null, kept.data, kept.object_key, p.error?.slice(0, 200) ?? null],
  );
  return rows[0].id;
}
