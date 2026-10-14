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

export const ASSET_KINDS = ["portrait", "expression", "background", "decoration"] as const;
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
  "id, character_id, kind, source_type, source_model, prompt, prompt_version, seed::int as seed, source_url, license_name, attribution, url, review_status";

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

/** The credit line a licensed asset's licence requires, or null when no credit is owed. */
export const attributionLine = (asset: CharacterAsset): string | null =>
  asset.attribution ? `${asset.attribution}${asset.license_name ? ` (${asset.license_name})` : ""}` : null;
