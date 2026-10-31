/**
 * After dark's settings (David, 2026-10-18: "paid cloud LLMs and video/image models are fine, in the settings panel,
 * admins only"). One row: whether it's on, the models, and the provider keys, sealed like BYOK keys (lib/keys.ts)
 * and shown again only as their last four. Text runs on OpenRouter, pictures and clips on fal.ai.
 */
import type { Db } from "../db";
import { needsReseal, reseal } from "../key-crypto";
import { openSecret, sealSecret } from "../keys";
import { mergeModerationConfig, moderationConfigOf, type ModerationConfig } from "./moderation-config";
import { mergeStudioConfig, studioConfigOf, type StudioConfig } from "./studio-config";
import { mergeWriterConfig, writerConfigOf, type WriterConfig } from "./writer-config";
import { DEFAULT_CAPS, USAGE_KINDS, type UsageKind } from "./usage";

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
 * 7 bought tokens, about what it costs us (#1005; David, 2026-10-30: "just break even overall is the goal until adoption
 * is higher"): $4.25 to $5.50 to make, about $4.75 in after fees (docs/after-dark-costs.md). It was 15.
 */
export const DEFAULT_REEL_MODEL = "wan-3-0-image-to-video";
export const DEFAULT_REEL_SHOTS = 6;
export const DEFAULT_REEL_TOKENS = 7;
/**
 * A clip on demand (lib/adult/clips.ts): one shot of the two of them, from the act menu or the scene's latest moment, or
 * kept going from the last one. About $0.70 to make on Venice (a keyframe and 5 s of Wan 3.0), about $0.15 on
 * Replicate. 1 bought token, about cost (#1005; David, 2026-10-30, break even): a subscriber's first `included_clips` a
 * month cost nothing (lib/adult/pricing.ts), and each one after that this. It was 3.
 */
export const DEFAULT_CLIP_TOKENS = 1;
/** A subscriber's clips each calendar month that cost no tokens (#1005, David 2026-10-30: the subscription's allowance). */
export const DEFAULT_INCLUDED_CLIPS = 3;
/**
 * A picture from the shot menu (lib/adult/pictures-menu.ts): one keyframe of the two of them, as the viewer composes it.
 * About $0.05 to make on Venice ($0.04 and the check), $0.04 on Replicate; it also counts against the month's pictures.
 */
export const DEFAULT_MENU_PICTURE_TOKENS = 1;

/**
 * A chapter of a night (up to 120 lines) costs this many bought tokens, taken when its first lines are written; admins
 * don't pay (David, 2026-10-25). One token is about $0.68 after an adult processor's fee; a chapter costs us about $0.05
 * of text plus its pictures (about $0.03 each on Replicate, $0.015 on Venice). Included with a subscription (#1005; David,
 * 2026-10-30), bounded by the month's caps, so in practice only a viewer with no subscription would pay it
 * (lib/adult/pricing.ts); the menu's pictures and Draw ahead the same.
 */
export const DEFAULT_CHAPTER_TOKENS = 1;
/**
 * The pictures a chapter draws without being asked, all kinds together: its own and each new place's
 * (lib/adult/auto-pictures.ts), one its lines ask for, and its moments drawn when it closes (lib/adult/beats.ts). A
 * picture the viewer asks for (Picture this, the menu) isn't counted here. At 3, a chapter's pictures cost at most ~$0.09.
 */
export const DEFAULT_PICTURES_PER_CHAPTER = 3;
/**
 * Draw ahead (lib/adult/draw-ahead.ts; David, 2026-10-29: "draw ahead is a good idea, but we would need to limit per
 * chapter and pre charge people tokens if they choose it"): a chapter's moments drawn as soon as they're written, for
 * this many bought tokens a chapter, taken before its first one is drawn; and how many more pictures than the chapter's
 * own it may draw. At 4 more, a chapter drawn ahead costs us at most about $0.20 of pictures.
 */
export const DEFAULT_DRAW_AHEAD_TOKENS = 1;
export const DEFAULT_DRAW_AHEAD_PICTURES = 4;

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
/**
 * Who voices a night's lines (lib/adult/voice-lines.ts; docs/PRDs/theater-immersion.md #3): Venice's Kokoro (the stock
 * voices, the cheapest), Orpheus (laughs, sighs and gasps), Chatterbox HD or Inworld 1.5 Max. Replicate has Kokoro only.
 */
export const VOICE_MODELS = ["kokoro", "orpheus", "chatterbox", "inworld"] as const;
export type VoiceModel = (typeof VOICE_MODELS)[number];
/** The living portrait's video model (lib/adult/presence.ts): an open model on Venice, a 5 s clip of one face. */
export const DEFAULT_PRESENCE_LOOP_MODEL = "wan-2.6-flash-image-to-video";
/** The sound of a place (lib/adult/place-sounds.ts): Venice's ElevenLabs sound effects, the one that loops without a seam. */
export const DEFAULT_PLACE_SOUND_MODEL = "elevenlabs-sound-effects-v2";
/** A talking moment's model (lib/adult/talks.ts): one that takes our voice in and lip-syncs to it. */
export const DEFAULT_TALK_MODEL = "wan-2.6-flash-image-to-video";
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
 * lines and a chapter carrying on, v2.4 their work and hobbies held to a share of their lines, v2.5 the voice without its
 * subjects, both sheets' words and the wry asides rationed from undressing on, v2.6 the aside check, the tic guard and the
 * quotes' owners: docs/after-dark.md), so each step's flags say which one wrote it.
 */
export const SCENE_PROMPT_REVISION = "v2.6";

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
  /** A subscriber's clips a month at no tokens (DEFAULT_INCLUDED_CLIPS, lib/adult/pricing.ts). */
  included_clips: number;
  /** A picture from the shot menu's price in bought tokens (lib/adult/pictures-menu.ts). */
  menu_picture_tokens: number;
  /** A chapter's price in bought tokens, and the pictures it draws unasked (DEFAULT_CHAPTER_TOKENS, DEFAULT_PICTURES_PER_CHAPTER). */
  chapter_tokens: number;
  pictures_per_chapter: number;
  openrouter_last4: string | null;
  fal_last4: string | null;
  hive_last4: string | null;
  /** Who makes the explicit media, and the Replicate models when it's Replicate (MEDIA_PROVIDERS). */
  media_provider: MediaProvider;
  replicate_picture_model: string;
  replicate_keyframe_model: string;
  replicate_video_model: string;
  replicate_voice_model: string;
  /** Who voices a night's lines on Venice (VOICE_MODELS), and the living portrait's video model (lib/adult/presence.ts). */
  voice_model: VoiceModel;
  presence_loop_model: string;
  /** A quiet bed of sound per place under the voices (docs/PRDs/theater-immersion.md #6), and its model. */
  place_sounds: boolean;
  place_sound_model: string;
  talk_model: string;
  /**
   * Draw ahead is offered in the theater (lib/adult/draw-ahead.ts): a viewer who turns it on pays `draw_ahead_tokens` a
   * chapter, and up to `draw_ahead_pictures` more than the chapter's own are drawn as their moments are written.
   */
  draw_ahead: boolean;
  draw_ahead_tokens: number;
  draw_ahead_pictures: number;
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
   * A picture of each moment that matters (lib/adult/beats.ts; David, 2026-10-24): undressing, sex, each new position, the
   * climax, the afterglow, offered as the theater plays and drawn at the chapter's close if never asked for. On unless
   * turned off (a null column is on).
   */
  beat_pictures: boolean;
  /**
   * When the media provider is limited (429, 402, down), the same job runs once on the other one (lib/adult/fallback.ts;
   * David, 2026-10-22). On unless turned off (a null column is on).
   */
  media_fallback: boolean;
  /** The Studio's every setting (lib/adult/studio-config.ts), defaults filled in. */
  studio: StudioConfig;
  /** Who writes the scenes (lib/adult/writer-config.ts): the writers a person can pick, and the default. */
  writer: WriterConfig;
  /** Each person's monthly cap per kind (lib/adult/usage.ts); admins are never capped. */
  caps: Record<UsageKind, number>;
  /** Which checker checks (lib/adult/moderation.ts), defaults filled in; and the alternatives' saved keys, last four. */
  moderation: ModerationConfig;
  sightengine_last4: string | null;
  moderation_endpoint_last4: string | null;
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
  included_clips: number | null;
  menu_picture_tokens: number | null;
  chapter_tokens: number | null;
  pictures_per_chapter: number | null;
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
  voice_model: string | null;
  presence_loop_model: string | null;
  place_sounds: boolean | null;
  place_sound_model: string | null;
  talk_model: string | null;
  draw_ahead: boolean | null;
  draw_ahead_tokens: number | null;
  draw_ahead_pictures: number | null;
  replicate_video_lora: string | null;
  replicate_ciphertext: string | null;
  replicate_nonce: string | null;
  replicate_last4: string | null;
  auto_scene_pictures: boolean | null;
  beat_pictures: boolean | null;
  media_fallback: boolean | null;
  studio: unknown;
  writer: unknown;
  moderation: unknown;
  sightengine_ciphertext: string | null;
  sightengine_nonce: string | null;
  sightengine_last4: string | null;
  moderation_endpoint_ciphertext: string | null;
  moderation_endpoint_nonce: string | null;
  moderation_endpoint_last4: string | null;
} & Partial<Record<`cap_${UsageKind}`, number | null>>;

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
    included_clips: r?.included_clips ?? DEFAULT_INCLUDED_CLIPS,
    menu_picture_tokens: r?.menu_picture_tokens ?? DEFAULT_MENU_PICTURE_TOKENS,
    chapter_tokens: r?.chapter_tokens ?? DEFAULT_CHAPTER_TOKENS,
    pictures_per_chapter: r?.pictures_per_chapter ?? DEFAULT_PICTURES_PER_CHAPTER,
    openrouter_last4: r?.openrouter_last4 ?? null,
    fal_last4: r?.fal_last4 ?? null,
    hive_last4: r?.hive_last4 ?? null,
    media_provider: r?.media_provider === "replicate" ? "replicate" : "venice",
    replicate_picture_model: r?.replicate_picture_model || DEFAULT_REPLICATE_PICTURE_MODEL,
    replicate_keyframe_model: r?.replicate_keyframe_model || DEFAULT_REPLICATE_KEYFRAME_MODEL,
    replicate_video_model: r?.replicate_video_model || DEFAULT_REPLICATE_VIDEO_MODEL,
    replicate_voice_model: r?.replicate_voice_model || DEFAULT_REPLICATE_VOICE_MODEL,
    voice_model: (VOICE_MODELS as readonly string[]).includes(r?.voice_model ?? "") ? (r!.voice_model as VoiceModel) : "kokoro",
    presence_loop_model: r?.presence_loop_model || DEFAULT_PRESENCE_LOOP_MODEL,
    place_sounds: r?.place_sounds ?? true,
    place_sound_model: r?.place_sound_model || DEFAULT_PLACE_SOUND_MODEL,
    talk_model: r?.talk_model || DEFAULT_TALK_MODEL,
    draw_ahead: r?.draw_ahead ?? true,
    draw_ahead_tokens: r?.draw_ahead_tokens ?? DEFAULT_DRAW_AHEAD_TOKENS,
    draw_ahead_pictures: r?.draw_ahead_pictures ?? DEFAULT_DRAW_AHEAD_PICTURES,
    replicate_video_lora: r?.replicate_video_lora || null,
    replicate_last4: r?.replicate_last4 ?? null,
    replicate_from_env: !r?.replicate_last4 && envReplicate(env) !== null,
    auto_scene_pictures: r?.auto_scene_pictures ?? true,
    beat_pictures: r?.beat_pictures ?? true,
    media_fallback: r?.media_fallback ?? true,
    studio: studioConfigOf(r?.studio),
    writer: writerConfigOf(r?.writer),
    caps: Object.fromEntries(USAGE_KINDS.map((k) => [k, num(r?.[`cap_${k}`]) ?? DEFAULT_CAPS[k]])) as Record<UsageKind, number>,
    moderation: moderationConfigOf(r?.moderation),
    sightengine_last4: r?.sightengine_last4 ?? null,
    moderation_endpoint_last4: r?.moderation_endpoint_last4 ?? null,
  };
}

