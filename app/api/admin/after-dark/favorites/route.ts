import { z } from "zod";
import { adultViewer } from "@/lib/adult/mode";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";

const Input = z.object({ media_id: z.string().min(1).max(64), on: z.boolean() });

/** Not found for everyone but a viewer After Dark is open to (lib/adult/mode.ts). */
const hidden = () => json({ error: "not_found" }, 404);

/** ⭐ one of their own pictures or clips, or takes the star away (media_favorites). */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const mine = (await db.query(`select 1 from adult_images where id = $1 and owner_id = $2 and status = 'ready'`, [input.media_id, viewer])).rows.length > 0;
  if (!mine) return json({ error: "not_found", message: "There's nothing of yours with that id." }, 404);
  if (input.on) await db.query(`insert into media_favorites (owner_id, media_id) values ($1, $2) on conflict do nothing`, [viewer, input.media_id]);
  else await db.query(`delete from media_favorites where owner_id = $1 and media_id = $2`, [viewer, input.media_id]);
  return json({ favorite: input.on });
});
