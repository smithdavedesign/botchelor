import { isSignedInAdmin } from "@/lib/admins";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json } from "@/lib/http";
import { lockedPictureAired } from "@/lib/locked-picture-texts";

export const dynamic = "force-dynamic";

/**
 * Owner-only: see the locked picture's text (lib/locked-picture.ts) on your own account, since our own accounts are
 * otherwise left out and the steady trigger fires one date in five. `?episode=<id>` names the date; `?character=<id>`
 * takes that character's latest aired date that ended in another date. It writes only to the calling admin's own
 * threads with either character, and every other rule holds: texts on for that thread, not paused, once a date, once a
 * week, and the pair's night must be able to open in their After Dark. No model call, no picture, nothing charged.
 */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const auth = authFromRequest(req);
  if (!auth || !(await isSignedInAdmin(db, auth))) return json({ error: "not_authorized", message: "Needs an admin account." }, 403);
  const params = new URL(req.url).searchParams;
  let episode = params.get("episode");
  const character = params.get("character");
  if (!episode && character) {
    episode =
      (
        await db.query<{ id: string }>(
          `select id from episodes
            where $1 in (character_a, character_b) and status = 'ready' and revealed_at is not null and visibility <> 'private'
              and varies_episode_id is null and ending = 'second_date'
            order by revealed_at desc limit 1`,
          [character],
        )
      ).rows[0]?.id ?? null;
  }
  if (!episode) return json({ error: "no_date", message: "Give ?episode=<id>, or ?character=<id> with an aired date that ended in another date." }, 404);
  const sent = await lockedPictureAired(db, episode, { preview: auth.userId });
  return json({
    episode_id: episode,
    locked_picture: sent,
    ...(sent.sent ? {} : { hint: "Nothing was written. It needs your thread with one of the two with texts on (Let them text you first), not paused, no such text in it this week, and both characters in your After Dark." }),
  });
});
