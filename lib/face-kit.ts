/**
 * A character's face kit (docs/PRDs/digital-human.md, Tier 0; David 2026-11-13): the still portrait on a companion call
 * replaced by a face that's alive, for nothing a minute. Made once per approved safe portrait:
 *
 *  - **The portrait:** them from the collarbones up, mouth closed, looking at the camera (their approved safe portrait as
 *    it is when it reads as one, else an edit of it, lib/adult/presence.ts PORTRAIT_PROMPT's cousin). The base of the
 *    rest, and the still the call shows under the loop.
 *  - **The loop:** five seconds of them still and natural, from the portrait itself, played the whole call (Replicate's
 *    Wan 2.2 image-to-video at 480p, the showcase's living portraits' model with its safety checker on).
 *  - **The talking still** (TALK_STILL), only while Ditto is the renderer that's set (kitParts): the portrait with the
 *    mouth at rest, lips together, not smiling. Never shown; Ditto animates it on calls
 *    (lib/live-face/ditto-clips.ts dittoSource), because from the smiling portrait it talks through a grin.
 *
 * Until 2026-11-22 a kit also drew six more stills (three mouth shapes, a blink, a smile, a gasp) that the call swapped
 * with the voice while the loop stopped: the "choppy mouth" (lib/face-kit-shared.ts). They're no longer drawn or shown,
 * which takes a kit from about 29 cents to 8 at the most; kits that have them keep the rows.
 *
 * Every still goes through the PG check (lib/adult/moderation.ts checkRating: clothing and age) before it's kept, and the
 * loop by three of its frames (start, middle, end), as the showcase's clips are (lib/showcase-loops.ts). Kept in
 * face_kits (bytes in the companion area of the object store), served by /api/face-kit/<id> to anyone: PG, checked, and
 * a character's public face.
 *
 * Who pays: nobody per use. A kit is drawn when an account with the plan (or an admin) starts a call with a character
 * that has none (ensureFaceKit), a few a day at most (FACE_KIT_PER_DAY, about 8¢ each on Replicate), or by an admin
 * (/api/admin/face-kit). A new approved portrait means a new kit; the old one stays until it's made.
 *
 * A character drawn in anime or 2.5D (lib/art-style.ts) gets a kit in that style (styledFace): the same edits, kept in
 * their drawing style, never turned into a photograph of a real-looking person (David, 2026-11-13). The style is part of
 * the kit's key (faceSource), so a kit drawn in another style is never shown and is replaced on the next call.
 */
import { track } from "./analytics";
import type { Db } from "./db";
import { keepBytes, readBytes } from "./object-store";
import { artStyleFrom, DRAWN_STYLES, isDrawnStyle, STYLE_WORDS, type ArtStyle, type DrawnStyle } from "./art-style";
import { showStyleSql } from "./portrait-sql";
import { characterPortrait } from "./portraits";
import { overLimit } from "./limits";
import { checkRating } from "./adult/moderation";
import { createPrediction, downloadOutput, getPrediction, isDone, noOutput, outputUrls, runModel } from "./adult/replicate";
import { adultKeys, getAdultSettings } from "./adult/settings";
import { frameAt, videoDuration } from "./media-tools/ffmpeg";
import { checkPgPictureText } from "./safety";
import { resizedWebp } from "./thumbs";
import { RETIRED_STILLS, TALK_STILL, type FaceKit, type FacePart, type KitStill } from "./face-kit-shared";

export { FACE_PARTS, FACE_STILLS, TALK_STILL, type FaceKit, type FacePart, type FaceStill, type KitStill } from "./face-kit-shared";

const SAME = "Make one photograph of the person in Picture 1: exactly the same person, the same face, features, hair, skin tone, clothes, framing, light and background.";

