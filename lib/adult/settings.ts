/**
 * After dark's settings (David, 2026-10-18: "paid cloud LLMs and video/image models are fine, in the settings panel,
 * admins only"). One row: whether it's on, the models, and the provider keys, sealed like BYOK keys (lib/keys.ts)
 * and shown again only as their last four. Text runs on OpenRouter, pictures and clips on fal.ai.
 */
import type { Db } from "../db";
import { openSecret, sealSecret } from "../keys";

/** Defaults to start from; every one can be changed on the settings page. */
export const DEFAULT_TEXT_MODEL = "mistralai/mistral-large";
/**
 * fal's custom-model endpoint running a photoreal SDXL fine-tune (OpenRAIL++, which doesn't forbid consensual adult
 * content). FLUX [dev]'s terms don't fit adult output, so it's not the default (docs/after-dark.md #6).
 */
export const DEFAULT_IMAGE_MODEL = "fal-ai/lora";
export const DEFAULT_IMAGE_BASE = "SG161222/RealVisXL_V4.0";
export const DEFAULT_VIDEO_MODEL = "fal-ai/wan-i2v";
/**
 * Where pictures are made. fal's acceptable use policy bans sexually explicit output (its request checker refuses it),
 * so explicit pictures go to Venice (David, 2026-10-19), whose API serves adult images with safe_mode off. A photoreal
 * SDXL fine-tune Venice lists as its most uncensored, $0.01 a picture.
 */
export const IMAGE_PROVIDERS = ["fal", "venice"] as const;
export type ImageProvider = (typeof IMAGE_PROVIDERS)[number];
export const DEFAULT_VENICE_IMAGE_MODEL = "lustify-v8";
/**
 * The full-night video: Wan 3.0 speaks each line itself, quoted in its prompt (David, 2026-10-19, after watching both
 * tests: the model's own voice felt more real than a stock voice lip-synced by Wan 2.6). Six shots, about 30 seconds;
 * 15 bought tokens (docs/after-dark-costs.md: about $4 to $5 to make, $10.50 in after fees).
 */
export const DEFAULT_REEL_MODEL = "wan-3-0-image-to-video";
export const DEFAULT_REEL_SHOTS = 6;
export const DEFAULT_REEL_TOKENS = 15;

/**
 * The scene writer's sampling (David, 2026-10-21, after the review of 977 lines: repeats, stock words, sheets lost).
 * 0.8, down from 0.9: still varied, less drift. The penalties only see the reply being written (six lines), so they
 * thin out a word said three times in one reply, not one said last step; the repeat guard handles that. The
 * repetition penalty is off by default: open models' providers count the prompt in it, which would push the lines away
 * from the very sheet words they should use.
 */
export const DEFAULT_TEXT_TEMPERATURE = 0.8;
export const DEFAULT_FREQUENCY_PENALTY = 0.3;
export const DEFAULT_PRESENCE_PENALTY = 0.3;
export const DEFAULT_REPETITION_PENALTY: number | null = null;

/** The scene prompts (lib/adult/scenes.ts sceneMessages): v2 anchors the voice and cites facts; v1 is the prompt before it. */
export const PROMPT_VERSIONS = ["v1", "v2"] as const;
export type PromptVersion = (typeof PROMPT_VERSIONS)[number];
export const DEFAULT_PROMPT_VERSION: PromptVersion = "v2";

export type AdultSettings = {
  enabled: boolean;
  text_model: string;
  /** The scene writer's temperature and penalties (DEFAULT_TEXT_TEMPERATURE…); repetition_penalty null sends none. */
  text_temperature: number;
  frequency_penalty: number;
  presence_penalty: number;
  repetition_penalty: number | null;
  /** Which scene prompt runs: v2 unless set (v1 stays for an A/B, and as the way back). */
  prompt_version: PromptVersion;
  image_model: string;
  video_model: string;
  image_base: string;
  image_provider: ImageProvider;
  venice_image_model: string;
  venice_last4: string | null;
  /** The full-night video (lib/adult/reels.ts): its model, how many shots, and its price in bought tokens. */
  reel_model: string;
  reel_shots: number;
  reel_tokens: number;
  openrouter_last4: string | null;
  fal_last4: string | null;
  hive_last4: string | null;
};

type Row = {
  enabled: boolean;
  text_model: string | null;
  text_temperature: number | null;
  frequency_penalty: number | null;
  presence_penalty: number | null;
  repetition_penalty: number | null;
  prompt_version: string | null;
  image_model: string | null;
  video_model: string | null;
  image_base: string | null;
  image_provider: string | null;
  venice_image_model: string | null;
  venice_ciphertext: string | null;
  venice_nonce: string | null;
  venice_last4: string | null;
  reel_model: string | null;
  reel_shots: number | null;
  reel_tokens: number | null;
  openrouter_ciphertext: string | null;
  openrouter_nonce: string | null;
  openrouter_last4: string | null;
  fal_ciphertext: string | null;
  fal_nonce: string | null;
  fal_last4: string | null;
  hive_ciphertext: string | null;
  hive_nonce: string | null;
  hive_last4: string | null;
};

async function row(db: Db): Promise<Row | null> {
  return (await db.query<Row>(`select * from adult_settings where id = 1`)).rows[0] ?? null;
}

