/**
 * What a PG Studio picture is for past the Studio (the PG Studio plan's "uses"; David, 2026-10-25 and 2026-10-30):
 *
 *  - **Their profile photos:** up to PROFILE_PHOTOS_MAX pinned pictures on the character's page, the ones other people
 *    and agents see (get_character's `photo_urls`). Only a `pg` one: a suggestive picture stays in the Studio. Each is
 *    copied into the asset ledger (lib/assets.ts) as an approved pg photo, so /api/assets serves it as it serves a
 *    portrait, to anyone. Unpinned, or deleted from the Studio, and the copy is rejected: its link stops working.
 *  - **A photo in their texts:** sent to a character theirs has dated (lib/adult/shares.ts sharePartners), as the After
 *    Dark Studio's dressed photo is, and under the same switch (`studio.share.photos`). Pg only, and free.
 *
 * The owner's own characters and pictures only; profile photos of a private character show to its owner only, as its
 * page does.
 */
import { recordAsset, reviewAsset } from "../assets";
import { insertText } from "../between-dates";
import type { Db } from "../db";
import { notify } from "../notifications";
import { readBytes } from "../object-store";
import { pairKey } from "../relationships";
import { sharePartners } from "../adult/shares";
import { getAdultSettings } from "../adult/settings";

/** As many as a dating profile shows. */
export const PROFILE_PHOTOS_MAX = 9;

export type ProfilePhoto = { picture_id: string; asset_id: string; url: string };
export type PhotoFail = { ok: false; status: number; error: string; message: string };
const fail = (status: number, error: string, message: string): PhotoFail => ({ ok: false, status, error, message });

/** A character's pinned photos, oldest pinned first (the order they were put up in). */
export async function profilePhotos(db: Db, characterId: string): Promise<ProfilePhoto[]> {
  const { rows } = await db.query<{ picture_id: string; asset_id: string }>(
    `select p.picture_id, p.asset_id from profile_photos p
       join character_assets a on a.id = p.asset_id and a.review_status = 'approved' and a.content_rating = 'pg'
      where p.character_id = $1 order by p.created_at, p.picture_id limit ${PROFILE_PHOTOS_MAX}`,
    [characterId],
  );
  return rows.map((r) => ({ ...r, url: `/api/assets/${r.asset_id}` }));
}

type Own = { id: string; character_id: string; mime: string; data: Buffer | Uint8Array | null; object_key: string | null; content_rating: string; model: string | null };

/** One of the viewer's own PG Studio pictures of one of their own characters, and its bytes; or why not. */
async function ownPg(db: Db, viewer: string, pictureId: string): Promise<{ ok: true; pic: Own; bytes: Buffer } | PhotoFail> {
  const pic = (
    await db.query<Own>(
      `select g.id, g.character_id, g.mime, g.data, g.object_key, g.content_rating, g.model from studio_pg_pictures g
         join characters c on c.id = g.character_id and c.owner_id = $1
        where g.id = $2 and g.owner_id = $1`,
      [viewer, pictureId],
    )
  ).rows[0];
  if (!pic) return fail(404, "not_found", "Pick one of your own Studio pictures of your own character.");
  if (pic.content_rating !== "pg") return fail(422, "not_pg", "Only a picture the check rated PG can leave the Studio: this one was rated suggestive.");
  const bytes = await readBytes(pic);
  if (!bytes) return fail(404, "not_found", "That picture's file is missing.");
  return { ok: true, pic, bytes };
}

/** A copy of it in the asset ledger, approved: it already passed the PG Studio's strict check (lib/adult/moderation.ts checkRating). */
async function ledgerCopy(db: Db, pic: Own, bytes: Buffer, prompt: string): Promise<string> {
  const id = await recordAsset(db, {
    character_id: pic.character_id,
    kind: "photo",
    source_type: "generated",
    source_model: pic.model ?? "pg-studio",
    prompt,
    url: `data:${pic.mime};base64,${bytes.toString("base64")}`,
    content_rating: "pg",
  });
  await reviewAsset(db, id, "approved", `pg studio picture ${pic.id}, rated pg by the Studio's check`);
  return id;
}

