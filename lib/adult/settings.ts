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

export type AdultSettings = {
  enabled: boolean;
  text_model: string;
  image_model: string;
  video_model: string;
  image_base: string;
  openrouter_last4: string | null;
  fal_last4: string | null;
  hive_mod_last4: string | null;
  hive_demo_last4: string | null;
};

type Row = {
  enabled: boolean;
  text_model: string | null;
  image_model: string | null;
  video_model: string | null;
  image_base: string | null;
  openrouter_ciphertext: string | null;
  openrouter_nonce: string | null;
  openrouter_last4: string | null;
  fal_ciphertext: string | null;
  fal_nonce: string | null;
  fal_last4: string | null;
  hive_mod_ciphertext: string | null;
  hive_mod_nonce: string | null;
  hive_mod_last4: string | null;
  hive_demo_ciphertext: string | null;
  hive_demo_nonce: string | null;
  hive_demo_last4: string | null;
};

async function row(db: Db): Promise<Row | null> {
  return (await db.query<Row>(`select * from adult_settings where id = 1`)).rows[0] ?? null;
}

export async function getAdultSettings(db: Db): Promise<AdultSettings> {
  const r = await row(db);
  return {
    enabled: r?.enabled ?? false,
    text_model: r?.text_model || DEFAULT_TEXT_MODEL,
    image_model: r?.image_model || DEFAULT_IMAGE_MODEL,
    video_model: r?.video_model || DEFAULT_VIDEO_MODEL,
    image_base: r?.image_base || DEFAULT_IMAGE_BASE,
    openrouter_last4: r?.openrouter_last4 ?? null,
    fal_last4: r?.fal_last4 ?? null,
    hive_mod_last4: r?.hive_mod_last4 ?? null,
    hive_demo_last4: r?.hive_demo_last4 ?? null,
  };
}

/** The decrypted keys, for the server only. */
export async function adultKeys(db: Db): Promise<{ openrouter: string | null; fal: string | null; hive_mod: string | null; hive_demo: string | null }> {
  const r = await row(db);
  const open = (c: string | null | undefined, n: string | null | undefined) => (c && n ? openSecret({ ciphertext: c, nonce: n }) : null);
  return {
    openrouter: open(r?.openrouter_ciphertext, r?.openrouter_nonce),
    fal: open(r?.fal_ciphertext, r?.fal_nonce),
    hive_mod: open(r?.hive_mod_ciphertext, r?.hive_mod_nonce),
    hive_demo: open(r?.hive_demo_ciphertext, r?.hive_demo_nonce),
  };
}

export type SettingsPatch = {
  enabled?: boolean;
  text_model?: string;
  image_model?: string;
  video_model?: string;
  image_base?: string;
  /** A new key, or "" to remove it. */
  openrouter_key?: string;
  fal_key?: string;
  hive_mod_key?: string;
  hive_demo_key?: string;
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
  for (const k of ["text_model", "image_model", "video_model", "image_base"] as const) if (patch[k] !== undefined) put(k, patch[k]!.trim() || null);
  for (const [k, col] of [
    ["openrouter_key", "openrouter"],
    ["fal_key", "fal"],
    ["hive_mod_key", "hive_mod"],
    ["hive_demo_key", "hive_demo"],
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
