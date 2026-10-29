/**
 * The Studio's settings (docs/PRDs/studio.md section 11; David, 2026-10-24: "everything should be configurable"). One
 * JSON object in adult_settings.studio, read with every default filled in, so a setting never saved is its default and a
 * partial save changes only what it names. Prices are in bought tokens (5 for $4, lib/catalog.ts PACK_5): the field
 * prices a picture at about $0.08–0.40, so a shoot of four costs one token on a standard model, two on a pro one.
 * Client-safe: no server imports (the settings page shares it).
 */
import { z } from "zod";

/** Who may open the Studio: admins only (the default, until payments and age checks are live), or everyone After Dark is open to. */
export const STUDIO_OPEN_TO = ["admins", "entitled"] as const;
export type StudioOpenTo = (typeof STUDIO_OPEN_TO)[number];

/** A model the Studio offers: who runs it, what it does (an edit keeps the face; a new picture draws one), its tier. */
export const StudioModel = z.object({
  id: z.string().trim().min(1).max(120),
  provider: z.enum(["venice", "replicate"]),
  job: z.enum(["edit", "new"]),
  tier: z.enum(["standard", "pro"]),
  label: z.string().trim().min(1).max(60),
  /** Venice's own ("private") or a third party's through Venice ("anonymized"); Replicate's are its own. */
  runner: z.enum(["venice", "third_party", "replicate"]),
  /** How many pictures an edit model takes (face, body, the place): Venice lists it per model. */
  max_images: z.number().int().min(1).max(10).default(3),
  note: z.string().max(120).default(""),
  /** About what one picture costs on the provider, in USD: what's added to someone's own key's month (Connections' cap). */
  usd: z.number().min(0).max(10).default(0.04),
});
export type StudioModel = z.infer<typeof StudioModel>;

/** The list on the picker by default (Venice's prices and limits on 2026-10-24: docs/PRDs/studio.md section 7). */
export const DEFAULT_STUDIO_MODELS: StudioModel[] = [
  { id: "qwen-edit-uncensored", provider: "venice", job: "edit", tier: "standard", label: "Qwen Edit", runner: "venice", max_images: 3, note: "keeps the face; the default", usd: 0.04 },
  { id: "qwen-image-2-1-turbo-edit", provider: "venice", job: "edit", tier: "standard", label: "Qwen Turbo Edit", runner: "third_party", max_images: 6, note: "fast", usd: 0.02 },
  { id: "qwen-image-2-1-pro-edit", provider: "venice", job: "edit", tier: "pro", label: "Qwen Pro Edit", runner: "third_party", max_images: 10, note: "up to 10 references", usd: 0.05 },
  { id: "seedream-v5-pro-edit", provider: "venice", job: "edit", tier: "pro", label: "Seedream Pro Edit", runner: "third_party", max_images: 6, note: "fine detail", usd: 0.06 },
  { id: "qwen/qwen-image-edit-2511", provider: "replicate", job: "edit", tier: "standard", label: "Qwen Edit (Replicate)", runner: "replicate", max_images: 3, note: "the backup", usd: 0.03 },
  { id: "lustify-v8", provider: "venice", job: "new", tier: "standard", label: "Lustify", runner: "venice", max_images: 1, note: "photoreal; the default for a new face", usd: 0.01 },
  { id: "chroma", provider: "venice", job: "new", tier: "standard", label: "Chroma", runner: "venice", max_images: 1, note: "", usd: 0.01 },
  { id: "qwen-image-3", provider: "venice", job: "new", tier: "pro", label: "Qwen Image 3", runner: "third_party", max_images: 1, note: "", usd: 0.04 },
  { id: "qwen/qwen-image", provider: "replicate", job: "new", tier: "standard", label: "Qwen Image (Replicate)", runner: "replicate", max_images: 1, note: "the backup", usd: 0.025 },
];

const tiers = z.object({ standard: z.number().int().min(0).max(100), pro: z.number().int().min(0).max(100) });