/** The house keys' columns (each sealed with its own context, "adult:<column>": lib/key-crypto.ts). */
export const KEY_COLUMNS = ["openrouter", "fal", "hive", "venice", "replicate", "sightengine", "moderation_endpoint"] as const;
export type KeyColumn = (typeof KEY_COLUMNS)[number];
/** Where a house key is sealed: a v2 seal opens only in its own column. */
export const keyContext = (col: KeyColumn): string => `adult:${col}`;

/**
 * The decrypted keys, for the server only. Replicate's: the one saved here, else the server's REPLICATE_API_TOKEN. A key
 * still sealed the old way (from SESSION_SECRET) is sealed again under KEY_ENCRYPTION_SECRET on the way, once that's set,
 * unless it was replaced meanwhile.
 */
export async function adultKeys(
  db: Db,
  env: Record<string, string | undefined> = process.env,
): Promise<{
  openrouter: string | null;
  fal: string | null;
  hive: string | null;
  venice: string | null;
  replicate: string | null;
  sightengine: string | null;
  moderation_endpoint: string | null;
}> {
  const r = await row(db);
  const open = async (col: KeyColumn): Promise<string | null> => {
    const ciphertext = r?.[`${col}_ciphertext`];
    const nonce = r?.[`${col}_nonce`];
    if (!ciphertext || !nonce) return null;
    const sealed = { ciphertext, nonce };
    if (needsReseal(sealed, env)) {
      const moved = reseal(sealed, keyContext(col), env);
      if (moved) {
        await db
          .query(`update adult_settings set ${col}_ciphertext = $1, ${col}_nonce = $2 where id = 1 and ${col}_ciphertext = $3`, [moved.sealed.ciphertext, moved.sealed.nonce, ciphertext])
          .catch(() => {});
        return moved.plain;
      }
    }
    return openSecret(sealed, keyContext(col), env);
  };
  const [openrouter, fal, hive, venice, replicate, sightengine, moderation_endpoint] = await Promise.all(KEY_COLUMNS.map(open));
  return { openrouter, fal, hive, venice, replicate: replicate ?? envReplicate(env), sightengine, moderation_endpoint };
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
  included_clips?: number;
  menu_picture_tokens?: number;
  chapter_tokens?: number;
  pictures_per_chapter?: number;
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
  voice_model?: VoiceModel;
  /** A Venice video model id, or "" for the default. */
  presence_loop_model?: string;
  place_sounds?: boolean;
  place_sound_model?: string;
  talk_model?: string;
  draw_ahead?: boolean;
  draw_ahead_tokens?: number;
  draw_ahead_pictures?: number;
  auto_scene_pictures?: boolean;
  beat_pictures?: boolean;
  media_fallback?: boolean;
  /** Studio settings to change (lib/adult/studio-config.ts): the keys named replace the stored ones; a bad value throws. */
  studio?: Record<string, unknown>;
  /** The writers (lib/adult/writer-config.ts): the keys named replace the stored ones; a bad value throws. */
  writer?: Record<string, unknown>;
  /** Monthly caps to change, per kind (0 or more). */
  caps?: Partial<Record<UsageKind, number>>;
  /** Which checker checks (lib/adult/moderation-config.ts): the keys named replace the stored ones; a bad value throws. */
  moderation?: Record<string, unknown>;
  /** Sightengine's api_secret, and our own age endpoint's key; "" removes one. */
  sightengine_key?: string;
  moderation_endpoint_key?: string;
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
  "voice_model",
  "presence_loop_model",
  "place_sounds",
  "place_sound_model",
  "talk_model",
  "draw_ahead",
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
  if (patch.beat_pictures !== undefined) put("beat_pictures", patch.beat_pictures);
  if (patch.place_sounds !== undefined) put("place_sounds", patch.place_sounds);
  if (patch.draw_ahead !== undefined) put("draw_ahead", patch.draw_ahead);
  if (patch.media_fallback !== undefined) put("media_fallback", patch.media_fallback);
  if (patch.studio !== undefined) put("studio", JSON.stringify(mergeStudioConfig(before.studio, patch.studio)));
  if (patch.writer !== undefined) put("writer", JSON.stringify(mergeWriterConfig(before.writer, patch.writer)));
  if (patch.moderation !== undefined) put("moderation", JSON.stringify(mergeModerationConfig(before.moderation, patch.moderation)));
  for (const k of USAGE_KINDS) {
    const v = patch.caps?.[k];
    if (v !== undefined) put(`cap_${k}`, Math.max(0, Math.floor(v)));
  }
  for (const k of ["reel_shots", "reel_tokens", "clip_tokens", "included_clips", "menu_picture_tokens", "chapter_tokens", "pictures_per_chapter", "draw_ahead_tokens", "draw_ahead_pictures"] as const) if (patch[k] !== undefined) put(k, patch[k]);
  for (const k of ["text_temperature", "frequency_penalty", "presence_penalty", "repetition_penalty"] as const) if (patch[k] !== undefined) put(k, patch[k]);
  for (const k of ["text_model", "image_model", "video_model", "image_base", "venice_image_model", "reel_model"] as const) if (patch[k] !== undefined) put(k, patch[k]!.trim() || null);
  for (const k of ["replicate_picture_model", "replicate_keyframe_model", "replicate_video_model", "replicate_voice_model", "replicate_video_lora", "presence_loop_model", "place_sound_model", "talk_model"] as const) {
    if (patch[k] !== undefined) put(k, patch[k]!.trim() || null);
  }
  if (patch.voice_model !== undefined) put("voice_model", (VOICE_MODELS as readonly string[]).includes(patch.voice_model) ? patch.voice_model : "kokoro");
  for (const [k, col] of [
    ["openrouter_key", "openrouter"],
    ["fal_key", "fal"],
    ["hive_key", "hive"],
    ["venice_key", "venice"],
    ["replicate_key", "replicate"],
    ["sightengine_key", "sightengine"],
    ["moderation_endpoint_key", "moderation_endpoint"],
  ] as const) {
    const v = patch[k];
    if (v === undefined) continue;
    if (v.trim() === "") {
      put(`${col}_ciphertext`, null);
      put(`${col}_nonce`, null);
      put(`${col}_last4`, null);
    } else {
      const sealed = sealSecret(v.trim(), keyContext(col));
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
