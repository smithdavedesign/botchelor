import { isSignedInAdmin } from "@/lib/admins";
import { CLIP_TOKEN_COST, episodeAllowance, refundBoughtTokens, spendBoughtTokens } from "@/lib/allowance";
import { approvedPortraitId, getApprovedAsset, latestClip, recordAsset, reviewAsset, setAssetMedia } from "@/lib/assets";
import { jobUsability, recordJobFailure, recordJobSpend } from "@/lib/connections";
import { getDb, type Db } from "@/lib/db";
import { handle, json, readJson, session } from "@/lib/http";
import { DEFAULT_PORTRAIT_STYLE, isPortraitStyle } from "@/lib/image";
import { userVideoKey } from "@/lib/keys";
import { ownsCharacter } from "@/lib/souls";
import { CLIP_PROMPT_VERSION_VEO, CLIP_PROVIDER_COST_USD, downloadVeoClip, pollVeoClip, startVeoClip, VideoError } from "@/lib/video";

type Ctx = { params: Promise<{ id: string }> };
type Row = { name: string; age: number; bio: string; traits: string[]; appearance: string | null; pronouns: string | null };

/** Gives a failed clip's tokens back, exactly once. */
async function refund(db: Db, assetId: string, userId: string): Promise<void> {
  const { rows } = await db.query<{ tokens_spent: number }>(
    `update character_assets a set tokens_spent = 0 from (select tokens_spent from character_assets where id = $1) prev
      where a.id = $1 and a.tokens_spent > 0 returning prev.tokens_spent`,
    [assetId],
  );
  if (rows[0]?.tokens_spent) await refundBoughtTokens(db, userId, rows[0].tokens_spent);
}

