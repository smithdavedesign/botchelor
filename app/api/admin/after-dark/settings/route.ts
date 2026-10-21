import { z } from "zod";
import { signedInAdmin } from "@/lib/adult/mode";
import { getAdultSettings, PROMPT_VERSIONS, saveAdultSettings } from "@/lib/adult/settings";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";

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
