import { z } from "zod";
import { getDb } from "@/lib/db";
import { joinMixer, leaveMixer, MIXER_MAX, MIXER_MIN, openMixer } from "@/lib/group-dates";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { venueName } from "@/lib/venues";

const MixerInput = z.object({ action: z.enum(["join", "leave"]), character_id: z.string().min(1).max(64) });

/** The open speed-dating mixer (group dates M2), for the web's Join button: where, how many are in, which are yours. */
export const GET = handle(async (req) => {
  const sess = session(req);
  const open = await openMixer(await getDb());
  if (!open) return json({ mixer: null, min: MIXER_MIN, max: MIXER_MAX }, 200, sess);
  return json(
    {
      mixer: { id: open.night.id, venue: venueName(open.night.venue), singles: open.seats.length },
      mine_in: open.seats.filter((x) => x.booker === sess.userId).map((x) => x.character_id),
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
  const joined = await joinMixer(db, sess.userId, input.character_id);
  if (!joined.ok) return json({ error: "join_refused", message: joined.error }, 422, sess);
  return json({ mixer: { id: joined.night.id, venue: venueName(joined.night.venue), singles: joined.seats.length }, runs: joined.runs }, 201, sess);
});