/** Puts one of their PG Studio pictures on the character's profile. Pinning one that's up already is a no-op. */
export async function pinPhoto(db: Db, viewer: string, pictureId: string): Promise<{ ok: true; photos: ProfilePhoto[] } | PhotoFail> {
  const own = await ownPg(db, viewer, pictureId);
  if (!own.ok) return own;
  const { pic, bytes } = own;
  const up = await profilePhotos(db, pic.character_id);
  if (up.some((p) => p.picture_id === pic.id)) return { ok: true, photos: up };
  if (up.length >= PROFILE_PHOTOS_MAX) return fail(409, "full", `Their profile shows ${PROFILE_PHOTOS_MAX} photos: take one down first.`);
  const asset = await ledgerCopy(db, pic, bytes, "A PG Studio picture, on their profile");
  await db.query(
    `insert into profile_photos (character_id, picture_id, asset_id, owner_id) values ($1, $2, $3, $4)
     on conflict (character_id, picture_id) do update set asset_id = excluded.asset_id, created_at = now()`,
    [pic.character_id, pic.id, asset, viewer],
  );
  return { ok: true, photos: await profilePhotos(db, pic.character_id) };
}

/** Takes a picture off whichever of their characters' profiles it's on; its copy's link stops working. */
export async function unpinPhoto(db: Db, viewer: string, pictureId: string): Promise<boolean> {
  const { rows } = await db.query<{ asset_id: string }>(`delete from profile_photos where picture_id = $1 and owner_id = $2 returning asset_id`, [pictureId, viewer]);
  for (const r of rows) await reviewAsset(db, r.asset_id, "rejected", "taken off their profile");
  return rows.length > 0;
}

/** Which of these pictures are on a profile (the Studio's 📌 state). */
export async function pinnedOf(db: Db, viewer: string, pictureIds: readonly string[]): Promise<Set<string>> {
  if (!pictureIds.length) return new Set();
  const { rows } = await db.query<{ picture_id: string }>(`select picture_id from profile_photos where owner_id = $1 and picture_id = any($2::text[])`, [viewer, [...pictureIds]]);
  return new Set(rows.map((r) => r.picture_id));
}

/** Who a character of theirs can send a photo to: the characters it's had a date with, of someone else's. */
export async function photoPartners(db: Db, viewer: string, characterId: string): Promise<{ character_id: string; name: string }[]> {
  return (await sharePartners(db, viewer, characterId)).map((p) => ({ character_id: p.character_id, name: p.name }));
}

/** Sends one of their PG Studio pictures as a photo in the texts between their character and one it's dated. */
export async function sendPhoto(db: Db, viewer: string, input: { picture_id: string; to_character: string }): Promise<{ ok: true; to_character: string } | PhotoFail> {
  if (!(await getAdultSettings(db)).studio.share.photos) return fail(403, "off", "Sending photos is switched off in the settings.");
  const own = await ownPg(db, viewer, input.picture_id);
  if (!own.ok) return own;
  const { pic, bytes } = own;
  const partner = (await sharePartners(db, viewer, pic.character_id)).find((p) => p.character_id === input.to_character);
  if (!partner) return fail(404, "not_a_partner", "Pick someone they've been on a date with.");
  const to = (await db.query<{ owner_id: string }>(`select owner_id from characters where id = $1`, [partner.character_id])).rows[0]!.owner_id;
  const asset = await ledgerCopy(db, pic, bytes, "A PG Studio picture, sent as a photo");
  const [lo, hi] = pairKey(pic.character_id, partner.character_id);
  const from = (await db.query<{ name: string }>(`select name from characters where id = $1`, [pic.character_id])).rows[0]?.name ?? "They";
  await insertText(db, lo, hi, pic.character_id === lo ? "lo" : "hi", "📷", "photo", new Date(), asset);
  await notify(db, to, { kind: "texted", title: `📷 ${from} sent ${partner.name} a photo`.slice(0, 125), link: `/messages/${lo}/${hi}` });
  return { ok: true, to_character: partner.character_id };
}
