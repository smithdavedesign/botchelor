/**
 * Draws the looks builder's tiles (lib/looks.ts) and a character's portrait from its picks. Each tile is drawn once and
 * kept in look_tiles. The show's tiles and portraits are drawn on fal (FLUX [dev], fal's own safety checker on), and
 * After Dark's on Venice (fal bans explicit output; lib/adult/settings.ts). Hive screens every picture before it's
 * kept, and a refusal is never stored: anyone shown must read as an adult, and a show picture must not be explicit.
 * Paid from the admin's keys in After Dark's settings; with none saved, nothing is drawn and the builder shows labels.
 *
 * A tile is claimed before it's drawn, so two runs can't pay for it twice, and a refused one stays refused (its prompt
 * isn't redrawn on the off chance). A picture Hive couldn't screen (busy, down) isn't a refusal: it's kept unshown and
 * screened again on the next run, so it's never paid for twice. The admin draws them a batch at a time (POST /api/admin/looks).
 * While Hive is over its daily limit (lib/adult/hive-limit.ts), no tile or portrait is drawn and nothing goes to Hive.
 */
import { recordAsset, reviewAsset } from "./assets";
import { checkOutput } from "./adult/check";
import { canAfterDark } from "./adult/entitlement";
import { hiveGate, hivePausedMessage, hivePausedUntil, underHiveLimit } from "./adult/hive-limit";
import { NEGATIVE_PROMPT, VENICE_IMAGE } from "./adult/media";
import { adultKeys, getAdultSettings } from "./adult/settings";
import type { Db } from "./db";
import { dataColumn, keepBytes, objectStore, readBytes } from "./object-store";
import { looksPortraitPrompt, tileSpecs, type Looks, type TileSpec, type TileVariant } from "./looks";

/** FLUX [dev] on fal: faces and fabric good enough to choose from, about 1.3¢ for a tile this size. */
export const LOOKS_PG_MODEL = "fal-ai/flux/dev";
export const LOOKS_PORTRAIT_VERSION = "looks-v1";
const FAL_RUN = "https://fal.run";
const MAX_BYTES = 12 * 1024 * 1024;
/** A tile that failed to draw (not refused) may be tried again after this long. */
const RETRY_AFTER_MS = 2 * 60 * 1000;

/** Portraits drawn on our keys: this many per character, and this many a day across the site (LOOKS_PORTRAITS_PER_DAY). */
export const PORTRAITS_PER_CHARACTER = 3;
export const DEFAULT_PORTRAITS_PER_DAY = 150;
export const portraitsPerDay = (env: Record<string, string | undefined> = process.env): number => {
  const n = Number(env.LOOKS_PORTRAITS_PER_DAY);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_PORTRAITS_PER_DAY;
};

type Fetch = typeof fetch;
let testFetch: Fetch | null = null;
export function setLooksFetchForTests(f: Fetch | null): void {
  testFetch = f;
}
const doFetch: Fetch = (...a) => (testFetch ?? fetch)(...a);

type Picture = { bytes: Buffer; mime: string; url: string | null };
type Keys = { fal: string | null; venice: string | null; hive: string | null };
/** A picture that was made but couldn't be screened (Hive busy or down): kept to check again, never shown. */
type Unchecked = Picture & { unchecked: string };
type Drawn = Picture | Unchecked | { refused: string } | { failed: string };

