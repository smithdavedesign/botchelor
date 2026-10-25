import { z } from "zod";
import { getDb } from "@/lib/db";
import { acceptDouble, declineDouble, inviteView } from "@/lib/group-dates";
import { bookDoubleNight } from "@/lib/group-dates-run";
import { handle, json, parseBody, readJson, session } from "@/lib/http";

const AnswerInput = z.object({ action: z.enum(["accept", "decline"]) });
type Params = { params: Promise<{ id: string }> };

/** The invite as its people see it (/doubles/[id]): both couples by name, and whose answer it waits on. */
export const GET = handle(async (req, { params }: Params) => {
  const sess = session(req);
  const view = await inviteView(await getDb(), sess.userId, (await params).id);
  if (!view) return json({ error: "not_found" }, 404, sess);
  return json(view, 200, sess);
});

/** Answer a double-date invite from the web: accepting books both tables (yours spends one of your dates). */
export const POST = handle(async (req, { params }: Params) => {
  const sess = session(req);
  const input = parseBody(AnswerInput, await readJson(req), "invalid_request");
  const db = await getDb();
  const { id } = await params;
  if (input.action === "decline") {
    const done = await declineDouble(db, sess.userId, id);
    if (!done) return json({ error: "not_open", message: "This invite isn't yours to answer any more (answered, or lapsed after 7 days)." }, 409, sess);
    return json({ declined: id }, 200, sess);
  }
  const accepted = await acceptDouble(db, sess.userId, id);
  if (!accepted) return json({ error: "not_open", message: "This invite isn't yours to answer any more (answered, or lapsed after 7 days)." }, 409, sess);
  const booked = await bookDoubleNight(db, accepted, undefined);
  if (!booked.ok) return json({ error: "double_failed", message: booked.error, ...(booked.episode_a ? { episode_a: booked.episode_a } : {}) }, 422, sess);
  return json({ episode_a: booked.episode_a, episode_b: booked.episode_b }, 200, sess);
});