/** Their portrait, the base of the kit: a plain, fully clothed head-and-shoulders picture with the mouth closed. */
export const FACE_PORTRAIT_PROMPT =
  "Make one photograph of the person in Picture 1: exactly the same person, the same face, features, hair and skin tone. " +
  "A close head-and-shoulders portrait from the collarbones up, centred, facing the camera, looking into the lens with a calm, friendly, relaxed expression, " +
  "mouth closed, eyes open, in a simple plain top, fully clothed, soft even light, a plain softly blurred background. Photorealistic. An adult, safe for work.";

/** The talking still's edit (Ditto's source): the portrait, with only the mouth changed. */
export const FACE_PROMPTS: Record<typeof TALK_STILL, string> = {
  talk: `${SAME} Change only their mouth: relaxed and at rest, the lips gently together and not smiling, as between sentences in a calm conversation, the eyes and everything else unchanged. Photorealistic. An adult, safe for work.`,
};

/** The loop's direction: still and natural, ending as it began, so it plays over the portrait and fades back into it. */
export const FACE_LOOP_PROMPT =
  "The person in the picture stays still and natural, as if listening: they breathe, blink, and glance at the camera with a small natural smile. " +
  "The camera doesn't move. No talking, no gestures, nobody else comes in, the same clothes, place and light. They end as they began. Fully clothed, safe for work. Photorealistic. An adult.";

/** Who a drawn character is in a face prompt: "the anime character in the picture". */
const DRAWN_WHO: Record<DrawnStyle, string> = {
  anime: "anime character",
  semi_real: "illustrated character",
  oil_painting: "painted character",
  render_3d: "3D character",
  comic: "comic character",
  ink: "ink-drawn character",
  pixel: "pixel-art character",
};

/**
 * A face prompt in their art style: a drawn character's face is an illustration of them in their own style (the style's
 * editFinish), said to be a grown adult (drawings read young, and every still goes through the PG check's age question).
 * A photograph's prompt is unchanged.
 */
export function styledFace(prompt: string, style: ArtStyle): string {
  if (!isDrawnStyle(style)) return prompt;
  const { noun, editFinish } = STYLE_WORDS[style];
  return prompt
    .replace(/Make one photograph of the person in Picture 1/g, `Make one ${noun} of the character in Picture 1`)
    .replace(/The person in the picture/g, `The ${DRAWN_WHO[style]} in the picture`)
    .replace(/Photorealistic\./g, editFinish ?? "");
}

/**
 * What one kit costs, at the most: one Qwen edit for the portrait (nothing when their own approved portrait is used as
 * it is) and one Wan 2.2 clip at 480p (docs/costs.md). Ditto's talking still, where it's drawn, is one more edit.
 */
export const FACE_STILL_USD = 0.03;
export const FACE_LOOP_USD = 0.05;
export const FACE_KIT_USD = FACE_STILL_USD + FACE_LOOP_USD;

type Env = Record<string, string | undefined>;
/** Whether Ditto is the renderer that's set (lib/live-face reads the same setting; this file can't import it: it imports this one). */
const dittoSet = (env: Env): boolean => /^ditto(?::|$)/.test((env.LIVE_FACE_PROVIDER ?? "").trim().toLowerCase());
/** What a kit is made of here and now: the portrait and the loop, and Ditto's talking still while Ditto is set. */
export function kitParts(env: Env = process.env): FacePart[] {
  return ["portrait", "loop", ...(dittoSet(env) ? [TALK_STILL] : [])];
}

/** Kits started on calls across everyone: a few a day (about $3.50 at the default), never a burst. Admins' are uncounted. */
export const FACE_KIT_LIMITS = { perHour: 4, perDay: 12 };
export function faceKitLimits(env: Record<string, string | undefined> = process.env): { perHour: number; perDay: number } {
  const raw = env.FACE_KIT_PER_DAY?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? { perHour: Math.min(FACE_KIT_LIMITS.perHour, Math.max(1, Math.floor(n))), perDay: Math.floor(n) } : FACE_KIT_LIMITS;
}

