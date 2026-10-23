import { z } from "zod";
import { signedInAdmin } from "@/lib/adult/mode";
import { MODEL_ID } from "@/lib/adult/replicate";
import { getAdultSettings, MEDIA_PROVIDERS, PROMPT_VERSIONS, saveAdultSettings } from "@/lib/adult/settings";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";

/** A Replicate model (owner/name, or owner/name:version), or "" for the default. */
const replicateModel = z.string().trim().max(160).refine((v) => v === "" || MODEL_ID.test(v), "a Replicate model: owner/name, or owner/name:version");
/** Wan's LoRA: one https URL (for both its transformers), or two (high noise, then low), or "" for none. */
const videoLora = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => v === "" || (v.split(/[\s,]+/).length <= 2 && v.split(/[\s,]+/).every((u) => /^https:\/\/\S+$/.test(u))), "one or two https URLs");

const Input = z.object({
  enabled: z.boolean().optional(),
  text_model: z.string().max(120).optional(),
  // The scene writer's sampling (null: back to the default); OpenRouter's ranges.
  text_temperature: z.number().min(0).max(2).nullable().optional(),
  frequency_penalty: z.number().min(-2).max(2).nullable().optional(),
  presence_penalty: z.number().min(-2).max(2).nullable().optional(),
  repetition_penalty: z.number().min(0).max(2).nullable().optional(),
  prompt_version: z.enum(PROMPT_VERSIONS).optional(),
  image_model: z.string().max(120).optional(),
  video_model: z.string().max(120).optional(),
  image_base: z.string().max(160).optional(),
  openrouter_key: z.string().max(400).optional(),
  fal_key: z.string().max(400).optional(),
  hive_key: z.string().max(400).optional(),
  venice_key: z.string().max(400).optional(),
  image_provider: z.enum(["fal", "venice"]).optional(),
  venice_image_model: z.string().max(120).optional(),
  reel_model: z.string().max(120).optional(),
  reel_shots: z.number().int().min(2).max(12).optional(),
  reel_tokens: z.number().int().min(0).max(500).optional(),
  clip_tokens: z.number().int().min(0).max(100).optional(),
  menu_picture_tokens: z.number().int().min(0).max(100).optional(),
  media_provider: z.enum(MEDIA_PROVIDERS).optional(),
  replicate_key: z.string().max(400).optional(),
  replicate_picture_model: replicateModel.optional(),
  replicate_keyframe_model: replicateModel.optional(),
  replicate_video_model: replicateModel.optional(),
  replicate_voice_model: replicateModel.optional(),
  replicate_video_lora: videoLora.optional(),
});

/** After dark's settings: a signed-in admin only, even while it's off (that's where it's turned on). */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  if (!(await signedInAdmin(db, authFromRequest(req)))) return json({ error: "not_found" }, 404);
  const requests = (await db.query(`select id, agent_id, client_name, reason, created_at from adult_access_requests order by created_at desc limit 50`)).rows;
  return json({ settings: await getAdultSettings(db), requests });
});

export const POST = handle(async (req: Request) => {
  const db = await getDb();
  if (!(await signedInAdmin(db, authFromRequest(req)))) return json({ error: "not_found" }, 404);
  const input = parseBody(Input, await readJson(req), "invalid_settings");
  return json({ settings: await saveAdultSettings(db, input) });
});
