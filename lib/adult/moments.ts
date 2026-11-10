/**
 * A clip's moments (David, 2026-10-26: "save a image or offering a boomerang for a clip … if we really like a video and
 * want it to continue where it left off"). From one of the owner's own clips, cut on the server from our copy of it
 * (lib/media-tools/ffmpeg.ts; a video never goes to anyone by a signed link):
 *  - Save this moment: the frame at the second they paused on, kept as a picture in their gallery. It's checked like
 *    any picture before it's kept (it becomes a picture of its own: it can be animated, shared, used).
 *  - A boomerang (what the trim keeps, forward then back) and a loop (its end faded into its start): new videos made of
 *    the clip's own frames, which passed the clip's own check, so nothing new is checked.
 *  - The frame a clip keeps going from (lib/adult/clips.ts), or a Studio animation (lib/adult/studio-keep-going.ts):
 *    checked like a keyframe, kept out of the gallery.
 * All free (no provider is paid), counted against the month's moments (lib/adult/usage.ts), and the owner's own clips
 * only: never one shared with them.
 */
import type { Db } from "../db";
import { boomerang, FfmpegError, frameAt, joinVideos, seamlessLoop, type KeptTrim } from "../media-tools/ffmpeg";
import { dataColumn, keepBytes, readBytes } from "../object-store";
import { hivePausedMessage, HivePausedError } from "./hive-limit";
import { mediaByIds, outputCheckReady, PICTURES_OFF_NOTE, type Media } from "./media";
import { checkMedia, mediaGate } from "./moderation";
import { requestJson } from "./request-log";
import { ensureTagged } from "./media-tags";
import { countUse, overCap } from "./usage";

export type MomentFail = { ok: false; status: number; error: string; message: string };
export type MomentResult = { ok: true; media: Media } | MomentFail;
const fail = (status: number, error: string, message: string): MomentFail => ({ ok: false, status, error, message });

type OwnVideo = {
  id: string; owner_id: string; character_id: string | null; character_b: string | null; trim: KeptTrim | null; derived: string | null; shoot_id: string | null;
  data: Buffer | Uint8Array | null; object_key: string | null;
};

/** One of the owner's own ready videos (never one shared with them), with its bytes' whereabouts. */
async function ownVideo(db: Db, ownerId: string, id: string): Promise<OwnVideo | null> {
  return (
    (
      await db.query<OwnVideo>(
        `select id, owner_id, character_id, character_b, trim, derived, shoot_id, ${dataColumn()}, object_key
           from adult_images where id = $1 and kind = 'video' and status = 'ready' and owner_id = $2`,
        [id, ownerId],
      )
    ).rows[0] ?? null
  );
}

/** The clip's own bytes, or why not. */
async function bytesOf(v: OwnVideo): Promise<Buffer | null> {
  return readBytes(v).catch(() => null);
}

/**
 * What it shows, as the clip shows it: its tags (lib/adult/media-tags.ts), all but the pin for dates (the clip is tagged
 * first, if it hasn't been yet). And how far it goes, for whatever is made from it next (a still animated, shared): the
 * clip's stage tag as a level, or nude (2) when nothing says.
 */
async function copyTags(db: Db, video: OwnVideo, to: string, ownerId: string): Promise<void> {
  const people = [video.character_id, video.character_b].filter((x): x is string => Boolean(x));
  if (people.length) await ensureTagged(db, ownerId, people).catch(() => 0);
  await db.query(
    `insert into adult_media_tags (media_id, owner_id, kind, value, source)
     select $2, $3, kind, value, 'derived' from adult_media_tags where media_id = $1 and not removed and kind <> 'date'
     on conflict (media_id, kind, value) do nothing`,
    [video.id, to, ownerId],
  );
  const stage = (await db.query<{ level: number | null }>(`select max(value::int) as level from adult_media_tags where media_id = $1 and kind = 'stage' and value ~ '^[0-3]$' and not removed`, [to])).rows[0]?.level;
  await db.query(`update adult_images set tagged_at = now(), level = $2 where id = $1`, [to, typeof stage === "number" ? stage : 2]);
}

const cutFailed = (err: unknown) =>
  fail(502, "not_made", `That couldn't be cut from the clip (${err instanceof FfmpegError ? err.message.slice(0, 120) : "the clip couldn't be read"}).`);

/**
 * Save this moment: the frame at `at` seconds (or the end of what's kept) of one of the owner's clips, checked, kept as a
 * picture of the same one or two people, with the clip's tags. Free; counted as a moment.
 */
