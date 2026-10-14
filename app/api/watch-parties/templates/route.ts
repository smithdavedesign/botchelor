import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { createTemplateParty } from "@/lib/watch";

const Input = z.object({ character_a: z.string().min(1).max(64), character_b: z.string().min(1).max(64) });

/**
 * Internal: pre-generate an always-on template date room (two house characters). Template rooms are
 * system content, not user-creatable, so this is gated by WATCH_ADMIN_TOKEN — the seed script and the
 * E2E set it; when it is unset the route 404s, as if it did not exist, so nothing is exposed publicly.
 * It never takes money and never touches points; it only builds a fictional house-vs-house date.
 */
export const POST = handle(async (req: Request) => {
  const token = process.env.WATCH_ADMIN_TOKEN;
  if (!token || req.headers.get("x-watch-admin") !== token) {
    return json({ error: "not_found" }, 404);
  }
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const result = await createTemplateParty(await getDb(), input.character_a, input.character_b);
  if (!result) return json({ error: "character_not_found" }, 404);
  if (!result.ok) return json({ error: result.error, message: result.message }, result.status);
  return json({ id: result.id, room_path: result.room_path }, 200);
});
