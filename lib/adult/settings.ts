/**
 * After dark's settings (David, 2026-10-18: "paid cloud LLMs and video/image models are fine, in the settings panel,
 * admins only"). One row: whether it's on, the models, and the provider keys, sealed like BYOK keys (lib/keys.ts)
 * and shown again only as their last four. Text runs on OpenRouter, pictures and clips on fal.ai.
 */
import type { Db } from "../db";
import { openSecret, sealSecret } from "../keys";

/**
 * Defaults to start from; every one can be changed on the settings page. The text model is the one production runs
 * (David, 2026-10-22: DeepSeek V3.1, docs/after-dark.md), plain: lib/adult/mode.ts pins its hosts and sorts them by
 * throughput, which is what `:nitro` did. The old default, mistral-large, isn't served by either pinned host.
 */
export const DEFAULT_TEXT_MODEL = "deepseek/deepseek-chat-v3.1";
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
 * A clip on demand (lib/adult/clips.ts): one shot of the two of them, from the act menu or the scene's latest moment, or
 * kept going from the last one. About $0.70 to make on Venice (a keyframe and 5 s of Wan 3.0), about $0.15 on
 * Replicate; 3 bought tokens take in about $2 after fees (docs/after-dark-costs.md).
 */
export const DEFAULT_CLIP_TOKENS = 3;
/**
 * A picture from the shot menu (lib/adult/pictures-menu.ts): one keyframe of the two of them, as the viewer composes it.
 * About $0.05 to make on Venice ($0.04 and the check), $0.04 on Replicate; it also counts against the month's pictures.
 */
export const DEFAULT_MENU_PICTURE_TOKENS = 1;

/**
 * Who makes After Dark's explicit media: its pictures, each shot's keyframe, the videos and their voices. Venice, or
 * Replicate as the backup (David, 2026-10-22) while Venice confirms in writing that its terms allow explicit output
 * (docs/after-dark.md, "A Replicate backup"). The models, each checked against its Replicate page that day:
 *  - pictures: Qwen-Image (official, so always warm and $0.025 a picture; open weights, Apache 2.0). An SDXL-style
 *    model works too, by version, e.g. RealVisXL V4.0, `adirik/realvisxl-v4.0:85a58cc7…`, which cold-starts;
 *  - keyframes: Qwen-Image-Edit 2511 (official, $0.03), the same family as Venice's `qwen-edit-uncensored`. It keeps
 *    both faces well but tends to keep a portrait's clothes when the prompt says nude (the main session's test);
 *  - videos: Wan 2.2 image-to-video, fast (official, $0.11 at 720p): the only Wan on Replicate that takes
 *    `disable_safety_checker` and LoRAs. It's silent, so each line is said by Kokoro beside it;
 *  - voices: Kokoro 82M (a community model, so run by its version), the same stock voices as Venice's, but af_heart.
 */
export const MEDIA_PROVIDERS = ["venice", "replicate"] as const;
export type MediaProvider = (typeof MEDIA_PROVIDERS)[number];
export const DEFAULT_REPLICATE_PICTURE_MODEL = "qwen/qwen-image";
export const DEFAULT_REPLICATE_KEYFRAME_MODEL = "qwen/qwen-image-edit-2511";
export const DEFAULT_REPLICATE_VIDEO_MODEL = "wan-video/wan-2.2-i2v-fast";
export const DEFAULT_REPLICATE_VOICE_MODEL = "jaaari/kokoro-82m:f559560eb822dc509045f3921a1921234918b91739db4bf3daab2169b71c7a13";

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
/**
 * Which revision of v2 runs: v2 changes in place (v2.1 craft, v2.2 continuity, v2.3 the heat, a Direct steer's quoted
 * lines and a chapter carrying on: docs/after-dark.md), so each step's flags say which one wrote it.
 */
