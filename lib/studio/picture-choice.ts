/**
 * Choose a picture for a character (David, 2026-10-25: "let them choose an image for their character as the baseline and
 * their profile icon"; his pick: from the pictures they already have, never an upload, so no real person's photo can
 * become a character). The choices are the character's PG Studio pictures (lib/studio/pg.ts) and the portraits drawn for
 * them before; each can be:
 *
 *  - **their profile picture** (the portrait on every page and share card): a `pg` picture only, recorded in the asset
 *    ledger like any portrait (lib/assets.ts), approved because it already passed the PG check. An earlier portrait
 *    chosen again becomes the newest (the newest approved pg portrait is the face everywhere).
 *  - **their After Dark face** (the baseline every After Dark picture and video starts from, lib/adult/steering.ts): for
 *    someone After Dark is open to, with the character switched into their After Dark. The picture is copied into their
 *    After Dark media and kept as the face, as "Use this face" does there.
 *
 * The owner's own characters only.
 */
import { tagNow } from "../adult/media-tags";
import { recordAsset, reviewAsset } from "../assets";
import { eligibleIds } from "../adult/characters";
import { canAfterDark } from "../adult/entitlement";
import { setFaceReference, faceReferenceId } from "../adult/steering";
import type { Db } from "../db";
import { keepBytes, readBytes } from "../object-store";

export type PictureChoices = {
  studio: { id: string; rating: "pg" | "suggestive" }[];
  portraits: { id: string; current: boolean }[];
  /** After Dark is open to them and the character is in their After Dark: "After Dark face" is offered. */
  after_dark: boolean;
  /** The After Dark face now, when it came from one of these (its source's id). */
  face_from: string | null;
};
export type ChoiceFail = { ok: false; status: number; message: string };
const fail = (status: number, message: string): ChoiceFail => ({ ok: false, status, message });

async function owns(db: Db, viewer: string, characterId: string): Promise<boolean> {
  const r = await db.query<{ owner_id: string | null }>(`select owner_id from characters where id = $1`, [characterId]);
  return Boolean(viewer) && r.rows[0]?.owner_id === viewer;
}

async function afterDarkFor(db: Db, viewer: string, characterId: string): Promise<boolean> {
  if (!(await canAfterDark(db, { userId: viewer, authenticated: true })).ok) return false;
  return (await eligibleIds(db, viewer)).has(characterId);
}

/** What they can choose from, newest first. */
export async function pictureChoices(db: Db, viewer: string, characterId: string): Promise<{ ok: true; choices: PictureChoices } | ChoiceFail> {
  if (!(await owns(db, viewer, characterId))) return fail(404, "That's not one of your characters.");
  const [studio, portraits, ad] = await Promise.all([
    db.query<{ id: string; content_rating: "pg" | "suggestive" }>(
      `select id, content_rating from studio_pg_pictures where owner_id = $1 and character_id = $2 and content_rating in ('pg', 'suggestive') order by created_at desc limit 60`,
      [viewer, characterId],
    ),
    db.query<{ id: string }>(
      `select id from character_assets where character_id = $1 and kind = 'portrait' and review_status = 'approved' and content_rating = 'pg' and url like 'data:image/%'
        order by created_at desc limit 12`,
      [characterId],
    ),
    afterDarkFor(db, viewer, characterId),
  ]);
  const face = ad ? await faceReferenceId(db, viewer, characterId).catch(() => null) : null;
  const faceFrom = face ? ((await db.query<{ source_image: string | null }>(`select source_image from adult_images where id = $1`, [face])).rows[0]?.source_image ?? null) : null;
  return {
    ok: true,
    choices: {
      studio: studio.rows.map((r) => ({ id: r.id, rating: r.content_rating })),
      portraits: portraits.rows.map((r, i) => ({ id: r.id, current: i === 0 })),
      after_dark: ad,
      face_from: faceFrom,
    },
  };
}

type Picked = { bytes: Buffer; mime: string; rating: "pg" | "suggestive"; model: string | null };