export async function saveMoment(db: Db, ownerId: string, videoId: string, at: number | "end"): Promise<MomentResult> {
  const video = await ownVideo(db, ownerId, videoId);
  if (!video) return fail(404, "not_found", "There's no clip of yours with that id.");
  // The same moment saved again (within a frame of it) is the one already kept: no second cut, no second check.
  if (typeof at === "number") {
    const again = (
      await db.query<{ id: string }>(
        `select id from adult_images where source_image = $1 and owner_id = $2 and kind = 'scene' and status = 'ready' and abs(moment_at - $3) < 0.05 limit 1`,
        [video.id, ownerId, at],
      )
    ).rows[0];
    const [kept] = again ? await mediaByIds(db, [again.id], ownerId) : [];
    if (kept) return { ok: true, media: kept };
  }
  if (!(await outputCheckReady(db))) return fail(409, "not_set_up", PICTURES_OFF_NOTE);
  const capped = await overCap(db, ownerId, "moments");
  if (capped) return fail(429, "capped", capped);
  // Hive out for the day (lib/adult/hive-limit.ts): nothing cut that couldn't be checked.
  const gate = await mediaGate(db, { owner: ownerId });
  if (!gate.ok) return fail(503, "hive_paused", gate.message);
  const bytes = await bytesOf(video);
  if (!bytes) return fail(404, "not_found", "That clip's file isn't there any more.");
  let frame: { png: Buffer; at: number };
  try {
    frame = await frameAt(bytes, at, video.trim);
  } catch (err) {
    return cutFailed(err);
  }
  // A picture of its own from now on: the output check, like every picture, before it's kept.
  const verdict = await checkMedia(db, { base64: frame.png.toString("base64"), mime: "image/png" }, "image", { owner: ownerId });
  if (!verdict.ok) {
    if (verdict.paused) return fail(503, "hive_paused", hivePausedMessage(verdict.paused, { discarded: true }));
    if (verdict.reason.startsWith("the check couldn't run")) return fail(503, "check_busy", "The safety check couldn't look at it just now, so it wasn't kept. Try again in a few minutes.");
    await db.query(`insert into adult_rejections (id, owner_id, kind, reason) values ($1, $2, 'moment', $3)`, [crypto.randomUUID(), ownerId, verdict.reason.slice(0, 300)]).catch(() => {});
    return fail(422, "discarded", `The safety check discarded that moment (${verdict.reason}).`);
  }
  const id = crypto.randomUUID();
  const kept = await keepBytes("after-dark", id, frame.png, "image/png");
  await db.query(
    `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, object_key, status, source_image, moment_at, model, nsfw_score, request)
     values ($1, $2, $3, $4, 'scene', $5, 'image/png', $6, $7, 'ready', $8, $9, 'moment', $10, $11::jsonb)`,
    [
      id,
      ownerId,
      video.character_id,
      video.character_b,
      `A moment saved from a clip, ${frame.at.toFixed(1)} s in`,
      kept.data,
      kept.object_key,
      video.id,
      frame.at,
      verdict.nsfw ?? null,
      requestJson([{ at: "ffmpeg", body: { from: video.id, cut_at: frame.at } }]),
    ],
  );
  await copyTags(db, video, id, ownerId);
  await countUse(db, ownerId, "moments");
  const [media] = await mediaByIds(db, [id], ownerId);
  return { ok: true, media };
}

export type DerivedKind = "boomerang" | "loop";
const DERIVED_LABEL: Record<DerivedKind, string> = { boomerang: "A boomerang of a clip", loop: "A loop of a clip" };

/**
 * A boomerang or a loop of one of the owner's clips, honouring its trim: a new video, made of the clip's own frames
 * (checked when the clip was), with the clip's tags. The same one again, for the same trim, is the one already made.
 */
