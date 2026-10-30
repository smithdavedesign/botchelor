/**
 * Living portraits (David, 2026-10-29: "do it for all my characters and agent made characters go for it", after the
 * reels' "a safe image of the person animated"): a safe picture brought to life as a short clip, for the reels.
 *
 * - **What's animated:** a creator's own live pg picture posts (theirs to publish), and, for an admin's run, every public
 *   agent-made character's approved pg portrait. The second go up under the show's own handle (@botchelor), never a
 *   person's: the show promoting a public character on Botchelor, as the terms' licence lets it ("host, store, copy,
 *   show, adapt… share and promote… on Botchelor"). A character with no safe portrait gets nothing: no look is ever
 *   made up for someone else's character. Each picture or portrait once (showcase_loops).
 * - **How:** Replicate's Wan image to video (settings' `replicate_video_model`), with its own safety checker on, and a
 *   prompt that only brings the picture to life: a breath, a blink, a smile, a breeze, the camera easing in; the same
 *   clothes, place and light.
 * - **Checked before it's kept:** three frames (start, middle, end) each through the PG check, which also asks whether
 *   everyone is an adult. One that doesn't pass isn't kept; its clip is never stored.
 * - **Cost:** about $0.11 a clip at 720p (docs/after-dark.md). Admins run it; nobody is charged tokens.
 */
import type { Db } from "./db";
import { checkRating } from "./adult/moderation";
import { requestJson, withRequestLog } from "./adult/request-log";
import { adultKeys, getAdultSettings } from "./adult/settings";
import { runModel } from "./adult/replicate";
import { frameAt, videoDuration } from "./media-tools/ffmpeg";
import { keepBytes } from "./object-store";
import { checkPgPictureText } from "./safety";
import { stricter } from "./content-rating";
import { publish } from "./showcase";

/** The show's own creator page, for what it publishes itself. A reserved handle: nobody else can take it. */
export const SHOW_CREATOR = { user_id: "botchelor-show", handle: "botchelor", display_name: "Botchelor", bio: "The show itself: its cast and the characters made for it, brought to life." } as const;

/** How many are made at once: each is a minute or so of Replicate, and a batch has to fit in one request. */
export const LOOP_BATCH = 3;
/** What one clip costs on Replicate's Wan 2.2 at 720p, about (for the admin's button). */
export const LOOP_USD = 0.11;

/** Only life, nothing new: the picture as it is, moving a little. Held to the show's own PG word check (tests). */
export function loopPrompt(two: boolean): string {
  const who = two ? "The two people in the picture come" : "The person in the picture comes";
  return [
    `${who} gently to life: a slow breath, a blink, a soft natural smile, hair moving a little in a light breeze, the camera easing slowly closer.`,
    "Everything else stays exactly as it is: the same clothes, the same place, the same light.",
    "Fully clothed, calm and everyday, safe for work. Photorealistic. Everyone shown is an adult.",
  ].join(" ");
}

export type LoopTarget = { source: "post" | "portrait"; source_id: string; owner: string; character_id: string; character_b: string | null; image: string; aspect: string };

/**
 * What there is still to animate: the owner's live pg pictures, and (`agents`) every public agent-made character's
 * newest approved pg portrait. Never one already tried, whatever came of it.
 */
export async function loopTargets(db: Db, owner: string, baseUrl: string, opts: { agents?: boolean } = {}): Promise<LoopTarget[]> {
  const posts = (
    await db.query<{ id: string; character_id: string; character_b: string | null; aspect: string | null }>(
      `select p.id, p.character_id, p.character_b, p.aspect from showcase_posts p
        where p.owner_id = $1 and p.status = 'live' and not p.held and p.rating = 'pg' and p.medium = 'picture'
          and not exists (select 1 from showcase_loops l where l.source = 'post' and l.source_id = p.id)
        order by p.published_at desc nulls last`,
      [owner],
    )
  ).rows.map((p): LoopTarget => ({ source: "post", source_id: p.id, owner, character_id: p.character_id, character_b: p.character_b, image: new URL(`/api/showcase/${p.id}/media`, baseUrl).toString(), aspect: p.aspect ?? "3:4" }));
  if (!opts.agents) return posts;
  const portraits = (
    await db.query<{ character_id: string; asset_id: string }>(
      `select ch.id as character_id, a.id as asset_id from characters ch
         join lateral (select id from character_assets x where x.character_id = ch.id and x.kind = 'portrait' and x.review_status = 'approved'
                        and x.content_rating = 'pg' and x.url is not null order by x.created_at desc limit 1) a on true
        where ch.created_via = 'mcp' and ch.visibility = 'public' and not ch.is_house
          and not exists (select 1 from showcase_loops l where l.source = 'portrait' and l.source_id = a.id)
        order by ch.created_at desc`,
    )
  ).rows.map((r): LoopTarget => ({ source: "portrait", source_id: r.asset_id, owner: SHOW_CREATOR.user_id, character_id: r.character_id, character_b: null, image: new URL(`/api/assets/${r.asset_id}`, baseUrl).toString(), aspect: "3:4" }));
  return [...posts, ...portraits];
}

/** The show's creator page, there before its first post. */
async function ensureShowCreator(db: Db): Promise<void> {
  await db.query(`insert into creator_profiles (user_id, handle, display_name, bio) values ($1, $2, $3, $4) on conflict (user_id) do nothing`, [
    SHOW_CREATOR.user_id,
    SHOW_CREATOR.handle,
    SHOW_CREATOR.display_name,
    SHOW_CREATOR.bio,
  ]);
}

