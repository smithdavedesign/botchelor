import { z } from "zod";
import { MODEL_ID } from "./replicate";
import { MEDIA_PROVIDERS, PROMPT_VERSIONS, VOICE_MODELS } from "./settings";
import { USAGE_KINDS } from "./usage";

/** A Replicate model (owner/name, or owner/name:version), or "" for the default. */
const replicateModel = z.string().trim().max(160).refine((v) => v === "" || MODEL_ID.test(v), "a Replicate model: owner/name, or owner/name:version");
/** Wan's LoRA: one https URL (for both its transformers), or two (high noise, then low), or "" for none. */
const videoLora = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => v === "" || (v.split(/[\s,]+/).length <= 2 && v.split(/[\s,]+/).every((u) => /^https:\/\/\S+$/.test(u))), "one or two https URLs");

/** What POST /api/admin/after-dark/settings takes, and after_dark_settings over MCP less the keys (lib/adult/mcp.ts). */
export const AdultSettingsInput = z.object({
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
  included_clips: z.number().int().min(0).max(50).optional(),
  menu_picture_tokens: z.number().int().min(0).max(100).optional(),
  chapter_tokens: z.number().int().min(0).max(100).optional(),
  pictures_per_chapter: z.number().int().min(0).max(10).optional(),
  media_provider: z.enum(MEDIA_PROVIDERS).optional(),
  replicate_key: z.string().max(400).optional(),
  replicate_picture_model: replicateModel.optional(),
  replicate_keyframe_model: replicateModel.optional(),
  replicate_video_model: replicateModel.optional(),
  replicate_voice_model: replicateModel.optional(),
  voice_model: z.enum(VOICE_MODELS).optional(),
  presence_loop_model: z.string().trim().max(120).regex(/^$|^[a-z0-9][a-z0-9._-]*$/i).optional(),
  place_sounds: z.boolean().optional(),
  draw_ahead: z.boolean().optional(),
  draw_ahead_tokens: z.number().int().min(0).max(20).optional(),
  draw_ahead_pictures: z.number().int().min(0).max(10).optional(),
  place_sound_model: z.string().trim().max(120).regex(/^$|^[a-z0-9][a-z0-9._-]*$/i).optional(),
  talk_model: z.string().trim().max(120).regex(/^$|^[a-z0-9][a-z0-9._-]*$/i).optional(),
  replicate_video_lora: videoLora.optional(),
  auto_scene_pictures: z.boolean().optional(),
  beat_pictures: z.boolean().optional(),
  media_fallback: z.boolean().optional(),
  // The Studio's settings (lib/adult/studio-config.ts validates every value on save), and the monthly caps.
  studio: z.record(z.string().max(40), z.unknown()).optional(),
  // The scene writers people can pick, and the default (lib/adult/writer-config.ts validates on save).
  writer: z.record(z.string().max(40), z.unknown()).optional(),
  // Which checker checks (lib/adult/moderation-config.ts validates on save), and the alternatives' keys ("" removes one).
  moderation: z.record(z.string().max(40), z.unknown()).optional(),
  sightengine_key: z.string().max(400).optional(),
  moderation_endpoint_key: z.string().max(400).optional(),
  caps: z.object(Object.fromEntries(USAGE_KINDS.map((k) => [k, z.number().int().min(0).max(1_000_000).optional()]))).strict().optional(),
});

/** The provider keys: set only on the settings page, never over MCP. */
export const SETTINGS_KEY_FIELDS = ["openrouter_key", "fal_key", "hive_key", "venice_key", "replicate_key", "sightengine_key", "moderation_endpoint_key"] as const;
