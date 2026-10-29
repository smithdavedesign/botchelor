import { z } from "zod";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { followState, setFollow } from "@/lib/showcase-social";

const Input = z.object({ on: z.boolean() });

/** Follow a creator (their posts in Following, a quiet notice when they post), or stop (lib/showcase-social.ts). */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ handle: string }> }) => {
  const auth = authFromRequest(req);
  if (!auth?.authenticated) return json({ error: "sign_in", message: "Sign in to follow." }, 401);
  const { handle: h } = await params;
  const db = await getDb();
  const { on } = parseBody(Input, await readJson(req), "invalid_request");
  if (!(await setFollow(db, auth.userId, h, on))) return json({ error: "not_found" }, 404);
  return json(await followState(db, auth.userId, h));
});
