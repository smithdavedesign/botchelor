/**
 * The output check's settings (lib/adult/moderation.ts; docs/PRDs/studio.md section 9): which checker checks, in
 * adult_settings.moderation. Client-safe and pure: the settings page shares it.
 */
import { z } from "zod";

export const MODERATION_MODES = ["hive", "hive_then_alt", "both", "alt"] as const;
export type ModerationMode = (typeof MODERATION_MODES)[number];
export const ALT_CHECKERS = ["venice_vlm", "sightengine", "endpoint"] as const;
export type AltChecker = (typeof ALT_CHECKERS)[number];
export const ADMIN_CHECKERS = ["alt", "same"] as const;
export type AdminChecker = (typeof ADMIN_CHECKERS)[number];
/** Who checks an admin's own pictures when the setting is left unset (lib/adult/moderation.ts adminCheckerOf). */
export const DEFAULT_ADMIN_CHECKER: AdminChecker = "alt";

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
  /**
   * Who checks the show's own pictures: "auto" (the default since the audit of 2026-10-29: Hive's 100 a day ran out, and
   * the show's backdrops and portraits spent them) the alternatives when one is ready, else Hive; or one of them always.
   */
  pg_via: z.enum(["auto", "hive", "alt"]).default("auto"),
  /**
   * An admin's own pictures (David, 2026-10-24: "can we turn hive off as admin? … set it on production so I'm not hive
   * blocked"): "alt" checks them with the alternatives instead of Hive (the Venice vision model's age question: no daily
   * cap), whatever `mode` says for everyone else; "same" holds them to `mode`. Unset: DEFAULT_ADMIN_CHECKER ("alt"). A
   * picture is never kept unchecked, and videos stay Hive's (the alternatives don't read video).
   */
  admin_checker: z.enum(ADMIN_CHECKERS).optional(),
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