export type LoopResult = { ok: true; post_id: string; media_id: string } | { ok: false; error: string };

/**
 * A provider's passing trouble (2026-10-29: Replicate answered "Model not found" for its own Wan deployment, 7 times in
 * 97): the claim goes, so the next run tries it again. A safety refusal, or a frame that didn't pass, stays failed.
 */
export const RETRYABLE = /model not found|took longer|timed? ?out|too many requests|\b(429|5\d\d)\b|temporar|unavailable|econnreset|fetch failed/i;

/** One living portrait: claimed, drawn, checked frame by frame, kept, published. A failure is kept as one, never tried again. */
export async function makeLoop(db: Db, t: LoopTarget): Promise<LoopResult> {
  const id = crypto.randomUUID();
  const claimed = await db.query(`insert into showcase_loops (id, owner_id, source, source_id, character_id) values ($1, $2, $3, $4, $5) on conflict (source, source_id) do nothing returning id`, [
    id,
    t.owner,
    t.source,
    t.source_id,
    t.character_id,
  ]);
  if (!claimed.rows.length) return { ok: false, error: "already tried" };
  const fail = async (error: string): Promise<LoopResult> => {
    if (RETRYABLE.test(error)) await db.query(`delete from showcase_loops where id = $1`, [id]);
    else await db.query(`update showcase_loops set status = 'failed', error = $2 where id = $1`, [id, error.slice(0, 300)]);
    return { ok: false, error };
  };
  try {
    const keys = await adultKeys(db);
    if (!keys.replicate) return fail("no Replicate key in After Dark's settings");
    const model = (await getAdultSettings(db)).replicate_video_model;
    const prompt = loopPrompt(Boolean(t.character_b));
    // Replicate's own safety checker stays on (never disable_safety_checker): this is for the side everyone sees.
    const made = await withRequestLog(() =>
      runModel(keys.replicate!, model, { prompt, image: t.image, num_frames: 81, resolution: "720p", frames_per_second: 16, go_fast: true }, { maxBytes: 40 * 1024 * 1024, wait: 60, timeoutMs: 230_000, cancelAfter: "5m" }),
    );
    const file = made.value;
    if (!file.mime.startsWith("video/")) return fail(`Replicate returned ${file.mime}, not a video`);
    // Three frames, each through the PG check (and its age question): the start, the middle, the end.
    const seconds = await videoDuration(file.bytes);
    let rating: "pg" | "suggestive" = "pg";
    for (const at of [0.1, seconds / 2, "end" as const]) {
      const frame = await frameAt(file.bytes, at);
      const v = await checkRating(db, { base64: frame.png.toString("base64"), mime: "image/png" });
      if (!v.ok) return fail(`a frame didn't pass: ${v.reason}`);
      rating = stricter(rating, v.rating) as "pg" | "suggestive";
    }
    const kept = await keepBytes("after-dark", id, file.bytes, "video/mp4");
    await db.query(
      `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, object_key, status, provider, model, aspect, content_rating, request)
       values ($1, $2, $3, $4, 'video', $5, 'video/mp4', $6, $7, 'ready', 'replicate', $8, $9, $10, $11::jsonb)`,
      [id, t.owner, t.character_id, t.character_b, prompt, kept.data, kept.object_key, model, t.aspect, rating, requestJson(made.requests)],
    );
    let postId: string;
    if (t.source === "post") {
      // The creator's own: published as any of their posts is, every rule of publish() holding.
      const r = await publish(db, t.owner, { source: "after_dark", media_id: id });
      if (!r.ok) return fail(`kept, not published: ${r.message}`);
      postId = r.post_id;
    } else {
      await ensureShowCreator(db);
      postId = crypto.randomUUID();
      await db.query(
        `insert into showcase_posts (id, owner_id, source, media_id, character_id, character_b, rating, medium, aspect, status, published_at, tags)
         values ($1, $2, 'after_dark', $3, $4, null, $5, 'clip', $6, 'live', now(), '[]'::jsonb)`,
        [postId, t.owner, id, t.character_id, rating, t.aspect],
      );
    }
    await db.query(`update showcase_loops set status = 'ready', media_id = $2, post_id = $3 where id = $1`, [id, id, postId]);
    return { ok: true, post_id: postId, media_id: id };
  } catch (err) {
    return fail(err instanceof Error ? err.message : "error");
  }
}

/** The next few living portraits, made together. `left`: how many are still to try after these. */
export async function loopBatch(db: Db, owner: string, baseUrl: string, opts: { agents?: boolean } = {}): Promise<{ ok: true; made: string[]; failed: { source_id: string; error: string }[]; left: number }> {
  const todo = await loopTargets(db, owner, baseUrl, opts);
  const batch = todo.slice(0, LOOP_BATCH);
  const results = await Promise.all(batch.map((t) => makeLoop(db, t)));
  const made: string[] = [];
  const failed: { source_id: string; error: string }[] = [];
  results.forEach((r, i) => (r.ok ? made.push(r.post_id) : failed.push({ source_id: batch[i].source_id, error: r.error })));
  return { ok: true, made, failed, left: todo.length - batch.length };
}

/** For the tests: the prompt is held to the show's own lines. */
export const loopPromptPasses = (two: boolean): boolean => checkPgPictureText({ prompt: loopPrompt(two) }).ok;