export async function deriveClip(db: Db, ownerId: string, videoId: string, kind: DerivedKind): Promise<MomentResult> {
  const video = await ownVideo(db, ownerId, videoId);
  if (!video) return fail(404, "not_found", "There's no clip of yours with that id.");
  if (video.derived) return fail(409, "already", `That's already a ${video.derived}: make one from the clip itself.`);
  const trim = video.trim ? JSON.stringify(video.trim) : null;
  const made = (
    await db.query<{ id: string; request: { body?: { trim?: unknown } }[] | null }>(
      `select id, request from adult_images where source_image = $1 and derived = $2 and owner_id = $3 and status = 'ready' order by created_at desc`,
      [video.id, kind, ownerId],
    )
  ).rows.find((r) => JSON.stringify(r.request?.[0]?.body?.trim ?? null) === (trim ?? "null"));
  if (made) {
    const [media] = await mediaByIds(db, [made.id], ownerId);
    if (media) return { ok: true, media };
  }
  const capped = await overCap(db, ownerId, "moments");
  if (capped) return fail(429, "capped", capped);
  const bytes = await bytesOf(video);
  if (!bytes) return fail(404, "not_found", "That clip's file isn't there any more.");
  let out: Buffer;
  try {
    out = kind === "boomerang" ? await boomerang(bytes, video.trim) : await seamlessLoop(bytes, video.trim);
  } catch (err) {
    return cutFailed(err);
  }
  const id = crypto.randomUUID();
  const kept = await keepBytes("after-dark", id, out, "video/mp4");
  await db.query(
    `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, object_key, status, source_image, derived, model, request)
     values ($1, $2, $3, $4, 'video', $5, 'video/mp4', $6, $7, 'ready', $8, $9, 'ffmpeg', $10::jsonb)`,
    [id, ownerId, video.character_id, video.character_b, DERIVED_LABEL[kind], kept.data, kept.object_key, video.id, kind, requestJson([{ at: "ffmpeg", body: { from: video.id, kind, trim: video.trim } }])],
  );
  await copyTags(db, video, id, ownerId);
  await countUse(db, ownerId, "moments");
  const [media] = await mediaByIds(db, [id], ownerId);
  return { ok: true, media };
}

/** The most clips joined into one reel: a chain of clips (CHAIN_MAX, lib/adult/clip-chains.ts) with two shots each. */
export const JOIN_MAX = 12;

/**
 * A chain of the owner's clips as one video, to post as one reel (David, 2026-11-10: "once we continue from a clip we
 * should be able to post the two clips as one reel for the showcase page"): a clip and the ones kept going from it (a
 * date's clips, or a Studio animation's links), each as its trim keeps it, with its voice where one plays beside it, in
 * the order given. Made of their own frames, checked when they were, so nothing new is checked; all of the same one or
 * two people, so the post asks the same owners' OK as each clip would. The same clips with the same trims again are the
 * one already made. Free; counted as a moment.
 */
export async function joinClips(db: Db, ownerId: string, ids: readonly string[]): Promise<MomentResult> {
  if (ids.length < 2) return fail(422, "too_few", "There's only one clip there: keep it going first, then post them as one.");
  if (ids.length > JOIN_MAX || new Set(ids).size !== ids.length) return fail(422, "invalid_request", `That's not a chain of clips (${JOIN_MAX} at most, each once).`);
  const videos: OwnVideo[] = [];
  for (const id of ids) {
    const v = await ownVideo(db, ownerId, id);
    if (!v) return fail(404, "not_found", "One of those clips isn't yours, or isn't there any more.");
    if (v.derived) return fail(409, "already", `One of those is a ${v.derived === "chain" ? "reel already" : v.derived}: join the clips themselves.`);
    videos.push(v);
  }
  const who = (v: OwnVideo) => [v.character_id, v.character_b].filter(Boolean).sort().join("+");
  if (!videos[0].character_id || videos.some((v) => who(v) !== who(videos[0]))) return fail(422, "not_one_chain", "Those clips aren't all of the same people: join one chain at a time.");
  const trims = videos.map((v) => v.trim ?? null);
  const made = (
    await db.query<{ id: string; request: { body?: { from?: unknown; trims?: unknown } }[] | null }>(
      `select id, request from adult_images where source_image = $1 and derived = 'chain' and owner_id = $2 and status = 'ready' order by created_at desc`,
      [ids[ids.length - 1], ownerId],
    )
  ).rows.find((r) => JSON.stringify(r.request?.[0]?.body?.from ?? null) === JSON.stringify(ids) && JSON.stringify(r.request?.[0]?.body?.trims ?? null) === JSON.stringify(trims));
  if (made) {
    const [media] = await mediaByIds(db, [made.id], ownerId);
    if (media) return { ok: true, media };
  }
  const capped = await overCap(db, ownerId, "moments");
  if (capped) return fail(429, "capped", capped);
  // The voice said beside a silent shot (lib/adult/reels.ts audio_id), as the player plays it: in place of its sound.
  const voiceIds = (
    await db.query<{ media_id: string; audio_id: string }>(
      `select distinct on (s->>'media_id') s->>'media_id' as media_id, s->>'audio_id' as audio_id
         from adult_reels r cross join lateral jsonb_array_elements(r.shots) s
        where r.owner_id = $1 and s->>'media_id' = any($2::text[]) and coalesce(s->>'audio_id', '') <> ''`,
      [ownerId, ids],
    )
  ).rows;
  const voices = new Map<string, Buffer>();
  for (const { media_id, audio_id } of voiceIds) {
    const row = (await db.query<{ data: Buffer | Uint8Array | null; object_key: string | null }>(`select ${dataColumn()}, object_key from adult_images where id = $1 and owner_id = $2 and kind = 'audio' and status = 'ready'`, [audio_id, ownerId])).rows[0];
    const bytes = row ? await readBytes(row).catch(() => null) : null;
    if (bytes?.length) voices.set(media_id, bytes);
  }
  const pieces = [];
  for (const v of videos) {
    const bytes = await bytesOf(v);
    if (!bytes) return fail(404, "not_found", "One of those clips' files isn't there any more.");
    pieces.push({ video: bytes, trim: v.trim, voice: voices.get(v.id) ?? null });
  }
  let out: Buffer;
  try {
    out = await joinVideos(pieces);
  } catch (err) {
    return fail(502, "not_made", `Those clips couldn't be joined (${err instanceof FfmpegError ? err.message.slice(0, 120) : "a clip couldn't be read"}).`);
  }
  const id = crypto.randomUUID();
  const kept = await keepBytes("after-dark", id, out, "video/mp4");
  const first = videos[0];
  await db.query(
    `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, object_key, status, source_image, derived, model, request)
     values ($1, $2, $3, $4, 'video', $5, 'video/mp4', $6, $7, 'ready', $8, 'chain', 'ffmpeg', $9::jsonb)`,
    [
      id,
      ownerId,
      first.character_id,
      first.character_b,
      `${ids.length} clips kept going, joined into one reel`,
      kept.data,
      kept.object_key,
      ids[ids.length - 1],
      requestJson([{ at: "ffmpeg", body: { from: ids, trims, voices: [...voices.keys()] } }]),
    ],
  );
  // What each clip shows, together; how far it goes is the furthest any of them went.
  for (const v of videos) await copyTags(db, v, id, ownerId);
  await countUse(db, ownerId, "moments");
  const [media] = await mediaByIds(db, [id], ownerId);
  return { ok: true, media };
}

