/**
 * The output check's settings (lib/adult/moderation.ts; docs/PRDs/studio.md section 9): which checker checks, in
 * adult_settings.moderation. Client-safe and pure: the settings page shares it.
 */
import { z } from "zod";

export const MODERATION_MODES = ["hive", "hive_then_alt", "both", "alt"] as const;
export type ModerationMode = (typeof MODERATION_MODES)[number];
export const ALT_CHECKERS = ["venice_vlm", "sightengine", "endpoint"] as const;
export type AltChecker = (typeof ALT_CHECKERS)[number];

export const ModerationConfig = z.object({
  mode: z.enum(MODERATION_MODES).default("hive"),
  alts: z.array(z.enum(ALT_CHECKERS)).max(3).default(["venice_vlm"]),
  min_sources: z.number().int().min(1).max(3).default(1),
  vlm_model: z.string().trim().min(1).max(120).default("qwen3-vl-235b-a22b"),
  sightengine_user: z.string().trim().max(80).nullable().default(null),
  sightengine_minor_max: z.number().min(0).max(1).default(0.1),
  endpoint_url: z
    .string()
    .trim()
    .max(300)
    .refine((v) => /^https:\/\/\S+$/.test(v), "an https URL")
    .nullable()
    .default(null),
  pg_via: z.enum(["hive", "alt"]).default("hive"),
});
export type ModerationConfig = z.infer<typeof ModerationConfig>;
export const DEFAULT_MODERATION: ModerationConfig = ModerationConfig.parse({});

/** The stored JSON as settings, defaults filled in; what doesn't parse falls back to its default, key by key. */
export function moderationConfigOf(raw: unknown): ModerationConfig {
  const r = ModerationConfig.safeParse(raw ?? {});
  if (r.success) return r.data;
  const out: Record<string, unknown> = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const one = ModerationConfig.safeParse({ [k]: v });
      if (one.success) out[k] = (one.data as Record<string, unknown>)[k];
    }
  }
  return ModerationConfig.parse(out);
}

/** A save: the stored config with these keys replaced. Throws on a bad value. */
export function mergeModerationConfig(current: ModerationConfig, patch: Record<string, unknown>): ModerationConfig {
  return ModerationConfig.parse({ ...current, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) });
}
