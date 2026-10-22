import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { DATE_VISIBILITIES } from "@/lib/rules";
import { updateCharacterMemory } from "@/lib/memory";
import { refreshEpisodePair } from "@/lib/relationships";
import { warnWhenSparksOut } from "@/lib/partners";

type Ctx = { params: Promise<{ id: string }> };

const VisibilityInput = z.object({ visibility: z.enum(DATE_VISIBILITIES) });

/**
 * The host changes who can see their date (M16). Host-only (the user who asked for the date). A private
 * date drops out of the feed and every public total at once; making it public again puts it back. A date
 * with a live watch party can't be made private (the room is a public viewing); close it first.
 */
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const { visibility } = parseBody(VisibilityInput, await readJson(req), "invalid_visibility");
  const db = await getDb();

  if (visibility === "private") {
    const room = await db.query<{ id: string }>(
      `select id from watch_parties where episode_id = $1 and kind <> 'template' limit 1`,
      [id],
    );
    if (room.rows.length) {
      return json({ error: "has_watch_party", message: "This date has a watch party, which anyone can watch. Close it before making the date private." }, 409, sess);
    }
  }

  const { rows } = await db.query<{ id: string }>(
    `update episodes set visibility = $3 where id = $1 and creator_id = $2 returning id`,
    [id, sess.userId, visibility],
  );
  if (!rows.length) return json({ error: "not_host", message: "Only the person who set up this date can change who sees it." }, 404, sess);
  // The relationship graph's public layer counts only public dates.
  await refreshEpisodePair(db, id).catch(() => {});
  // The stored memory (and the public arc it shows) counts aired public dates: taking one offline takes it out.
  const pair = (await db.query<{ a: string; b: string }>(`select character_a as a, character_b as b from episodes where id = $1`, [id])).rows[0];
  if (pair) await Promise.all([updateCharacterMemory(db, pair.a), updateCharacterMemory(db, pair.b)]).catch(() => {});
  // 2.9.0: a date that made its couple Sparks and went private never airs, so its exclusive_soon goes out now (once).
  if (pair && visibility === "private") await warnWhenSparksOut(db, pair.a, pair.b).catch(() => 0);
  return json({ id, visibility }, 200, sess);
});
