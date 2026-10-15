import { latestClip, recordAsset, reviewAsset, setAssetMedia } from "@/lib/assets";
import { getDb } from "@/lib/db";
import { handle, json, session } from "@/lib/http";
import { CLIP_PROMPT_VERSION, createVideoJob, fetchVideoThumbnail, pollVideoJob } from "@/lib/image";
import { IMAGE_PROVIDERS, userImageKey } from "@/lib/keys";
import { ownsCharacter } from "@/lib/souls";

type Ctx = { params: Promise<{ id: string }> };
type Row = { name: string; age: number; bio: string; traits: string[]; appearance: string | null; pronouns: string | null };

async function ownerKey(db: Awaited<ReturnType<typeof getDb>>, userId: string) {
  const key = await userImageKey(db, userId);
  const generates = key && key.provider in IMAGE_PROVIDERS && IMAGE_PROVIDERS[key.provider as keyof typeof IMAGE_PROVIDERS].generates;
  return key && generates ? key : null;
}

/**
 * Start a short video clip for your own character on your own key (BYOK, M16). Owner-only; needs a saved
 * OpenAI image key (OpenAI generates and moderates video too). The prompt is built only from the character's
 * already content-filtered sheet. The user pays, so it's $0 to us. Returns right away; poll GET for status.
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  if (!(await ownsCharacter(db, id, sess.userId))) return json({ error: "character_not_found" }, 404, sess);
  const key = await ownerKey(db, sess.userId);
  if (!key) return json({ error: "no_image_key", message: "Add an OpenAI image key on your account first, then make a clip." }, 400, sess);

  const character = (await db.query<Row>(`select name, age, bio, traits, appearance, pronouns from characters where id = $1`, [id])).rows[0];
  if (!character) return json({ error: "character_not_found" }, 404, sess);

  let job;
  try {
    job = await createVideoJob(key.apiKey, character);
  } catch (err) {
    return json({ error: "generation_failed", message: err instanceof Error ? err.message : "The clip couldn't be started." }, 502, sess);
  }
  // Recorded pending (not servable). The video id goes in source_url so the status poll and the proxy find it.
  const assetId = await recordAsset(db, {
    character_id: id,
    kind: "clip",
    source_type: "generated",
    source_model: `openai:${job.model}`,
    prompt: job.prompt,
    prompt_version: CLIP_PROMPT_VERSION,
    source_url: job.id,
  });
  return json({ asset_id: assetId, status: "rendering" }, 202, sess);
});

/**
 * Poll the owner's newest clip. While the provider renders it, returns "rendering"; when it completes, the
 * thumbnail is stored as the durable poster and the asset is approved (provider-moderated), so it shows on
 * the card; a blocked or failed render is rejected.
 */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  if (!(await ownsCharacter(db, id, sess.userId))) return json({ error: "character_not_found" }, 404, sess);

  const clip = await latestClip(db, id);
  if (!clip) return json({ status: "none" }, 200, sess);
  if (clip.review_status === "approved") return json({ status: "ready", poster_path: `/api/assets/${clip.id}`, video_path: `/api/assets/${clip.id}/video` }, 200, sess);
  if (clip.review_status === "rejected") return json({ status: "failed", message: "The provider couldn't make this clip." }, 200, sess);

  const key = await ownerKey(db, sess.userId);
  if (!key || !clip.source_url) return json({ status: "rendering" }, 200, sess);
  let state;
  try {
    state = await pollVideoJob(key.apiKey, clip.source_url);
  } catch {
    return json({ status: "rendering" }, 200, sess);
  }
  if (state.status === "failed") {
    await reviewAsset(db, clip.id, "rejected", "provider render failed");
    return json({ status: "failed" }, 200, sess);
  }
  if (state.status !== "completed") return json({ status: "rendering", progress: state.progress }, 200, sess);

  // Completed: store the thumbnail as the durable poster, then approve so it's servable and visible.
  try {
    const poster = await fetchVideoThumbnail(key.apiKey, clip.source_url);
    await setAssetMedia(db, clip.id, poster, clip.source_url);
    await reviewAsset(db, clip.id, "approved", "byok: provider-moderated video from filtered sheet text");
    return json({ status: "ready", poster_path: `/api/assets/${clip.id}`, video_path: `/api/assets/${clip.id}/video` }, 200, sess);
  } catch {
    return json({ status: "rendering" }, 200, sess); // thumbnail not ready yet; poll again
  }
});
