import { recordAsset, reviewAsset } from "@/lib/assets";
import { jobUsability, recordJobFailure, recordJobSpend } from "@/lib/connections";
import { PORTRAIT_ESTIMATE_USD } from "@/lib/connections-shared";
import { getDb } from "@/lib/db";
import { handle, json, readJson, session } from "@/lib/http";
import { DEFAULT_PORTRAIT_STYLE, imageModelFor, isPortraitStyle, PROMPT_VERSION, generatePortrait } from "@/lib/image";
import { IMAGE_PROVIDERS, userImageKey } from "@/lib/keys";
import { ownsCharacter } from "@/lib/souls";

type Ctx = { params: Promise<{ id: string }> };
type Row = { name: string; age: number; bio: string; traits: string[]; appearance: string | null; pronouns: string | null };

/**
 * Generate a portrait for your own character on your own image key (BYOK, M16). Owner-only. Needs a saved
 * image key for a provider that generates (OpenAI). The provider moderates the image, and the prompt is built
 * only from the character's already content-filtered sheet, so nothing unsafe can be steered in. The result
 * is recorded in the asset ledger and approved (provider-moderated); it renders as the character's avatar and
 * stays reportable like everything else. The user pays, so it costs us nothing.
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  if (!(await ownsCharacter(db, id, sess.userId))) return json({ error: "character_not_found" }, 404, sess);

  // At the month's cap (Connections M3), portraits wait: there's no free model to stand in for them.
  const usable = await jobUsability(db, sess.userId, "image");
  if (usable.state === "over_cap" || usable.state === "failing") {
    return json({ error: usable.state === "over_cap" ? "over_cap" : "key_paused", message: usable.message, connect: "/account/keys#portraits" }, 409, sess);
  }
  const key = await userImageKey(db, sess.userId);
  const generates = key && key.provider in IMAGE_PROVIDERS && IMAGE_PROVIDERS[key.provider as keyof typeof IMAGE_PROVIDERS].generates;
  if (!key || !generates) {
    return json(
      { error: "no_image_key", message: "Connect an OpenAI key for Portraits first (Account → Connections), then generate a portrait.", connect: "/account/keys#portraits" },
      400,
      sess,
    );
  }

  const character = (await db.query<Row>(`select name, age, bio, traits, appearance, pronouns from characters where id = $1`, [id])).rows[0];
  if (!character) return json({ error: "character_not_found" }, 404, sess);

  // Optional { style } body: anime, semi_real, photoreal or illustrated (default). Unknown values fall back to
  // the default so a bad client input is a soft miss, not a 400. GET has no body, so a bare POST still works.
  const body = (await readJson(req).catch(() => null)) as { style?: unknown } | null;
  const style = isPortraitStyle(body?.style) ? body.style : DEFAULT_PORTRAIT_STYLE;

  let portrait;
  try {
    portrait = await generatePortrait(key.apiKey, character, imageModelFor(key.model), undefined, style);
  } catch (err) {
    const message = err instanceof Error ? err.message : "The image couldn't be generated.";
    await recordJobFailure(db, sess.userId, "image", key.provider, message);
    return json({ error: "generation_failed", message }, 502, sess);
  }
  await recordJobSpend(db, sess.userId, "image", key.provider, PORTRAIT_ESTIMATE_USD);

  const assetId = await recordAsset(db, {
    character_id: id,
    kind: "portrait",
    source_type: "generated",
    source_model: `openai:${portrait.model}`,
    prompt: portrait.prompt,
    prompt_version: PROMPT_VERSION,
    url: portrait.dataUrl,
    // OpenAI's own moderation refuses explicit pictures.
    content_rating: "pg",
  });
  // Provider-moderated generation from already-filtered text: approve so the owner sees it. Reportable as ever.
  await reviewAsset(db, assetId, "approved", "byok: provider-moderated generation from filtered sheet text");
  return json({ asset_id: assetId, portrait_path: `/api/assets/${assetId}` }, 201, sess);
});