export const SCENE_PROMPT_REVISION = "v2.3";

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
  /** A clip on demand's price in bought tokens (lib/adult/clips.ts). */
  clip_tokens: number;
  /** A picture from the shot menu's price in bought tokens (lib/adult/pictures-menu.ts). */
  menu_picture_tokens: number;
  openrouter_last4: string | null;
  fal_last4: string | null;
  hive_last4: string | null;
  /** Who makes the explicit media, and the Replicate models when it's Replicate (MEDIA_PROVIDERS). */
  media_provider: MediaProvider;
  replicate_picture_model: string;
  replicate_keyframe_model: string;
  replicate_video_model: string;
  replicate_voice_model: string;
  /** An optional LoRA for Wan: one .safetensors URL for both its transformers, or two (high noise, then low). */
  replicate_video_lora: string | null;
  replicate_last4: string | null;
  /** No Replicate key saved, but the server has one (REPLICATE_API_TOKEN): that's the one used. Never its value. */
  replicate_from_env: boolean;
  /**
   * A picture of the two of them each time a chapter starts and each time the place changes (lib/adult/auto-pictures.ts;
   * David, 2026-10-23). On unless turned off (a null column is on).
   */
  auto_scene_pictures: boolean;
  /**
   * When the media provider is limited (429, 402, down), the same job runs once on the other one (lib/adult/fallback.ts;
   * David, 2026-10-22). On unless turned off (a null column is on).
   */
  media_fallback: boolean;
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
  clip_tokens: number | null;
  menu_picture_tokens: number | null;
  openrouter_ciphertext: string | null;
  openrouter_nonce: string | null;
  openrouter_last4: string | null;
  fal_ciphertext: string | null;
  fal_nonce: string | null;
  fal_last4: string | null;
  hive_ciphertext: string | null;
  hive_nonce: string | null;
  hive_last4: string | null;
  media_provider: string | null;
  replicate_picture_model: string | null;
  replicate_keyframe_model: string | null;
  replicate_video_model: string | null;
  replicate_voice_model: string | null;
  replicate_video_lora: string | null;
  replicate_ciphertext: string | null;
  replicate_nonce: string | null;
  replicate_last4: string | null;
  auto_scene_pictures: boolean | null;
  media_fallback: boolean | null;
};

/** The server's own Replicate token, used when none is saved in the settings. */
const envReplicate = (env: Record<string, string | undefined>) => env.REPLICATE_API_TOKEN?.trim() || null;

async function row(db: Db): Promise<Row | null> {
  return (await db.query<Row>(`select * from adult_settings where id = 1`)).rows[0] ?? null;
}

export async function getAdultSettings(db: Db, env: Record<string, string | undefined> = process.env): Promise<AdultSettings> {
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
    clip_tokens: r?.clip_tokens ?? DEFAULT_CLIP_TOKENS,
    menu_picture_tokens: r?.menu_picture_tokens ?? DEFAULT_MENU_PICTURE_TOKENS,
    openrouter_last4: r?.openrouter_last4 ?? null,
    fal_last4: r?.fal_last4 ?? null,
    hive_last4: r?.hive_last4 ?? null,
    media_provider: r?.media_provider === "replicate" ? "replicate" : "venice",
    replicate_picture_model: r?.replicate_picture_model || DEFAULT_REPLICATE_PICTURE_MODEL,
    replicate_keyframe_model: r?.replicate_keyframe_model || DEFAULT_REPLICATE_KEYFRAME_MODEL,
    replicate_video_model: r?.replicate_video_model || DEFAULT_REPLICATE_VIDEO_MODEL,
    replicate_voice_model: r?.replicate_voice_model || DEFAULT_REPLICATE_VOICE_MODEL,
    replicate_video_lora: r?.replicate_video_lora || null,
    replicate_last4: r?.replicate_last4 ?? null,
    replicate_from_env: !r?.replicate_last4 && envReplicate(env) !== null,
    auto_scene_pictures: r?.auto_scene_pictures ?? true,
    media_fallback: r?.media_fallback ?? true,
  };
}

