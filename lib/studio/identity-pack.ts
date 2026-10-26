/**
 * The identity pack's views as kept (identity_views; lib/studio/identity-views.ts): which picture is which view of a
 * character, per person and Studio, and the face each was drawn from. A view drawn from an earlier face is stale: the
 * pack shows it as such, and nothing uses it (2026-10-26: a face anchor drawn from an old face kept every shoot on it).
 */
import type { Db } from "../db";
import { isIdentityView, type IdentityViewId } from "./identity-views";

export type IdentityStudio = "after_dark" | "pg";
/** The views there are, by view: the picture, and whether it was drawn from a face they've since changed. */
export type IdentityPack = Partial<Record<IdentityViewId, { id: string; stale: boolean }>>;

/** Their views of the character in one Studio, still there; `face` is the face they keep now (stale: drawn from another). */
export async function identityPackOf(db: Db, owner: string, characterId: string, studio: IdentityStudio, face: string | null): Promise<IdentityPack> {
  const join =
    studio === "after_dark"
      ? "join adult_images p on p.id = v.image_id and p.owner_id = v.owner_id and p.status = 'ready'"
      : "join studio_pg_pictures p on p.id = v.image_id and p.owner_id = v.owner_id";
  const { rows } = await db.query<{ view: string; image_id: string; from_face: string | null }>(
    `select v.view, v.image_id, v.from_face from identity_views v ${join} where v.owner_id = $1 and v.character_id = $2 and v.studio = $3`,
    [owner, characterId, studio],
  );
  const pack: IdentityPack = {};
  for (const r of rows) if (isIdentityView(r.view)) pack[r.view] = { id: r.image_id, stale: r.from_face !== face };
  return pack;
}

/** The views that can be used: the ones drawn from the face they keep now. */
export function freshViews(pack: IdentityPack): Partial<Record<IdentityViewId, string>> {
  const out: Partial<Record<IdentityViewId, string>> = {};
  for (const [view, v] of Object.entries(pack) as [IdentityViewId, { id: string; stale: boolean }][]) if (!v.stale) out[view] = v.id;
  return out;
}

/** One view kept: it replaces the one there was. */
export async function keepIdentityView(db: Db, owner: string, characterId: string, studio: IdentityStudio, view: IdentityViewId, imageId: string, fromFace: string | null): Promise<void> {
  await db.query(
    `insert into identity_views (owner_id, character_id, studio, view, image_id, from_face) values ($1, $2, $3, $4, $5, $6)
     on conflict (owner_id, character_id, studio, view) do update set image_id = excluded.image_id, from_face = excluded.from_face, created_at = now()`,
    [owner, characterId, studio, view, imageId, fromFace],
  );
}