/** Whether a video of one is a Studio animation of the owner's (made by an 'animate' shoot of theirs), so it can be kept going. */
async function studioAnimation(db: Db, ownerId: string, shootId: string): Promise<boolean> {
  return (await db.query(`select 1 from adult_studio_shoots where id = $1 and owner_id = $2 and kind = 'animate'`, [shootId, ownerId])).rows.length > 0;
}

/**
 * The frame a clip keeps going from (lib/adult/clips.ts "Keep going from here"): cut at `at` (or the end of what's kept)
 * from the owner's own video of two, or from one of their Studio animations (lib/adult/studio-keep-going.ts: kept as
 * the character's alone, a pair picture's too), asked the age question like any keyframe (lib/adult/check.ts
 * "keyframe": its video's check comes after), and kept out of the gallery as a 'frame' of the same one or two. The page
 * asks for it first (POST /api/admin/after-dark/moments "frame", the one route ffmpeg runs in), then keeps going from it
 * by its id. Throws what to say when it can't be had.
 */
export async function momentFrame(db: Db, ownerId: string, videoId: string, at: number | "end"): Promise<{ id: string; at: number }> {
  const video = await ownVideo(db, ownerId, videoId);
  const animation = Boolean(video?.character_id && !video.character_b && video.shoot_id) && (await studioAnimation(db, ownerId, video!.shoot_id!));
  if (!video?.character_id || (!video.character_b && !animation)) throw new Error("that shot's video isn't there");
  const people = [video.character_id, video.character_b] as const;
  const bytes = await bytesOf(video);
  if (!bytes) throw new Error("that shot's file isn't there any more");
  const frame = await frameAt(bytes, at, video.trim);
  const verdict = await checkMedia(db, { base64: frame.png.toString("base64"), mime: "image/png" }, "keyframe", { owner: ownerId });
  if (!verdict.ok) {
    if (verdict.paused) throw new HivePausedError(verdict.paused);
    if (!verdict.reason.startsWith("the check couldn't run")) {
      await db.query(`insert into adult_rejections (id, owner_id, kind, reason) values ($1, $2, 'reel', $3)`, [crypto.randomUUID(), ownerId, `moment: ${verdict.reason}`.slice(0, 300)]).catch(() => {});
    }
    throw new Error(`the safety check didn't pass that moment (${verdict.reason})`);
  }
  const id = crypto.randomUUID();
  const kept = await keepBytes("after-dark", id, frame.png, "image/png");
  await db.query(
    `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, object_key, status, source_image, moment_at, model)
     values ($1, $2, $3, $4, 'frame', $5, 'image/png', $6, $7, 'ready', $8, $9, 'moment')`,
    [id, ownerId, people[0], people[1], `Kept going from ${animation ? "an animation" : "a clip"}, ${frame.at.toFixed(1)} s in`, kept.data, kept.object_key, video.id, frame.at],
  );
  return { id, at: frame.at };
}