/** Every Studio setting, with its default. */
export const StudioConfig = z.object({
  open_to: z.enum(STUDIO_OPEN_TO).default("admins"),
  /** Pictures a shoot makes, and candidates a restyle, a recast and a body reference make. */
  shoot_size: z.number().int().min(1).max(4).default(4),
  /**
   * The bigger shoots on offer too (the creator suite): drawn four at a time after the answer, the price of four for each
   * four and the fifth four free (shootPrice: 8 for 2 tokens, 12 for 3, 20 for 4).
   */
  shoot_sizes: z.array(z.number().int().min(1).max(40)).max(6).default([8, 12, 20]),
  restyle_candidates: z.number().int().min(1).max(4).default(3),
  recast_candidates: z.number().int().min(1).max(4).default(3),
  body_candidates: z.number().int().min(1).max(4).default(2),
  prices: z
    .object({
      shoot: tiers.default({ standard: 1, pro: 2 }),
      pair: tiers.default({ standard: 1, pro: 2 }),
      restyle: z.number().int().min(0).max(100).default(1),
      recast: z.number().int().min(0).max(100).default(1),
      body: z.number().int().min(0).max(100).default(1),
      variations: z.number().int().min(0).max(100).default(1),
      upscale: z.number().int().min(0).max(100).default(0),
      /** The identity pack's eight views (the creator suite): fewer, a redraw, cost their share of it. */
      identity: z.number().int().min(0).max(100).default(2),
      /** A carousel: one picture's moment from six angles (the creator suite). */
      carousel: z.number().int().min(0).max(100).default(1),
      /** An SFW twin: a picture made again safe for work (lib/adult/sfw-twin.ts). */
      sfw_twin: z.number().int().min(0).max(100).default(1),
      animate_5: z.number().int().min(0).max(100).default(3),
      animate_10: z.number().int().min(0).max(100).default(5),
      own_key: z.number().int().min(0).max(100).default(0),
      share: z.number().int().min(0).max(100).default(0),
    })
    .default({ shoot: { standard: 1, pro: 2 }, pair: { standard: 1, pro: 2 }, restyle: 1, recast: 1, body: 1, variations: 1, upscale: 0, identity: 2, carousel: 1, sfw_twin: 1, animate_5: 3, animate_10: 5, own_key: 0, share: 0 }),
  models: z.array(StudioModel).min(1).max(30).default(DEFAULT_STUDIO_MODELS),
  default_edit: z.string().default("qwen-edit-uncensored"),
  default_new: z.string().default("lustify-v8"),
  /** The highest level a shoot may reach (0 dressed, 1 suggestive, 2 nude, 3 explicit). */
  max_level: z.number().int().min(0).max(3).default(3),
  pov: z.boolean().default(true),
  /** One free redo for a shoot the viewer 👎'd whole (docs/PRDs/studio.md principle 5). */
  free_redo: z.boolean().default(true),
  /** Keyframes in nights, clips, the menu and beat pictures send each one's body reference too (off until tested). */
  reference_set_everywhere: z.boolean().default(false),
  /** A shoot sends their face from the angle it needs too, from their identity pack, when the model has room (off until tested). */
  identity_in_shoots: z.boolean().default(false),
  /** Option ids taken off the menus (lib/adult/studio-catalog.ts). */
  disabled_options: z.array(z.string().max(60)).max(300).default([]),
  share: z
    .object({
      photos: z.boolean().default(true),
      after_dark: z.boolean().default(true),
      /** A photo for the texts: Hive's general_nsfw at most this (and the shoot dressed). */
      pg_max_nsfw: z.number().min(0).max(1).default(0.15),
    })
    .default({ photos: true, after_dark: true, pg_max_nsfw: 0.15 }),
  own_keys: z.object({ venice: z.boolean().default(true), replicate: z.boolean().default(true) }).default({ venice: true, replicate: true }),
  /** Animate (v3): the video model (null: After Dark's own, `reel_model`, Wan 3.0 by default). */
  animate: z.object({ model: z.string().trim().min(1).max(120).nullable().default(null) }).default({ model: null }),
  /**
   * The PG Studio (lib/studio/pg.ts, /characters/[id]/studio): who it's open to (everyone since David's live shoot came
   * through, 2026-10-25: four pictures, all pg and clothed; "admins" closes it again), a shoot's size and price (the first shoot of each character free), the site's free shoots a day, each person's
   * pictures a month, and its models (an edit that keeps the face, in Venice's safe mode; a new picture when there's no
   * portrait yet) and what one picture costs us.
   */
  pg: z
    .object({
      open_to: z.enum(["admins", "everyone"]).default("everyone"),
      shoot_size: z.number().int().min(1).max(8).default(4),
      price: z.number().int().min(0).max(100).default(1),
      free_first_shoot: z.boolean().default(true),
      free_per_day: z.number().int().min(0).max(10_000).default(100),
      monthly_cap: z.number().int().min(0).max(10_000).default(120),
      /** The identity pack's eight views of a character (the creator suite): fewer, a redraw, cost their share of it. */
      identity_price: z.number().int().min(0).max(100).default(2),
      /** A carousel: one picture's moment from six angles (the creator suite). */
      carousel_price: z.number().int().min(0).max(100).default(1),
      edit_model: z.string().trim().min(1).max(120).default("qwen-image-2-1-turbo-edit"),
      new_model: z.string().trim().min(1).max(120).default("qwen-image-3"),
      usd: z.number().min(0).max(10).default(0.03),
    })
    .default({ open_to: "everyone", shoot_size: 4, price: 1, free_first_shoot: true, free_per_day: 100, monthly_cap: 120, identity_price: 2, carousel_price: 1, edit_model: "qwen-image-2-1-turbo-edit", new_model: "qwen-image-3", usd: 0.03 }),
  /** Upscale on Venice's upscaler: how much larger, and what one costs (added to an own key's month). */
  upscale: z
    .object({ scale: z.union([z.literal(2), z.literal(4)]).default(2), usd: z.number().min(0).max(10).default(0.02) })
    .default({ scale: 2, usd: 0.02 }),
});
export type StudioConfig = z.infer<typeof StudioConfig>;