/**
 * Start a 4-second intro clip for your own character: Veo 3.1 Lite on your own Google key (lib/video.ts), which
 * pays Google (~$0.20 a clip). It costs CLIP_TOKEN_COST bought token(s) — the clip paywall — except for admins.
 * The starting frame is the character's approved portrait when it has one. Returns right away; poll GET.
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  if (!(await ownsCharacter(db, id, sess.userId))) return json({ error: "character_not_found" }, 404, sess);
  // At the month's cap (Connections M3), clips wait: Veo has no free tier to stand in.
  const usable = await jobUsability(db, sess.userId, "video");
  if (usable.state === "over_cap" || usable.state === "failing") {
    return json({ error: usable.state === "over_cap" ? "over_cap" : "key_paused", message: usable.message, connect: "/account/keys#clips" }, 409, sess);
  }
  const apiKey = await userVideoKey(db, sess.userId);
  if (!apiKey) {
    return json(
      {
        error: "no_video_key",
        message: "Connect a Google key for Intro clips first (Account → Connections; AI Studio, with billing on): clips run on Veo, on your Google bill.",
        connect: "/account/keys#clips",
      },
      400,
      sess,
    );
  }

  const character = (await db.query<Row>(`select name, age, bio, traits, appearance, pronouns from characters where id = $1`, [id])).rows[0];
  if (!character) return json({ error: "character_not_found" }, 404, sess);

  // Baseline-still gate: Veo drifts badly without an image anchor (an anime character drifts to a generic
  // anime), so require an approved portrait first. The portrait page already lets the owner generate and
  // regenerate on their own key before committing to the clip, so there's no reason to spend clip tokens
  // on a text-only generation that is unlikely to match the character.
  const portraitId = await approvedPortraitId(db, id);
  if (!portraitId) {
    return json(
      {
        error: "needs_portrait",
        message: "Approve a portrait first — the clip's first frame starts from it. Without a portrait Veo drifts to a generic look.",
      },
      409,
      sess,
    );
  }

  // Optional { style } body: carried through to Veo so the clip prompt matches the portrait the user picked.
  // Unknown values fall back to the default (illustrated) rather than refusing.
  const bodyIn = (await readJson(req).catch(() => null)) as { style?: unknown } | null;
  const style = isPortraitStyle(bodyIn?.style) ? bodyIn.style : DEFAULT_PORTRAIT_STYLE;

  // The paywall: bought tokens, spent before the job starts so two clicks can't share one. Admins skip it.
  const admin = await isSignedInAdmin(db, sess);
  const cost = admin ? 0 : CLIP_TOKEN_COST;
  if (cost > 0 && !(await spendBoughtTokens(db, sess.userId, cost))) {
    const left = (await episodeAllowance(db, sess.userId)).pack_left;
    return json(
      {
        error: "needs_tokens",
        message: `A clip costs ${cost} bought token${cost === 1 ? "" : "s"} (you have ${left}). Get 5 more on the Tokens page.`,
        shop: "/shop",
        bought_tokens: left,
      },
      402,
      sess,
    );
  }

  const portrait = (await getApprovedAsset(db, portraitId))?.url ?? null;
  let job;
  try {
    job = await startVeoClip(apiKey, character, portrait, undefined, style);
  } catch (err) {
    if (cost > 0) await refundBoughtTokens(db, sess.userId, cost);
    const message = err instanceof VideoError ? err.message : "Google couldn't start the clip.";
    await recordJobFailure(db, sess.userId, "video", "google", message);
    return json({ error: "generation_failed", message }, 502, sess);
  }
  // Recorded pending (not servable). The operation name goes in source_url so the status poll finds it.
  const assetId = await recordAsset(db, {
    character_id: id,
    kind: "clip",
    source_type: "generated",
    source_model: `google:${job.model}`,
    prompt: job.prompt,
    prompt_version: CLIP_PROMPT_VERSION_VEO,
    source_url: job.operation,
  });
  if (cost > 0) await db.query(`update character_assets set tokens_spent = $2 where id = $1`, [assetId, cost]);
  return json({ asset_id: assetId, status: "rendering", tokens_spent: cost, admin }, 202, sess);
});

/**
 * Poll the owner's newest clip. While Google renders it, "rendering"; when it's done, the MP4 is downloaded and
 * stored (Google keeps it only two days) and the asset approved (provider-moderated), so it plays on the card.
 * A blocked or failed clip is rejected and its tokens refunded.
 */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  if (!(await ownsCharacter(db, id, sess.userId))) return json({ error: "character_not_found" }, 404, sess);

  const clip = await latestClip(db, id);
  if (!clip) return json({ status: "none" }, 200, sess);
  if (clip.review_status === "approved") return json({ status: "ready", video_path: `/api/assets/${clip.id}/video` }, 200, sess);
  if (clip.review_status === "rejected") return json({ status: "failed", message: "Google couldn't make this clip." }, 200, sess);

  const fail = async (message: string) => {
    await reviewAsset(db, clip.id, "rejected", message.slice(0, 200));
    await refund(db, clip.id, sess.userId);
    return json({ status: "failed", message, refunded: true }, 200, sess);
  };
  // A clip started on the old provider (Sora, retired) can never finish.
  if (!clip.source_url?.startsWith("models/")) return fail("This clip was started on a video model that's since been retired.");

  const apiKey = await userVideoKey(db, sess.userId);
  if (!apiKey) return json({ status: "rendering" }, 200, sess);
  let state;
  try {
    state = await pollVeoClip(apiKey, clip.source_url);
  } catch {
    return json({ status: "rendering" }, 200, sess);
  }
  if (state.status === "failed") return fail(state.reason);
  if (state.status === "rendering") return json({ status: "rendering" }, 200, sess);

  try {
    const video = await downloadVeoClip(apiKey, state.videoUri);
    await setAssetMedia(db, clip.id, video);
    await reviewAsset(db, clip.id, "approved", "byok: Veo (Google-moderated) from filtered sheet text and an approved portrait");
    // Google bills a clip it made (a filtered one isn't): its list price goes on the key's month (Connections M3).
    await recordJobSpend(db, sess.userId, "video", "google", CLIP_PROVIDER_COST_USD);
    return json({ status: "ready", video_path: `/api/assets/${clip.id}/video` }, 200, sess);
  } catch (err) {
    if (err instanceof VideoError && /empty|too large|host/i.test(err.message)) return fail(err.message);
    return json({ status: "rendering" }, 200, sess); // a download blip: poll again
  }
});