export async function getAdultSettings(db: Db): Promise<AdultSettings> {
  const r = await row(db);
  // A stored number, or null for none (the default then applies).
  const num = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  return {
    enabled: r?.enabled ?? false,
    text_model: r?.text_model || DEFAULT_TEXT_MODEL,
    text_temperature: num(r?.text_temperature) ?? DEFAULT_TEXT_TEMPERATURE,
    frequency_penalty: num(r?.frequency_penalty) ?? DEFAULT_FREQUENCY_PENALTY,
    presence_penalty: num(r?.presence_penalty) ?? DEFAULT_PRESENCE_PENALTY,
    repetition_penalty: num(r?.repetition_penalty) ?? DEFAULT_REPETITION_PENALTY,
    prompt_version: (PROMPT_VERSIONS as readonly string[]).includes(r?.prompt_version ?? "") ? (r!.prompt_version as PromptVersion) : DEFAULT_PROMPT_VERSION,
    image_model: r?.image_model || DEFAULT_IMAGE_MODEL,
    video_model: r?.video_model || DEFAULT_VIDEO_MODEL,
    image_base: r?.image_base || DEFAULT_IMAGE_BASE,
    image_provider: r?.image_provider === "venice" ? "venice" : "fal",
    venice_image_model: r?.venice_image_model || DEFAULT_VENICE_IMAGE_MODEL,
    venice_last4: r?.venice_last4 ?? null,
    reel_model: r?.reel_model || DEFAULT_REEL_MODEL,
    reel_shots: r?.reel_shots ?? DEFAULT_REEL_SHOTS,
    reel_tokens: r?.reel_tokens ?? DEFAULT_REEL_TOKENS,
    openrouter_last4: r?.openrouter_last4 ?? null,
    fal_last4: r?.fal_last4 ?? null,
    hive_last4: r?.hive_last4 ?? null,
  };
}

/** The decrypted keys, for the server only. */
export async function adultKeys(db: Db): Promise<{ openrouter: string | null; fal: string | null; hive: string | null; venice: string | null }> {
  const r = await row(db);
  const open = (c: string | null | undefined, n: string | null | undefined) => (c && n ? openSecret({ ciphertext: c, nonce: n }) : null);
  return {
    openrouter: open(r?.openrouter_ciphertext, r?.openrouter_nonce),
    fal: open(r?.fal_ciphertext, r?.fal_nonce),
    hive: open(r?.hive_ciphertext, r?.hive_nonce),
    venice: open(r?.venice_ciphertext, r?.venice_nonce),
  };
}

export type SettingsPatch = {
  enabled?: boolean;
  text_model?: string;
  /** The scene writer's sampling; null puts one back to its default. */
  text_temperature?: number | null;
  frequency_penalty?: number | null;
  presence_penalty?: number | null;
  repetition_penalty?: number | null;
  prompt_version?: PromptVersion;
  image_model?: string;
  video_model?: string;
  image_base?: string;
  image_provider?: ImageProvider;
  venice_image_model?: string;
  reel_model?: string;
  reel_shots?: number;
  reel_tokens?: number;
  /** A new key, or "" to remove it. */
  openrouter_key?: string;
  fal_key?: string;
  /** Hive's V3 secret key (the output check, lib/adult/check.ts). */
  hive_key?: string;
  venice_key?: string;
};

export async function saveAdultSettings(db: Db, patch: SettingsPatch): Promise<AdultSettings> {
  await db.query(`insert into adult_settings (id) values (1) on conflict (id) do nothing`);
  const set: string[] = [];
  const vals: unknown[] = [];
  const put = (col: string, v: unknown) => {
    vals.push(v);
    set.push(`${col} = $${vals.length}`);
  };
  if (patch.enabled !== undefined) put("enabled", patch.enabled);
  if (patch.image_provider !== undefined) put("image_provider", patch.image_provider);
  if (patch.prompt_version !== undefined) put("prompt_version", patch.prompt_version);
  for (const k of ["reel_shots", "reel_tokens"] as const) if (patch[k] !== undefined) put(k, patch[k]);
  for (const k of ["text_temperature", "frequency_penalty", "presence_penalty", "repetition_penalty"] as const) if (patch[k] !== undefined) put(k, patch[k]);
  for (const k of ["text_model", "image_model", "video_model", "image_base", "venice_image_model", "reel_model"] as const) if (patch[k] !== undefined) put(k, patch[k]!.trim() || null);
  for (const [k, col] of [
    ["openrouter_key", "openrouter"],
    ["fal_key", "fal"],
    ["hive_key", "hive"],
    ["venice_key", "venice"],
  ] as const) {
    const v = patch[k];
    if (v === undefined) continue;
    if (v.trim() === "") {
      put(`${col}_ciphertext`, null);
      put(`${col}_nonce`, null);
      put(`${col}_last4`, null);
    } else {
      const sealed = sealSecret(v.trim());
      put(`${col}_ciphertext`, sealed.ciphertext);
      put(`${col}_nonce`, sealed.nonce);
      put(`${col}_last4`, v.trim().slice(-4));
    }
  }
  if (set.length) await db.query(`update adult_settings set ${set.join(", ")}, updated_at = now() where id = 1`, vals);
  return getAdultSettings(db);
}

/** On the site: an admin turned it on and a text key is saved. */
export async function cloudReady(db: Db): Promise<boolean> {
  const s = await getAdultSettings(db);
  return s.enabled && s.openrouter_last4 !== null;
}
