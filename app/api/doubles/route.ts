import { z } from "zod";
import { getDb } from "@/lib/db";
import { doubleOptions, inviteCouples, proposeDouble } from "@/lib/group-dates";
import { bookDoubleNight } from "@/lib/group-dates-run";
import { handle, json, parseBody, readJson, session } from "@/lib/http";

const id = z.string().min(1).max(64);
const DoubleInput = z.object({
  character_id: id,
  partner_id: id,
  with_character: id,
  with_partner: id,
  visibility: z.enum(["public", "unlisted", "private"]).optional(),
});

/**
 * The thread's "Make it a double" (group dates M1b, docs/PRDs/group-dates.md): the couples that could sit at the other
 * table — your other characters, each with a dealt house date (books now), and other creators' couples from the social
 * graph, the ones near you first (an invite). `excluding` is the thread's own pair.
 */
export const GET = handle(async (req) => {
  const sess = session(req);
  const excluding = (new URL(req.url).searchParams.get("excluding") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 4);
  const db = await getDb();
  const [yours, theirs] = await Promise.all([doubleOptions(db, sess.userId, excluding), inviteCouples(db, sess.userId, excluding).catch(() => [])]);
  return json({ options: [...yours, ...theirs] }, 200, sess);
});

/**
 * Propose a double date from the web: this thread's couple plus one of yours (books both tables now, two of your
 * dates) or another creator's couple (they get the invite at /doubles/[id], and accepting books both).
 */
export const POST = handle(async (req) => {
  const sess = session(req);
  const input = parseBody(DoubleInput, await readJson(req), "invalid_request");
  const db = await getDb();
  const proposed = await proposeDouble(
    db,
    sess.userId,
    { character_id: input.character_id, partner_id: input.partner_id },
    { character_id: input.with_character, partner_id: input.with_partner },
  );
  if (!proposed.ok) return json({ error: "double_refused", message: proposed.error }, 422, sess);
  if (!proposed.books_now) return json({ invited: proposed.night.id }, 201, sess);
  const booked = await bookDoubleNight(db, proposed.night, input.visibility);
  if (!booked.ok) return json({ error: "double_failed", message: booked.error, ...(booked.episode_a ? { episode_a: booked.episode_a } : {}) }, 422, sess);
  return json({ episode_a: booked.episode_a, episode_b: booked.episode_b }, 201, sess);
});