/** A choice's bytes: a Studio picture of theirs, or a portrait of the character (a data URL). */
async function picked(db: Db, viewer: string, characterId: string, source: "studio" | "portrait", id: string): Promise<Picked | null> {
  if (source === "studio") {
    const r = (
      await db.query<{ mime: string; data: Buffer | Uint8Array | null; object_key: string | null; content_rating: string; model: string | null }>(
        `select mime, data, object_key, content_rating, model from studio_pg_pictures where id = $1 and owner_id = $2 and character_id = $3`,
        [id, viewer, characterId],
      )
    ).rows[0];
    if (!r || (r.content_rating !== "pg" && r.content_rating !== "suggestive")) return null;
    const bytes = await readBytes(r);
    return bytes ? { bytes, mime: r.mime, rating: r.content_rating, model: r.model } : null;
  }
  const a = (
    await db.query<{ url: string | null; source_model: string | null }>(
      `select url, source_model from character_assets where id = $1 and character_id = $2 and kind = 'portrait' and review_status = 'approved' and content_rating = 'pg'`,
      [id, characterId],
    )
  ).rows[0];
  const m = a?.url ? /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(a.url) : null;
  return m ? { bytes: Buffer.from(m[2], "base64"), mime: m[1], rating: "pg", model: a?.source_model ?? null } : null;
}

export type UseResult = { ok: true; portrait_path?: string; face_id?: string } | ChoiceFail;

/** Makes a choice their profile picture or their After Dark face. */
export async function usePicture(db: Db, viewer: string, characterId: string, input: { source: "studio" | "portrait"; id: string; as: "portrait" | "face" }): Promise<UseResult> {
  if (!(await owns(db, viewer, characterId))) return fail(404, "That's not one of your characters.");
  if (input.as === "portrait" && input.source === "portrait") {
    // An earlier portrait: made the newest, so it's the one shown everywhere.
    const r = await db.query<{ id: string }>(
      `update character_assets set created_at = now() where id = $1 and character_id = $2 and kind = 'portrait' and review_status = 'approved' and content_rating = 'pg' returning id`,
      [input.id, characterId],
    );
    return r.rows.length ? { ok: true, portrait_path: `/api/assets/${input.id}` } : fail(404, "No such portrait.");
  }
  const p = await picked(db, viewer, characterId, input.source, input.id);
  if (!p) return fail(404, "No such picture of them.");
  if (input.as === "portrait") {
    // Their face on every public page: only what the PG check called pg.
    if (p.rating !== "pg") return fail(422, "A profile picture has to be one the Studio's check called safe for everyone (this one is marked suggestive).");
    const assetId = await recordAsset(db, {
      character_id: characterId,
      kind: "portrait",
      source_type: "generated",
      source_model: `studio-pg:${p.model ?? "venice"}`,
      prompt: "Chosen by its owner from the Studio",
      prompt_version: "studio-pg-v1",
      url: `data:${p.mime};base64,${p.bytes.toString("base64")}`,
      content_rating: "pg",
    });
    await reviewAsset(db, assetId, "approved", "chosen from a PG Studio picture that passed the PG check");
    return { ok: true, portrait_path: `/api/assets/${assetId}` };
  }
  if (!(await afterDarkFor(db, viewer, characterId))) return fail(403, "Their After Dark face is for After Dark: switch them into your After Dark first.");
  const id = crypto.randomUUID();
  const kept = await keepBytes("after-dark", id, p.bytes, p.mime);
  await db.query(
    `insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, object_key, status, provider, model, source_image, content_rating)
     values ($1, $2, $3, 'baseline', 'Chosen by its owner as their face', $4, $5, $6, 'ready', 'studio-pg', $7, $8, $9)`,
    [id, viewer, characterId, p.mime, kept.data, kept.object_key, p.model, input.id, p.rating],
  );
  // Tagged as it's made (lib/adult/media-tags.ts): a baseline, dressed.
  await tagNow(db, [id]);
  const set = await setFaceReference(db, viewer, characterId, id);
  return set.ok ? { ok: true, face_id: id } : fail(set.status, set.message);
}
