import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { WATCH_MESSAGE_MAX } from "@/lib/rules";
import { checkFields } from "@/lib/safety";
import { postMessage } from "@/lib/watch";

const Input = z.object({ body: z.string().trim().min(1).max(WATCH_MESSAGE_MAX) });

/**
 * Posts one chat message to a room, after moderation: the shared content filter (no real people, minors
 * or sexual content — lib/safety.ts), then a length cap, slow mode and a rolling rate limit (lib/watch.ts).
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const input = parseBody(Input, await readJson(req), "invalid_message");

  const verdict = checkFields({ message: input.body });
  if (!verdict.ok) {
    return json(
      { error: "content_rejected", reason: verdict.reason, field: "message", message: "Keep chat clean: no real people, minors or sexual content." },
      422,
      sess,
    );
  }

  const result = await postMessage(await getDb(), id, sess.userId, input.body);
  if (!result.ok) return json({ error: result.error, message: result.message }, result.status, sess);
  return json({ id: result.id }, 201, sess);
});