/** Hive couldn't give a verdict (a rate limit, an outage, an odd reply): a reason to check again, not a refusal. */
const UNCHECKED = /^(the check couldn't run|moderation reply had no child scores)/;
const UNCHECKED_PREFIX = "unchecked: ";

/**
 * Screens a show picture: everyone an adult (Hive's child classifier and its age check). Nothing explicit is fal's own
 * safety checker's job (on for every show picture; drawPg refuses what it flags), so Hive isn't asked twice: self-serve
 * Hive has a small daily quota, and the site's sets and After Dark pictures share it.
 */
async function screenPg(db: Db, hive: string | null, url: string): Promise<{ ok: true } | { refused: string } | { unchecked: string }> {
  // Held to Hive's daily limit (lib/adult/hive-limit.ts): while it's out, nothing is sent and the picture waits unscreened.
  const v = await underHiveLimit(db, () => checkOutput(hive, url, "image"));
  if (v.ok) return { ok: true };
  return UNCHECKED.test(v.reason) ? { unchecked: v.reason } : { refused: v.reason };
}

/** Screens an After Dark picture: everyone shown an adult. */
async function screenNsfw(db: Db, hive: string | null, b64: string, mime: string): Promise<{ ok: true } | { refused: string } | { unchecked: string }> {
  const v = await underHiveLimit(db, () => checkOutput(hive, { base64: b64, mime }, "image"));
  if (v.ok) return { ok: true };
  return UNCHECKED.test(v.reason) ? { unchecked: v.reason } : { refused: v.reason };
}

/** A show picture on fal, then Hive. */
async function drawPg(db: Db, keys: Keys, prompt: string, seed: number | null, size: { width: number; height: number }): Promise<Drawn> {
  if (!keys.fal || !keys.hive) return { failed: "no fal or Hive key saved" };
  const res = await doFetch(`${FAL_RUN}/${LOOKS_PG_MODEL}`, {
    method: "POST",
    headers: { authorization: `Key ${keys.fal}`, "content-type": "application/json" },
    body: JSON.stringify({ prompt, image_size: size, num_images: 1, num_inference_steps: 28, output_format: "jpeg", enable_safety_checker: true, ...(seed === null ? {} : { seed }) }),
  });
  if (!res.ok) return res.status === 422 ? { refused: `fal.ai 422` } : { failed: `fal.ai ${res.status}: ${(await res.text()).slice(0, 200)}` };
  const body = (await res.json()) as { images?: { url?: string }[]; has_nsfw_concepts?: boolean[] };
  const url = body.images?.[0]?.url;
  if (!url) return { failed: "fal.ai returned no picture" };
  if (body.has_nsfw_concepts?.[0]) return { refused: "fal.ai flagged it as explicit" };
  const file = await doFetch(url);
  if (!file.ok) return { failed: `download ${file.status}` };
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length > MAX_BYTES) return { failed: "file too large" };
  const pic = { bytes, mime: file.headers.get("content-type") ?? "image/jpeg", url };
  const v = await screenPg(db, keys.hive, url);
  return "ok" in v ? pic : "refused" in v ? v : { ...pic, unchecked: v.unchecked };
}

/** An After Dark picture on Venice (bytes come back in the reply), then Hive. */
async function drawNsfw(db: Db, keys: Keys, prompt: string, seed: number): Promise<Drawn> {
  if (!keys.venice || !keys.hive) return { failed: "no Venice or Hive key saved" };
  const { venice_image_model } = await getAdultSettings(db);
  const res = await doFetch(VENICE_IMAGE, {
    method: "POST",
    headers: { authorization: `Bearer ${keys.venice}`, "content-type": "application/json" },
    body: JSON.stringify({ model: venice_image_model, prompt, negative_prompt: NEGATIVE_PROMPT, width: 768, height: 960, seed, format: "webp", safe_mode: false, hide_watermark: true }),
  });
  if (!res.ok) return { failed: `Venice ${res.status}: ${(await res.text()).slice(0, 200)}` };
  if (res.headers.get("x-venice-is-content-violation") === "true") return { refused: "Venice flagged it as against its terms" };
  const b64 = ((await res.json()) as { images?: string[] }).images?.[0];
  if (!b64) return { failed: "Venice returned no picture" };
  const bytes = Buffer.from(b64, "base64");
  if (bytes.length > MAX_BYTES) return { failed: "file too large" };
  const pic = { bytes, mime: "image/webp", url: null };
  const v = await screenNsfw(db, keys.hive, b64, pic.mime);
  return "ok" in v ? pic : "refused" in v ? v : { ...pic, unchecked: v.unchecked };
}

async function keysFor(db: Db): Promise<Keys> {
  const k = await adultKeys(db).catch(() => null);
  return { fal: k?.fal ?? null, venice: k?.venice ?? null, hive: k?.hive ?? null };
}

/**
 * Tiles worth another go: one that failed to draw (after a short wait), and one whose picture couldn't be screened
 * (including those stored as refused before that was told apart from a real refusal).
 */
