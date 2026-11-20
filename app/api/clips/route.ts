import { z } from "zod";
import { afterDarkOnly } from "@/lib/after-dark-host";
import { requestClip } from "@/lib/clip-requests";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, userIdFromRequest } from "@/lib/http";

export const dynamic = "force-dynamic";

const Body = z.object({
  episode_id: z.string().regex(/^[\w-]{1,64}$/),
  character_id: z.string().regex(/^[\w-]{1,64}$/).optional(),
});

/**
 * Asks for a clip of one of your own dates to post (lib/clip-requests.ts): `{ episode_id, character_id? }` (the
 * character of yours on it; left out, the one you own). Only the owner of one of its two characters, once it has aired;
 * the first clip is free, then the Companion Plan or a bought date. Asking again for the same date returns the request
 * already made (200), never a second charge; a new one is 201. Off (404) unless CLIP_REQUESTS=1.
 */
export const POST = handle(async (req: Request) => {
  if (afterDarkOnly()) return json({ error: "not_found" }, 404);
  const body = parseBody(Body, await readJson(req), "invalid_clip_request");
  const answer = await requestClip(await getDb(), userIdFromRequest(req), body);
  if (!answer.ok) return json({ error: answer.error, message: answer.message }, answer.status);
  return json({ clip: answer.clip, created: answer.created }, answer.created ? 201 : 200);
});
