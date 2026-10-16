/**
 * The image-rights ledger (the competitor report's "don't forget image rights and moderation").
 *
 * Botchelor ships no hosted imagery: avatars and venue backdrops are drawn from character data, so
 * there is nothing to licence, credit or moderate. This module is the gate every later portrait,
 * expression or background has to come through — it records where an asset came from and refuses to
 * serve one a human has not approved. Reads are approved-only by construction: there is no function
 * here that returns a pending or rejected asset to a page.
 */
import type { Db } from "./db";

export const ASSET_KINDS = ["portrait", "expression", "background", "decoration", "clip"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** 'drawn' is what the app does today (generated from character data, no file). The rest need review. */
export const ASSET_SOURCE_TYPES = ["drawn", "generated", "uploaded", "licensed"] as const;
export type AssetSourceType = (typeof ASSET_SOURCE_TYPES)[number];

export const ASSET_REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;
export type AssetReviewStatus = (typeof ASSET_REVIEW_STATUSES)[number];

export type CharacterAsset = {
  id: string;
  character_id: string | null;
  kind: AssetKind;
  source_type: AssetSourceType;
  source_model: string | null;
  prompt: string | null;
  prompt_version: string | null;
  seed: number | null;
  source_url: string | null;
  license_name: string | null;
  attribution: string | null;
  url: string | null;
  review_status: AssetReviewStatus;
};

/** An asset as it is first recorded: always pending, never servable until somebody approves it. */
export type NewAsset = {
  character_id?: string | null;
  kind: AssetKind;
  source_type: AssetSourceType;
  source_model?: string | null;
  prompt?: string | null;
  prompt_version?: string | null;
  seed?: number | null;
  source_url?: string | null;
  license_name?: string | null;
  attribution?: string | null;
  url?: string | null;
};

const COLUMNS =
  "id, character_id, kind, source_type, source_model, prompt, prompt_version, seed::float8 as seed, source_url, license_name, attribution, url, review_status";

/**
 * The provenance an asset cannot be stored without: a licensed asset has to name its source and
 * licence, a generated one its generator. The same rules are CHECK constraints in lib/db.ts, so a
 * direct insert can't get round them; this is the readable error for the caller.
 */
export function assetProvenanceError(asset: NewAsset): string | null {
  if (asset.source_type === "licensed" && !(asset.source_url && asset.license_name)) {
    return "a licensed asset needs source_url and license_name";
  }
  if (asset.source_type === "generated" && !asset.source_model) {
    return "a generated asset needs source_model (which generator made it)";
  }
  return null;
}

/** Records an asset as pending review. Throws if its provenance is incomplete. Returns its id. */
export async function recordAsset(db: Db, asset: NewAsset): Promise<string> {
  const problem = assetProvenanceError(asset);
  if (problem) throw new Error(`asset provenance: ${problem}`);
  const id = crypto.randomUUID();
  await db.query(
    `insert into character_assets (id, character_id, kind, source_type, source_model, prompt, prompt_version,
                                   seed, source_url, license_name, attribution, url)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      id,
      asset.character_id ?? null,
      asset.kind,
      asset.source_type,
      asset.source_model ?? null,
      asset.prompt ?? null,
      asset.prompt_version ?? null,
      asset.seed ?? null,
      asset.source_url ?? null,
      asset.license_name ?? null,
      asset.attribution ?? null,
      asset.url ?? null,
    ],
  );
  return id;
}

/** A human's decision on one asset. Approving needs a url to serve (enforced in the schema too). */
export async function reviewAsset(
  db: Db,
  id: string,
  status: Exclude<AssetReviewStatus, "pending">,
  note?: string,
): Promise<void> {
  await db.query(
    "update character_assets set review_status = $2, reviewed_at = now(), reviewed_note = $3 where id = $1",
    [id, status, note ?? null],
  );
}

/** The approved assets for a character (or the shared ones, with `null`). Never returns unreviewed rows. */
export async function listApprovedAssets(
  db: Db,
  characterId: string | null,
  kind?: AssetKind,
): Promise<CharacterAsset[]> {
  const { rows } = await db.query<CharacterAsset>(
    `select ${COLUMNS} from character_assets
      where review_status = 'approved'
        and (($1::text is null and character_id is null) or character_id = $1)
        and ($2::text is null or kind = $2)
      order by created_at`,
    [characterId, kind ?? null],
  );
  return rows;
}

/** One approved asset by id (for the serving route), or null if it's missing or not approved. */
export async function getApprovedAsset(db: Db, id: string): Promise<CharacterAsset | null> {
  const { rows } = await db.query<CharacterAsset>(
    `select ${COLUMNS} from character_assets where id = $1 and review_status = 'approved'`,
    [id],
  );
  return rows[0] ?? null;
}

/** The newest approved portrait of the character whose id is the SQL expression `characterId`. */
const approvedPortraitSelect = (characterId: string) =>
  `select portrait_asset.id from character_assets portrait_asset
    where portrait_asset.character_id = ${characterId} and portrait_asset.kind = 'portrait'
      and portrait_asset.review_status = 'approved' and portrait_asset.url is not null
    order by portrait_asset.created_at desc limit 1`;

/** The id of a character's newest approved portrait, or null. For rendering a generated avatar. */
export async function approvedPortraitId(db: Db, characterId: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(approvedPortraitSelect("$1"), [characterId]);
  return rows[0]?.id ?? null;
}

/**
 * A character's newest approved portrait as a data URL a share card (next/og) can embed, or null. Only PNG or
 * JPEG: the card's rasterizer draws a webp as nothing at all, so the card keeps the gradient tile for those (and
 * for the house cast, whose ledger rows point at /cast files).
 */
export async function approvedPortraitDataUrl(db: Db, characterId: string): Promise<string | null> {
  const id = await approvedPortraitId(db, characterId);
  const url = id ? (await getApprovedAsset(db, id))?.url : null;
  return url && /^data:image\/(png|jpeg);base64,/.test(url) ? url : null;
}

/**
 * SQL for the served path (`/api/assets/<id>`) of the newest approved portrait of the `characters` row aliased
 * `alias`, or null when it has none. approvedPortraitId inline, so every list of characters (an episode's two,
 * the feed, the cast, a watch room) carries its generated portraits in the same statement, not a read per avatar.
 */
export const portraitPathSql = (alias: string): string => `('/api/assets/' || (${approvedPortraitSelect(`${alias}.id`)}))`;

/** A character's newest clip asset in ANY state (for the owner's status poll), or null. */
export async function latestClip(db: Db, characterId: string): Promise<CharacterAsset | null> {
  const { rows } = await db.query<CharacterAsset>(
    `select ${COLUMNS} from character_assets where character_id = $1 and kind = 'clip' order by created_at desc limit 1`,
    [characterId],
  );
  return rows[0] ?? null;
}

/** The id of a character's newest APPROVED clip, or null (for rendering the video on the card). */
export async function approvedClipId(db: Db, characterId: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `select id from character_assets
      where character_id = $1 and kind = 'clip' and review_status = 'approved' and url is not null
      order by created_at desc limit 1`,
    [characterId],
  );
  return rows[0]?.id ?? null;
}

/**
 * Whether a character's newest approved clip is a playable video stored with us (a Veo clip, lib/video.ts) or
 * only a still (a clip from the retired Sora era, whose MP4 lived with OpenAI).
 */
export async function approvedClipIsVideo(db: Db, clipId: string): Promise<boolean> {
  const { rows } = await db.query<{ video: boolean }>(`select url like 'data:video/mp4;%' as video from character_assets where id = $1`, [clipId]);
  return Boolean(rows[0]?.video);
}

/** Sets an asset's servable file + video reference (completing a clip) without changing its review state. */
export async function setAssetMedia(db: Db, id: string, url: string, sourceUrl?: string | null): Promise<void> {
  await db.query(`update character_assets set url = $2, source_url = coalesce($3, source_url) where id = $1`, [id, url, sourceUrl ?? null]);
}

/** The approved asset plus the id of the character it belongs to (for proxying a clip on the owner's key). */
export async function approvedAssetWithOwner(db: Db, id: string): Promise<{ asset: CharacterAsset; owner_id: string | null } | null> {
  const asset = await getApprovedAsset(db, id);
  if (!asset?.character_id) return asset ? { asset, owner_id: null } : null;
  const { rows } = await db.query<{ owner_id: string | null }>(`select owner_id from characters where id = $1`, [asset.character_id]);
  return { asset, owner_id: rows[0]?.owner_id ?? null };
}

/** The credit line a licensed asset's licence requires, or null when no credit is owed. */
export const attributionLine = (asset: CharacterAsset): string | null =>
  asset.attribution ? `${asset.attribution}${asset.license_name ? ` (${asset.license_name})` : ""}` : null;