/** A still "making" this long was lost with its request: it counts as failed, and is drawn again next time. */
const STILL_LOST_MS = 10 * 60 * 1000;
/** A loop not back from Replicate by then is given up. One that is back is kept however late it's collected. */
const LOOP_GIVE_UP_MS = 20 * 60 * 1000;
/**
 * Once a loop is queued, whoever started it follows it (followFaceKit): asked about this often, for this long. A call
 * here lasts 20 to 60 seconds and the loop takes a minute or more, so the page that polls while a call is on had nearly
 * always gone by the time it was ready, and the next poll (the next call, hours later) gave up on it: on 2026-11-22 no
 * character had a loop at all.
 */
const FOLLOW_EVERY_MS = 10 * 1000;
const FOLLOW_FOR_MS = 8 * 60 * 1000;

let pauseScale = 1;
/** Tests don't wait between asks. */
export function setFaceKitPausesForTests(on: boolean): void {
  pauseScale = on ? 1 : 0;
}
const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms * pauseScale));
/**
 * A loop still "making" this long was never collected (collectFaceKits runs only while a page polls): it counts as
 * failed, so the next call draws it again. Two characters' loops sat "making" for days and kept them from ever getting
 * a kit (2026-11-21).
 */
const LOOP_LOST_MS = 30 * 60 * 1000;
/** A kit that failed is not tried again on a call for this long (an admin can at once). */
const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
/** Failures that say nothing about the picture: the loop was fine or never seen, and nobody collected it. The next call draws it again at once. */
const UNCOLLECTED = /gave up waiting|couldn't be collected|never collected/;
/** Stills kept at this width (they show at 136 px or less), as WebP. */
const STILL_WIDTH = 512;

export const faceKitUrl = (id: string) => `/api/face-kit/${encodeURIComponent(id)}`;

type Row = { id: string; part: FacePart; status: "making" | "ready" | "failed"; error: string | null; queue_id: string | null; updated_at: Date | string; created_at: Date | string };

/** Marks a kit drawn in a drawn style in its key (faceSource's id: "#anime", "#semi_real"), so one drawn as a photograph never stands in for it. */
const styleKey = (id: string, style: ArtStyle): string => (isDrawnStyle(style) ? `${id}#${style}` : id);

/**
 * The portrait a character's kit is made from: its newest approved safe portrait (the ledger's), or a house character's
 * reviewed file. `id` keys the kit (and the live face built from it): the portrait's, plus their style when they're
 * drawn (styleKey), so the kit follows the style as it follows the portrait.
 */
export async function faceSource(db: Db, characterId: string, baseUrl: string): Promise<{ id: string; url: string; style: ArtStyle } | null> {
  const [{ rows }, who] = await Promise.all([
    db.query<{ id: string; url: string }>(
      `select id, url from character_assets where character_id = $1 and kind = 'portrait' and review_status = 'approved' and content_rating = 'pg' and url is not null
        order by created_at desc limit 1`,
      [characterId],
    ),
    // The show's style (showStyleSql): a house-look face is drawn in 2.5D though their own style stays unset for After Dark.
    db.query<{ style: string }>(`select ${showStyleSql("c")} as style from characters c where c.id = $1`, [characterId]),
  ]);
  const style = artStyleFrom(who.rows[0]?.style);
  const a = rows[0];
  if (a) return { id: styleKey(a.id, style), url: new URL(a.url.startsWith("/") ? a.url : `/api/assets/${a.id}`, baseUrl).toString(), style };
  const house = characterPortrait(characterId);
  return house ? { id: styleKey(`static:${house}`, style), url: new URL(house, baseUrl).toString(), style } : null;
}

