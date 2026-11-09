import { z } from "zod";
import { getDb } from "@/lib/db";
import { takeDoubleLink } from "@/lib/double-links";
import { handle, json, parseBody, readJson, session } from "@/lib/http";

const Input = z.object({ character_id: z.string().min(1).max(64) });
type Ctx = { params: Promise<{ code: string }> };

/**
 * Take a double-date link with one of your characters (lib/double-links.ts): both tables book at once, each side
 * spending one date, and the answer says where to watch yours.
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const sess = session(req);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const r = await takeDoubleLink(await getDb(), sess.userId, (await ctx.params).code, input.character_id);
  if (!r.ok) {
    const { ok: _ok, status, ...body } = r;
    return json(body, status, sess);
  }
  return json({ night: r.night_id, episode_a: r.episode_a, episode_b: r.episode_b, watch: `/episodes/${r.episode_b}?play=1` }, 201, sess);
});
