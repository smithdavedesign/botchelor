import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { detectBot } from "@/lib/bots";
import { markSeen } from "@/lib/showcase";

const Input = z.object({ post_id: z.string().min(1).max(64) });

/** A post the reels had on screen (app/showcase/reels): it goes to the back of this browser's next feed. */
export const POST = handle(async (req: Request) => {
  if (detectBot(req.headers.get("user-agent"))) return json({ ok: true });
  const sess = session(req);
  const { post_id } = parseBody(Input, await readJson(req), "invalid_request");
  await markSeen(await getDb(), sess.userId, post_id);
  return json({ ok: true }, 200, sess);
});