async function rowsFor(db: Db, characterId: string, sourceId: string): Promise<Row[]> {
  const { rows } = await db.query<Row>(`select id, part, status, error, queue_id, updated_at, created_at from face_kits where character_id = $1 and source_id = $2`, [characterId, sourceId]);
  return rows.map((r): Row => {
    if (r.status !== "making") return r;
    const age = Date.now() - new Date(r.updated_at).getTime();
    if (r.part !== "loop" && age > STILL_LOST_MS) return { ...r, status: "failed", error: "it was lost while being drawn" };
    if (r.part === "loop" && age > LOOP_LOST_MS) return { ...r, status: "failed", error: "it was never collected" };
    return r;
  });
}

/** The stills only older kits hold (lib/face-kit-shared.ts RETIRED_STILLS): their rows stay, the page never hears of them. */
const retired = (part: FacePart): boolean => (RETIRED_STILLS as readonly string[]).includes(part);

function kitOf(all: Row[]): FaceKit | null {
  const rows = all.filter((r) => !retired(r.part));
  if (!rows.length) return null;
  const kit: FaceKit = { stills: {}, loop: null, making: false, failed: null };
  for (const r of rows) {
    if (r.status === "making") kit.making = true;
    if (r.status !== "ready") continue;
    // The loop's file can change under the same row (lib/live-face: the renderer's re-timed copy replaces it), and the
    // file route caches for a year, so its URL carries the row's updated_at.
    if (r.part === "loop") kit.loop = `${faceKitUrl(r.id)}?v=${Math.floor(new Date(r.updated_at).getTime() / 1000) || 0}`;
    else kit.stills[r.part] = faceKitUrl(r.id);
  }
  // A failed talking still is only news while Ditto wants one.
  const wanted = kitParts();
  const failed = rows.filter((r) => r.status === "failed" && wanted.includes(r.part)).sort((x, y) => Number(y.part === "portrait") - Number(x.part === "portrait"))[0];
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
 * loop queued from it (collected by collectFaceKits as the page polls) and, while Ditto is set, its talking still
 * (checked). What's ready stays; a failed part is tried again. A new portrait starts the rest over.
 */
export async function makeFaceKit(db: Db, characterId: string, baseUrl: string, opts: { count?: boolean; redo?: boolean; env?: Env } = {}): Promise<FaceKitResult> {
  const blocked = await faceKitBlocked(db, characterId, baseUrl, opts);
  if (blocked) return blocked;
  const source = (await faceSource(db, characterId, baseUrl))!;
  const [keys, settings] = await Promise.all([adultKeys(db), getAdultSettings(db)]);
  const token = keys.replicate!;
  const styled = (prompt: string) => styledFace(prompt, source.style);
  const editModel = settings.replicate_keyframe_model;
  // `redo`: start over from the portrait as it is now (a kit drawn the old way, or one that lost what makes them them).
  if (opts.redo) await db.query(`delete from face_kits where character_id = $1`, [characterId]);
  let have = await rowsFor(db, characterId, source.id);
  const done = (part: FacePart) => have.some((r) => r.part === part && r.status !== "failed");
  const failed: string[] = [];
  let made = 0;
  const startedAt = Date.now();

  /** The approved portrait itself as the kit's portrait (square from the top, WebP, PG-checked), or null. */
  const ownPortrait = async (d: Db, character: string, src: { id: string; url: string }): Promise<string | null> => {
    try {
      const res = await fetch(src.url, { signal: AbortSignal.timeout(20_000) });
      const mime = res.headers.get("content-type")?.split(";")[0] ?? "";
      if (!res.ok || !mime.startsWith("image/")) return null;
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > 25 * 1024 * 1024) return null;
      const small = await resizedWebp(bytes, STILL_WIDTH, { square: true, top: true });
      if (!small) return null;
      const v = await checkRating(d, { base64: small.toString("base64"), mime: "image/webp" });
      if (!v.ok || v.rating !== "pg") return null;
      return await upsert(d, { character, source: src.id, part: "portrait", status: "ready", model: "base", file: { bytes: small, mime: "image/webp" } });
    } catch {
      return null;
    }
  };

  /** One still: the edit (Replicate's own safety checker on), the PG check, kept small as WebP. */
  const still = async (part: KitStill, prompt: string, from: string): Promise<string | null> => {
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
    // Their own approved portrait, as it is: the edit below strips an outfit and anything not a plain face (ears, tails,
    // a kimono), so it's only the fallback when the picture can't be read or doesn't pass the PG check by itself.
    portrait = (await ownPortrait(db, characterId, source)) ?? (await still("portrait", styled(FACE_PORTRAIT_PROMPT), source.url));
    if (!portrait) {
      track("face_kit", { character_id: characterId, made: 0, failed: failed.length, ms: Date.now() - startedAt });
      return { ok: true, made: 0, queued: false, failed };
    }
    // A new portrait: whatever was made from an older one (or in the other style) isn't this face.
    await db.query(`delete from face_kits where character_id = $1 and id <> $2`, [characterId, portrait]);
    have = [];
  }
  const base = new URL(faceKitUrl(portrait), baseUrl).toString();

  // The loop, queued (Replicate takes a minute or more over it) while the stills are drawn; collectFaceKits keeps it.
  let queued = false;
  if (!done("loop")) {
    const model = settings.replicate_video_model;
    try {
      const p = await createPrediction(token, model, { prompt: styled(FACE_LOOP_PROMPT), image: base, num_frames: 81, resolution: "480p", frames_per_second: 16, go_fast: true }, { cancelAfter: "20m" });
      await upsert(db, { character: characterId, source: source.id, part: "loop", status: "making", model, queue: p.id });
      queued = true;
    } catch (err) {
      const why = err instanceof Error ? err.message.slice(0, 200) : "error";
      await upsert(db, { character: characterId, source: source.id, part: "loop", status: "failed", model, error: why });
      failed.push(`the living portrait: ${why}`);
    }
  }

  // Ditto's talking still, where it's wanted, marked making first so the page knows to wait.
  const todo = kitParts(opts.env).filter((p): p is typeof TALK_STILL => p === TALK_STILL && !done(p));
  for (const part of todo) await upsert(db, { character: characterId, source: source.id, part, status: "making", model: editModel });
  await Promise.all(todo.map((part) => still(part, styled(FACE_PROMPTS[part]), base)));
  track("face_kit", { character_id: characterId, made, queued, failed: failed.length, usd: Math.round((made * FACE_STILL_USD + (queued ? FACE_LOOP_USD : 0)) * 100) / 100, ms: Date.now() - startedAt });
  return { ok: true, made, queued, failed };
}