const RETRYABLE = `(look_tiles.status = 'failed' and look_tiles.updated_at < now() - ($4::int * interval '1 millisecond'))
   or (look_tiles.status = 'refused' and look_tiles.reason like 'the check couldn''t run%')`;

/** Draws one tile if it isn't drawn (or refused, or being drawn). Never throws. */
export async function drawTile(db: Db, spec: TileSpec, keys?: Keys): Promise<string> {
  const claimed = await db.query<{ data: Buffer | Uint8Array | null; object_key: string | null; mime: string | null; reason: string | null; remote_url: string | null }>(
    `insert into look_tiles (id, variant, status, prompt) values ($1, $2, 'drawing', $3)
     on conflict (id) do update set status = 'drawing', prompt = excluded.prompt, updated_at = now()
       where ${RETRYABLE}
     returning ${dataColumn("look_tiles")}, object_key, mime, reason, remote_url`,
    [spec.id, spec.variant, spec.prompt, RETRY_AFTER_MS],
  );
  if (!claimed.rows.length) return "exists";
  const prev = claimed.rows[0];
  // The picture's bytes go to the bucket when it's configured (lib/object-store.ts), else the data column. `key`: the
  // kept picture already in the bucket, screened again, isn't uploaded twice.
  const done = async (status: "ready" | "refused" | "failed", reason: string | null, file?: Picture, key?: string | null) => {
    const kept = key ? { data: null, object_key: key } : file ? await keepBytes("looks", spec.id, file.bytes, file.mime) : { data: null, object_key: null };
    await db.query(`update look_tiles set status = $2, reason = $3, mime = $4, data = $5, object_key = $6, model = $7, remote_url = $8, updated_at = now() where id = $1`, [
      spec.id,
      status,
      reason?.slice(0, 300) ?? null,
      file?.mime ?? null,
      kept.data,
      kept.object_key,
      spec.variant === "pg" ? LOOKS_PG_MODEL : "venice",
      file?.url ?? null,
    ]);
    // A refusal is never kept: a picture that was kept unscreened, then refused, leaves the bucket too.
    if (prev.object_key && prev.object_key !== kept.object_key) await objectStore()?.remove(prev.object_key).catch(() => {});
    return status;
  };
  try {
    const k = keys ?? (await keysFor(db));
    // Made before but not screened: screen the kept picture again, rather than paying to draw a new one.
    const prevBytes = prev.mime && prev.reason?.startsWith(UNCHECKED_PREFIX) ? await readBytes(prev) : null;
    if (prevBytes && prev.mime) {
      const pic = { bytes: prevBytes, mime: prev.mime, url: prev.remote_url };
      const v = spec.variant === "pg" ? (pic.url ? await screenPg(db, k.hive, pic.url) : { refused: "nothing to screen" }) : await screenNsfw(db, k.hive, pic.bytes.toString("base64"), pic.mime);
      if ("ok" in v) return done("ready", null, pic, prev.object_key);
      if ("refused" in v) return done("refused", v.refused);
      return done("failed", UNCHECKED_PREFIX + v.unchecked, pic, prev.object_key);
    }
    const r = spec.variant === "pg" ? await drawPg(db, k, spec.prompt, spec.seed, { width: 512, height: 640 }) : await drawNsfw(db, k, spec.prompt, spec.seed);
    if ("refused" in r) return done("refused", r.refused);
    if ("failed" in r) return done("failed", r.failed);
    if ("unchecked" in r) return done("failed", UNCHECKED_PREFIX + r.unchecked, r);
    return done("ready", null, r);
  } catch (err) {
    return done("failed", err instanceof Error ? err.message : "error");
  }
}

/** A provider said slow down: stop this batch rather than paying for pictures that can't be screened. */
const RATE_LIMITED = /\b429\b/;
/** A pause between tiles, so one batch stays under Hive's and Venice's rate limits. */
let pauseMs = 1500;
export function setLooksPauseForTests(ms: number): void {
  pauseMs = ms;
}

