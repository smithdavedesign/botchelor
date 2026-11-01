import { z } from "zod";
import { getDb } from "@/lib/db";
import { joinMixer, leaveMixer, MIXER_MAX, MIXER_MIN, openMixer } from "@/lib/group-dates";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { venueName } from "@/lib/venues";
import { episodeAllowance } from "@/lib/allowance";
import { operatorReserved } from "@/lib/operator-pass";
import type { Db } from "@/lib/db";

/** This person's dates from mixers in the last two days, newest first: the one each character booked (its own date). */
async function recentMixerDates(db: Db, userId: string): Promise<{ character_id: string; episode_id: string; venue: string; night_id: string }[]> {
  const { rows } = await db.query<{ character_id: string; episode_id: string; venue: string; night_id: string }>(
    `select r->>'a' as character_id, r->>'episode_id' as episode_id, gn.venue, gn.id as night_id
       from group_nights gn, jsonb_array_elements(gn.rotations) r
      where gn.kind = 'mixer' and gn.status = 'done' and gn.decided_at > now() - interval '2 days'
        and r->>'booker' = $1 and r->>'episode_id' is not null
      order by gn.decided_at desc
      limit 6`,
    [userId],
  );
  return rows.map((r) => ({ ...r, venue: venueName(r.venue) }));
}

const MixerInput = z.object({ action: z.enum(["join", "leave"]), character_id: z.string().min(1).max(64) });

/** The open speed-dating mixer (group dates M2), for the web's Join button: where, how many are in, which are yours. */
export const GET = handle(async (req) => {
  const sess = session(req);
  const db = await getDb();
  const [open, recent] = await Promise.all([openMixer(db), recentMixerDates(db, sess.userId).catch(() => [])]);
  if (!open) return json({ mixer: null, recent, min: MIXER_MIN, max: MIXER_MAX }, 200, sess);
  return json(
    {
      mixer: { id: open.night.id, venue: venueName(open.night.venue), singles: open.seats.length },
      mine_in: open.seats.filter((x) => x.booker === sess.userId).map((x) => x.character_id),
      recent,
      min: MIXER_MIN,
      max: MIXER_MAX,
    },
    200,
    sess,
  );
});

/** Join one of your characters to the next mixer (joining is the consent; one date when it runs), or leave before it runs. */
export const POST = handle(async (req) => {
  const sess = session(req);
  const input = parseBody(MixerInput, await readJson(req), "invalid_request");
  const db = await getDb();
  if (input.action === "leave") {
    const left = await leaveMixer(db, sess.userId, input.character_id);
    if (!left) return json({ error: "not_in_mixer", message: "That character isn't in an open mixer of yours." }, 409, sess);
    return json({ left: input.character_id }, 200, sess);
  }
  // 2026-10-25 page review: with no date left, the character's rotation would fall through when the night runs and its
  // neighbours would lose a meeting — so say it now, with the way to get one (an operator pass's reserved dates count).
  const left = (await episodeAllowance(db, sess.userId)).left;
  const reserved = ((await operatorReserved(db, sess.userId).catch(() => null))?.reserved_left ?? 0) > 0;
  if (left <= 0 && !reserved) {
    return json(
      { error: "no_dates_left", shop_path: "/shop", message: "A mixer spends one of your dates when it runs, and you have none left this week. Free dates come back Monday, or top up in the shop." },
      402,
      sess,
    );
  }
  const joined = await joinMixer(db, sess.userId, input.character_id);
  if (!joined.ok) return json({ error: "join_refused", message: joined.error }, 422, sess);
  return json({ mixer: { id: joined.night.id, venue: venueName(joined.night.venue), singles: joined.seats.length }, runs: joined.runs }, 201, sess);
});
