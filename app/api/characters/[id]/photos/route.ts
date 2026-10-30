import { z } from "zod";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { pinPhoto, profilePhotos, sendPhoto, unpinPhoto } from "@/lib/studio/profile-photos";

type Ctx = { params: Promise<{ id: string }> };

const viewerOf = (req: Request) => {
  const auth = authFromRequest(req);
  return auth?.authenticated ? auth.userId : null;
};

/** A character's profile photos (lib/studio/profile-photos.ts); a private character's to its owner only. */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const db = await getDb();
  const hidden = await db.query(`select 1 from characters where id = $1 and visibility = 'private' and owner_id is distinct from $2::text`, [id, viewerOf(req)]);
  if (hidden.rows.length) return json({ photos: [] });
  return json({ photos: await profilePhotos(db, id) });
});

const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pin"), picture_id: z.string().min(1).max(64) }),
  z.object({ action: z.literal("unpin"), picture_id: z.string().min(1).max(64) }),
  // A photo in the texts between this character and one it's dated.
  z.object({ action: z.literal("send"), picture_id: z.string().min(1).max(64), to_character: z.string().min(1).max(80) }),
]);

/** Pins one of the viewer's PG Studio pictures to the profile, takes it down, or sends it in their texts. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const viewer = viewerOf(req);
  if (!viewer) return json({ error: "sign_in", message: "Sign in first." }, 401);
  const input = parseBody(Input, await readJson(req), "invalid_photo");
  const db = await getDb();
  // The picture must be of this character (the URL's), so a link can't move one onto another's profile.
  const of = (await db.query<{ character_id: string }>(`select character_id from studio_pg_pictures where id = $1 and owner_id = $2`, [input.picture_id, viewer])).rows[0];
  if (input.action !== "unpin" && of?.character_id !== id) return json({ error: "not_found", message: "Pick one of your own Studio pictures of this character." }, 404);
  if (input.action === "unpin") return json({ ok: await unpinPhoto(db, viewer, input.picture_id), photos: await profilePhotos(db, id) });
  const r = input.action === "pin" ? await pinPhoto(db, viewer, input.picture_id) : await sendPhoto(db, viewer, { picture_id: input.picture_id, to_character: input.to_character });
  return r.ok ? json(r) : json({ error: r.error, message: r.message }, r.status);
});