/** The decrypted keys, for the server only. Replicate's: the one saved here, else the server's REPLICATE_API_TOKEN. */
export async function adultKeys(
  db: Db,
  env: Record<string, string | undefined> = process.env,
): Promise<{ openrouter: string | null; fal: string | null; hive: string | null; venice: string | null; replicate: string | null }> {
  const r = await row(db);
  const open = (c: string | null | undefined, n: string | null | undefined) => (c && n ? openSecret({ ciphertext: c, nonce: n }) : null);
  return {
    openrouter: open(r?.openrouter_ciphertext, r?.openrouter_nonce),
    fal: open(r?.fal_ciphertext, r?.fal_nonce),
    hive: open(r?.hive_ciphertext, r?.hive_nonce),
    venice: open(r?.venice_ciphertext, r?.venice_nonce),
    replicate: open(r?.replicate_ciphertext, r?.replicate_nonce) ?? envReplicate(env),
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
  clip_tokens?: number;
  menu_picture_tokens?: number;
  /** A new key, or "" to remove it. */
  openrouter_key?: string;
  fal_key?: string;
  /** Hive's V3 secret key (the output check, lib/adult/check.ts). */
  hive_key?: string;
  venice_key?: string;
  media_provider?: MediaProvider;
  /** A model id, or "" for the default; a LoRA, or "" for none. */
  replicate_picture_model?: string;
  replicate_keyframe_model?: string;
  replicate_video_model?: string;
  replicate_voice_model?: string;
  replicate_video_lora?: string;
  replicate_key?: string;
  auto_scene_pictures?: boolean;
  media_fallback?: boolean;
};

/**
 * The settings whose changes are kept (adult_settings_history), so which model wrote an old scene, or which provider
 * made an old picture, can be worked out later: the text model, the picture and video models, and the media provider.
 */
export const HISTORY_FIELDS = [
  "text_model",
  "image_model",
  "video_model",
  "image_base",
  "image_provider",
  "venice_image_model",
  "reel_model",
  "media_provider",
  "media_fallback",
  "replicate_picture_model",
  "replicate_keyframe_model",
  "replicate_video_model",
  "replicate_voice_model",
] as const satisfies readonly (keyof AdultSettings)[];
export type HistoryField = (typeof HISTORY_FIELDS)[number];
export type SettingsChange = { field: HistoryField; from_value: string | null; to_value: string | null; at: string; by: string | null };

/** The history's changes, newest first (all of them, or one field's). */
export async function settingsHistory(db: Db, field?: HistoryField, limit = 200): Promise<SettingsChange[]> {
  const { rows } = await db
    .query<{ field: HistoryField; from_value: string | null; to_value: string | null; at: string | Date; by_user: string | null }>(
      `select field, from_value, to_value, at, by_user from adult_settings_history ${field ? "where field = $2" : ""} order by at desc, seq desc limit $1`,
      field ? [limit, field] : [limit],
    )
    .catch(() => ({ rows: [] as { field: HistoryField; from_value: string | null; to_value: string | null; at: string | Date; by_user: string | null }[] }));
  return rows.map((r) => ({ field: r.field, from_value: r.from_value, to_value: r.to_value, at: new Date(r.at).toISOString(), by: r.by_user }));
}

/**
 * Saves the settings. `by` is who saved them (an admin's user id, or "mcp"), kept with each tracked change in the
 * history (HISTORY_FIELDS), which records the value in effect before and after (a default counts as its value).
 */
export async function saveAdultSettings(db: Db, patch: SettingsPatch, by: string | null = null): Promise<AdultSettings> {
  await db.query(`insert into adult_settings (id) values (1) on conflict (id) do nothing`);
  const before = await getAdultSettings(db);
  const set: string[] = [];
  const vals: unknown[] = [];
  const put = (col: string, v: unknown) => {
    vals.push(v);
    set.push(`${col} = $${vals.length}`);
  };
  if (patch.enabled !== undefined) put("enabled", patch.enabled);
  if (patch.image_provider !== undefined) put("image_provider", patch.image_provider);
  if (patch.prompt_version !== undefined) put("prompt_version", patch.prompt_version);
  if (patch.media_provider !== undefined) put("media_provider", patch.media_provider);
  if (patch.auto_scene_pictures !== undefined) put("auto_scene_pictures", patch.auto_scene_pictures);
  if (patch.media_fallback !== undefined) put("media_fallback", patch.media_fallback);
  for (const k of ["reel_shots", "reel_tokens", "clip_tokens", "menu_picture_tokens"] as const) if (patch[k] !== undefined) put(k, patch[k]);
  for (const k of ["text_temperature", "frequency_penalty", "presence_penalty", "repetition_penalty"] as const) if (patch[k] !== undefined) put(k, patch[k]);
  for (const k of ["text_model", "image_model", "video_model", "image_base", "venice_image_model", "reel_model"] as const) if (patch[k] !== undefined) put(k, patch[k]!.trim() || null);
  for (const k of ["replicate_picture_model", "replicate_keyframe_model", "replicate_video_model", "replicate_voice_model", "replicate_video_lora"] as const) {
    if (patch[k] !== undefined) put(k, patch[k]!.trim() || null);
  }
  for (const [k, col] of [
    ["openrouter_key", "openrouter"],
    ["fal_key", "fal"],
    ["hive_key", "hive"],
    ["venice_key", "venice"],
    ["replicate_key", "replicate"],
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
  const after = await getAdultSettings(db);
  const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
  for (const field of HISTORY_FIELDS) {
    const [from, to] = [str(before[field]), str(after[field])];
    if (from === to) continue;
    await db
      .query(`insert into adult_settings_history (id, field, from_value, to_value, by_user) values ($1, $2, $3, $4, $5)`, [crypto.randomUUID(), field, from, to, by?.slice(0, 120) ?? null])
      .catch(() => {});
  }
  return after;
}

/** On the site: an admin turned it on and a text key is saved. */
export async function cloudReady(db: Db): Promise<boolean> {
  const s = await getAdultSettings(db);
  return s.enabled && s.openrouter_last4 !== null;
}