/** The defaults, every one. */
export const DEFAULT_STUDIO_CONFIG: StudioConfig = StudioConfig.parse({});

/** A shoot's tokens for `n` pictures: the price of four for each four, the fifth four free (20 for 4 tokens: David, 2026-10-26). */
export function shootPrice(perFour: number, n: number): number {
  const fours = Math.max(1, Math.ceil(n / 4));
  return perFour * (fours >= 5 ? fours - 1 : fours);
}

/**
 * The stored JSON as settings: every default filled in. Anything that doesn't parse (a hand-edited row) falls back to
 * the defaults for that part, never to an error: the page must open to be fixed.
 */
export function studioConfigOf(raw: unknown): StudioConfig {
  const r = StudioConfig.safeParse(raw ?? {});
  if (r.success) return r.data;
  // Keep what parses, key by key.
  const out: Record<string, unknown> = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const one = StudioConfig.safeParse({ [k]: v });
      if (one.success) out[k] = (one.data as Record<string, unknown>)[k];
    }
  }
  return StudioConfig.parse(out);
}

/** A save: the stored config with these keys replaced (prices and share merged one level down). Throws on a bad value. */
export function mergeStudioConfig(current: StudioConfig, patch: Record<string, unknown>): StudioConfig {
  const next: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const cur = (current as Record<string, unknown>)[k];
    next[k] = v && typeof v === "object" && !Array.isArray(v) && cur && typeof cur === "object" && !Array.isArray(cur) ? { ...(cur as object), ...(v as object) } : v;
  }
  const parsed = StudioConfig.parse(next);
  // The defaults must name models on the list.
  const ids = new Set(parsed.models.map((m) => m.id));
  if (!ids.has(parsed.default_edit) || parsed.models.find((m) => m.id === parsed.default_edit)!.job !== "edit") throw new Error("default_edit must be an edit model on the list");
  if (!ids.has(parsed.default_new) || parsed.models.find((m) => m.id === parsed.default_new)!.job !== "new") throw new Error("default_new must be a new-picture model on the list");
  return parsed;
}
