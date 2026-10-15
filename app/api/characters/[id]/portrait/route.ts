import { recordAsset, reviewAsset } from "@/lib/assets";
import { getDb } from "@/lib/db";
import { handle, json, session } from "@/lib/http";
import { PROMPT_VERSION, generatePortrait } from "@/lib/image";
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

  const key = await userImageKey(db, sess.userId);
  const generates = key && key.provider in IMAGE_PROVIDERS && IMAGE_PROVIDERS[key.provider as keyof typeof IMAGE_PROVIDERS].generates;
  if (!key || !generates) {
    return json({ error: "no_image_key", message: "Add an OpenAI image key on your account first, then generate a portrait." }, 400, sess);
  }

  const character = (await db.query<Row>(`select name, age, bio, traits, appearance, pronouns from characters where id = $1`, [id])).rows[0];
  if (!character) return json({ error: "character_not_found" }, 404, sess);

  let portrait;
  try {
    portrait = await generatePortrait(key.apiKey, character, key.model ?? undefined);
  } catch (err) {
    return json({ error: "generation_failed", message: err instanceof Error ? err.message : "The image couldn't be generated." }, 502, sess);
  }

  const assetId = await recordAsset(db, {
    character_id: id,
    kind: "portrait",
    source_type: "generated",
    source_model: `openai:${portrait.model}`,
    prompt: portrait.prompt,
    prompt_version: PROMPT_VERSION,
    url: portrait.dataUrl,
  });
  // Provider-moderated generation from already-filtered text: approve so the owner sees it. Reportable as ever.
  await reviewAsset(db, assetId, "approved", "byok: provider-moderated generation from filtered sheet text");
  return json({ asset_id: assetId, portrait_path: `/api/assets/${assetId}` }, 201, sess);
});