/**
 * The loops being made, collected (the page asks as it polls): a finished one is checked by three of its frames and
 * kept, or marked failed; one not back in LOOP_GIVE_UP_MS is given up. `characterId` narrows it to one character's.
 */
export async function collectFaceKits(db: Db, characterId?: string): Promise<number> {
  // `updated_at` is when this loop was queued: a row is written once when it's queued and not again until it's kept or
  // failed. Not `created_at`, which a loop queued again after a failure keeps from its first try: read from that, a
  // second try was "late" at its first check and given up within seconds, so a loop that had failed once could never
  // be drawn again (Juniper's, 2026-11-22).
  const { rows } = await db.query<{ id: string; character_id: string; model: string; queue_id: string; queued_at: Date | string }>(
    `select id, character_id, model, queue_id, updated_at as queued_at from face_kits where part = 'loop' and status = 'making' and queue_id is not null and ($1::text is null or character_id = $1) order by updated_at limit 3`,
    [characterId ?? null],
  );
  if (!rows.length) return 0;
  const token = (await adultKeys(db)).replicate;
  if (!token) return 0;
  let kept = 0;
  for (const r of rows) {
    const fail = (why: string) => db.query(`update face_kits set status = 'failed', error = $2, updated_at = now() where id = $1 and status = 'making'`, [r.id, why.slice(0, 200)]);
    // Asked of Replicate first, however long it's been: a loop that's done is kept even when nobody came for it in
    // time (it used to be given up unseen, 2026-11-22). Only one that still isn't done after LOOP_GIVE_UP_MS is.
    const late = Date.now() - new Date(r.queued_at).getTime() > LOOP_GIVE_UP_MS;
    try {
      const p = await getPrediction(token, r.queue_id);
      if (!isDone(p)) {
        if (late) await fail("gave up waiting");
        continue;
      }
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
      // Replicate unreachable: asked again on the next poll. Long past its time (its file has gone from Replicate, which
      // keeps one about an hour): given up, so the next call draws it again.
      console.error(`[face-kit] collecting ${r.character_id}'s loop: ${err instanceof Error ? err.message.slice(0, 160) : "error"}`);
      if (late) await fail("it couldn't be collected in time").catch(() => {});
    }
  }
  return kept;
}