/**
 * Draws up to `limit` tiles that aren't drawn yet (of one variant, or both), one at a time. Returns what happened to
 * each, and stops early when a provider rate-limits. Draws none while Hive is over its daily limit (lib/adult/hive-limit.ts):
 * they couldn't be screened.
 */
export async function drawMissingTiles(db: Db, opts: { limit?: number; variant?: TileVariant; only?: string[] } = {}): Promise<{ id: string; status: string }[]> {
  if (await hivePausedUntil(db)) return [];
  const done = new Set(
    (
      await db.query<{ id: string }>(
        `select id from look_tiles where status in ('ready', 'drawing') or (status = 'refused' and reason not like 'the check couldn''t run%')`,
      )
    ).rows.map((r) => r.id),
  );
  const todo = tileSpecs()
    .filter((s) => (!opts.variant || s.variant === opts.variant) && (!opts.only?.length || opts.only.includes(s.id)) && !done.has(s.id))
    .slice(0, Math.max(1, Math.min(opts.limit ?? 10, 40)));
  const keys = await keysFor(db);
  const out: { id: string; status: string }[] = [];
  for (const [i, s] of todo.entries()) {
    if (i && pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
    const status = await drawTile(db, s, keys);
    out.push({ id: s.id, status });
    if (status === "failed") {
      const reason = (await db.query<{ reason: string | null }>(`select reason from look_tiles where id = $1`, [s.id])).rows[0]?.reason ?? "";
      if (RATE_LIMITED.test(reason)) break;
    }
  }
  return out;
}

/** How many tiles are in each state, per variant (the admin's progress). */
export async function tileProgress(db: Db): Promise<{ total: Record<TileVariant, number>; states: Record<string, number>; refused: { id: string; reason: string | null }[] }> {
  const specs = tileSpecs();
  const { rows } = await db.query<{ id: string; variant: TileVariant; status: string; reason: string | null }>(`select id, variant, status, reason from look_tiles`);
  const known = new Set(specs.map((s) => s.id));
  const states: Record<string, number> = {};
  for (const r of rows) if (known.has(r.id)) states[`${r.variant}:${r.status}`] = (states[`${r.variant}:${r.status}`] ?? 0) + 1;
  return {
    total: { pg: specs.filter((s) => s.variant === "pg").length, nsfw: specs.filter((s) => s.variant === "nsfw").length },
    states,
    refused: rows.filter((r) => r.status !== "ready" && r.status !== "drawing").map((r) => ({ id: r.id, reason: r.reason })),
  };
}

/** The ids of the drawn tiles of a variant (so the builder only asks for pictures that exist). */
export async function readyTiles(db: Db, variant: TileVariant): Promise<string[]> {
  return (await db.query<{ id: string }>(`select id from look_tiles where variant = $1 and status = 'ready' order by id`, [variant])).rows.map((r) => r.id);
}

/**
 * A drawn tile: where it is (its bucket key, when it's been moved there and the bucket is configured), and its bytes
 * unless `bytes: false` and it's in the bucket (the route then hands out a link instead of reading it).
 */
export async function getTile(db: Db, id: string, opts: { bytes?: boolean } = {}): Promise<{ variant: TileVariant; mime: string; key: string | null; data: Buffer | null } | null> {
  const r = (
    await db.query<{ variant: TileVariant; mime: string; data: Buffer | Uint8Array | null; object_key: string | null }>(
      `select variant, mime, ${dataColumn()}, object_key from look_tiles where id = $1 and status = 'ready'`,
      [id],
    )
  ).rows[0];
  if (!r) return null;
  const key = r.object_key && objectStore() ? r.object_key : null;
  const data = key && opts.bytes === false ? null : await readBytes(r);
  if (!key && !data) return null;
  return { variant: r.variant, mime: r.mime, key, data };
}

export type PortraitResult = { ok: true; asset_id: string } | { ok: false; status: number; error: string; message: string };

/**
 * A character's portrait from its picks, on our fal key, screened by Hive, recorded in the asset ledger and approved
 * (Hive-screened generation from fixed option words, nothing typed). Capped per character and per day.
 */
export async function drawLooksPortrait(db: Db, characterId: string, env: Record<string, string | undefined> = process.env): Promise<PortraitResult> {
  const c = (await db.query<{ age: number; extras: { looks?: Looks } | null }>(`select age, extras from characters where id = $1`, [characterId])).rows[0];
  const prompt = c?.extras?.looks ? looksPortraitPrompt(c.extras.looks, c.age) : null;
  if (!prompt) return { ok: false, status: 400, error: "no_looks", message: "Pick their looks first (at least who they are), then draw a portrait." };
  const used = await db.query<{ mine: number; today: number }>(
    `select count(*) filter (where character_id = $1)::int as mine,
            count(*) filter (where created_at > now() - interval '1 day')::int as today
       from character_assets where kind = 'portrait' and prompt_version = $2`,
    [characterId, LOOKS_PORTRAIT_VERSION],
  );
  const { mine, today } = used.rows[0] ?? { mine: 0, today: 0 };
  if (mine >= PORTRAITS_PER_CHARACTER) return { ok: false, status: 429, error: "portrait_limit", message: `That's all ${PORTRAITS_PER_CHARACTER} portraits for this character.` };
  if (today >= portraitsPerDay(env)) return { ok: false, status: 429, error: "portraits_busy", message: "Today's portraits are all drawn. Try again tomorrow." };
  const keys = await keysFor(db);
  // Hive over its daily limit (lib/adult/hive-limit.ts): an unscreened portrait is never kept, so none is drawn (or paid for).
  const gate = await hiveGate(db, keys.hive);
  if (!gate.ok) return { ok: false, status: 503, error: "hive_paused", message: gate.message };
  const r = await drawPg(db, keys, prompt, null, { width: 640, height: 800 }).catch((err: unknown) => ({ failed: err instanceof Error ? err.message : "error" }));
  if ("refused" in r) return { ok: false, status: 422, error: "portrait_refused", message: "The picture didn't pass our check. Try other looks." };
  // Unscreened because Hive just ran out of its daily allowance: not kept, and the pause says until when.
  const paused = "unchecked" in r ? await hivePausedUntil(db) : null;
  if (paused) return { ok: false, status: 503, error: "hive_paused", message: hivePausedMessage(paused, { discarded: true }) };
  // Unscreened (Hive busy) is never approved: the same as a failure, try again.
  if ("failed" in r || "unchecked" in r) return { ok: false, status: 502, error: "portrait_failed", message: "The portrait couldn't be drawn right now. Try again in a bit." };
  const assetId = await recordAsset(db, {
    character_id: characterId,
    kind: "portrait",
    source_type: "generated",
    source_model: `fal:${LOOKS_PG_MODEL}`,
    prompt,
    prompt_version: LOOKS_PORTRAIT_VERSION,
    url: `data:${r.mime};base64,${r.bytes.toString("base64")}`,
  });
  await reviewAsset(db, assetId, "approved", "looks: Hive-screened generation from the builder's fixed option words");
  return { ok: true, asset_id: assetId };
}

/**
 * Keeps a character's After Dark picks only for an account that can open After Dark (an admin, or a subscriber with a
 * passed age check); everyone else's are dropped on save. Returns the extras to store.
 */
export async function gateAfterDarkLooks<E extends { looks?: Looks } | null | undefined>(db: Db, auth: { userId: string; authenticated: boolean }, extras: E): Promise<E> {
  if (!extras?.looks?.after_dark) return extras;
  if ((await canAfterDark(db, auth)).ok) return extras;
  const { after_dark: _ad, ...looks } = extras.looks;
  return { ...extras, looks } as E;
}

/** What the builder needs for a viewer: the drawn tiles it may see, and whether After Dark's tab opens for them. */
export async function builderLooks(db: Db, auth: { userId: string; authenticated: boolean } | null): Promise<{ tiles: string[]; afterDark: boolean }> {
  const afterDark = (await canAfterDark(db, auth).catch(() => ({ ok: false }))).ok;
  const [pg, nsfw] = await Promise.all([readyTiles(db, "pg").catch(() => []), afterDark ? readyTiles(db, "nsfw").catch(() => []) : Promise.resolve([])]);
  return { tiles: [...pg, ...nsfw], afterDark };
}
