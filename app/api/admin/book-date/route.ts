import { z } from "zod";
import { POST as postEpisode } from "@/app/api/episodes/route";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, sessionCookies } from "@/lib/http";
import { frontierAuthorized } from "@/lib/model";

const Input = z.object({
  character_id: z.string().min(1).max(64),
  partner_id: z.string().min(1).max(64),
  visibility: z.enum(["public", "private", "unlisted"]).optional(),
});

/** Who booked it, on the token grant: an admin test date, not a purchase. */
export const ADMIN_BOOKING = "admin:book-date";

/**
 * The owner's test dates (David, 2026-10-18: "send Chud and Sable Quist on a date each run"): books a date for any
 * owned character, as its owner, through the ordinary booking route, so every rule and the engine apply exactly as
 * they would for them. It grants the owner the one date it uses first (recorded as an admin grant), so their own
 * balance is untouched. Admin password only (x-frontier-key).
 */
export const POST = handle(async (req: Request) => {
  if (!frontierAuthorized(req)) return json({ error: "not_authorized", message: "Needs the admin password." }, 403);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const db = await getDb();
  const owner = (await db.query<{ owner_id: string | null }>(`select owner_id from characters where id = $1 and not is_house`, [input.character_id])).rows[0]?.owner_id;
  if (!owner) return json({ error: "character_not_found", message: "No owned character with that id." }, 404);
  const cookie = sessionCookies({ userId: owner, authenticated: true })[0].split(";")[0];
  const grant = crypto.randomUUID();
  await db.query(`insert into token_grants (id, user_id, episodes, granted_by) values ($1, $2, 1, $3)`, [grant, owner, ADMIN_BOOKING]);
  const booked = new Request(new URL("/api/episodes", req.url), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ character_id: input.character_id, partner_id: input.partner_id, visibility: input.visibility ?? "public" }),
  });
  const res = await postEpisode(booked);
  const body = await res.json().catch(() => ({}));
  // Not booked: the date it was given goes back.
  if (!res.ok) await db.query(`delete from token_grants where id = $1`, [grant]).catch(() => {});
  return json({ booked: res.ok, status: res.status, ...(res.ok ? { episode_id: body.id, path: `/episodes/${body.id}` } : { error: body }) }, res.ok ? 200 : res.status);
});