/**
 * Follows a character's queued loop until it's kept or given up (whoever queued it calls this after their response:
 * the routes' inBackground), so a loop lands whether or not a page is still open to poll for it. Asks every
 * FOLLOW_EVERY_MS, for FOLLOW_FOR_MS at the most; never throws. Whether the kit has its loop at the end.
 */
export async function followFaceKit(db: Db, characterId: string): Promise<boolean> {
  const count = async (status: "making" | "ready") =>
    (await db.query<{ n: number }>(`select count(*)::int as n from face_kits where character_id = $1 and part = 'loop' and status = $2 and ($2 <> 'making' or queue_id is not null)`, [characterId, status])).rows[0]?.n ?? 0;
  try {
    for (let asks = 0; asks < FOLLOW_FOR_MS / FOLLOW_EVERY_MS; asks++) {
      if (!(await count("making"))) break;
      await pause(FOLLOW_EVERY_MS);
      await collectFaceKits(db, characterId);
    }
    return (await count("ready")) > 0;
  } catch (err) {
    console.error(`[face-kit] following ${characterId}'s loop: ${err instanceof Error ? err.message.slice(0, 160) : "error"}`);
    return false;
  }
}

/**
 * A call started with this character: their kit is made if they have none from the portrait they have now, nothing
 * failed in the last day, and the day's few aren't used up. Quiet about everything: the call doesn't wait for it.
 * `follow`: once the loop is queued, it's followed here until it's kept (followFaceKit), which is how the routes call
 * it, after their response; a loop someone else left queued is followed too.
 */
export async function ensureFaceKit(db: Db, characterId: string, baseUrl: string, env: Env = process.env, opts: { follow?: boolean } = {}): Promise<FaceKitResult | null> {
  const made = await ensureKitParts(db, characterId, baseUrl, env);
  if (opts.follow) await followFaceKit(db, characterId);
  return made;
}

async function ensureKitParts(db: Db, characterId: string, baseUrl: string, env: Env): Promise<FaceKitResult | null> {
  const source = await faceSource(db, characterId, baseUrl);
  if (!source) return null;
  // Only what a kit is made of now counts: a still an older kit holds (a mouth shape that failed, say) is neither here nor there.
  const parts = kitParts(env);
  const have = (await rowsFor(db, characterId, source.id)).filter((r) => parts.includes(r.part));
  if (have.length && have.every((r) => r.status === "ready") && parts.every((p) => have.some((r) => r.part === p))) return null;
  if (have.some((r) => r.status === "making")) return null;
  const lately = have.filter((r) => r.status === "failed" && !UNCOLLECTED.test(r.error ?? "") && Date.now() - new Date(r.updated_at).getTime() < RETRY_AFTER_MS);
  if (lately.length) return null;
  const made = await makeFaceKit(db, characterId, baseUrl, { count: true, env });
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
  const all = [FACE_PORTRAIT_PROMPT, FACE_LOOP_PROMPT, ...Object.values(FACE_PROMPTS)];
  return [...all, ...DRAWN_STYLES.flatMap((style) => all.map((p) => styledFace(p, style)))].every((prompt) => checkPgPictureText({ prompt }).ok);
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
