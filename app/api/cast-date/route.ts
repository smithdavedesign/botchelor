import { z } from "zod";
import { POST as postEpisode } from "@/app/api/episodes/route";
import { track } from "@/lib/analytics";
import { castDatePrize, claimPrize, releasePrize, spendPrize } from "@/lib/cast-date";
import { markCastDateRequest } from "@/lib/cast-date-request";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";

const Input = z.object({
  character_id: z.string().min(1).max(64),
  cast_id: z.string().min(1).max(64),
});

/** The viewer's cast-date prize (lib/cast-date.ts), or 404 when they have none waiting. */
export const GET = handle(async (req) => {
  const sess = session(req);
  const prize = sess.isNew ? null : await castDatePrize(await getDb(), sess.userId);
  if (!prize) return json({ error: "no_prize", message: "There's no cast date waiting for you." }, 404, sess);
  return json(prize, 200, sess);
});

/**
 * Books the weekly prize: one of the winner's characters on a date with the season cast member they picked, on the
 * show. Claims the prize first (two taps can't book two), then books through the ordinary booking route as them on a
 * show-paid request (lib/cast-date-request.ts); a booking that doesn't happen gives the prize back.
 */
export const POST = handle(async (req) => {
  const sess = session(req);
  const input = parseBody(Input, await readJson(req), "invalid_cast_date");
  const db = await getDb();
  const claim = await claimPrize(db, sess.userId, input.cast_id);
  if (!claim.ok) return json({ error: claim.error, message: claim.message }, claim.status, sess);
  let booked: Response;
  try {
    const forward = markCastDateRequest(
      new Request(new URL("/api/episodes", req.url), {
        method: "POST",
        headers: { "content-type": "application/json", cookie: req.headers.get("cookie") ?? "" },
        body: JSON.stringify({ character_id: input.character_id, partner_id: input.cast_id, visibility: "public" }),
      }),
    );
    booked = await postEpisode(forward);
  } catch (err) {
    await releasePrize(db, claim.week_id).catch(() => {});
    throw err;
  }
  const body = (await booked.json().catch(() => ({}))) as { id?: string; error?: string; message?: string };
  if (!booked.ok || !body.id) {
    await releasePrize(db, claim.week_id).catch(() => {});
    return json({ error: body.error ?? "not_booked", message: body.message ?? "The date couldn't be booked. Your prize is still yours." }, booked.ok ? 502 : booked.status, sess);
  }
  await spendPrize(db, claim.week_id, body.id);
  track("cast_date_booked", { cast: input.cast_id });
  return json({ episode_id: body.id, path: `/episodes/${body.id}` }, 201, sess);
});
