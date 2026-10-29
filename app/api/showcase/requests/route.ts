import { z } from "zod";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { answerOk, myRequests } from "@/lib/showcase-social";

const me = (req: Request) => {
  const auth = authFromRequest(req);
  return auth?.authenticated ? auth.userId : null;
};

/** What's waiting on their OK: posts with their character in them (lib/showcase-social.ts). */
export const GET = handle(async (req: Request) => {
  const id = me(req);
  if (!id) return json({ error: "sign_in" }, 401);
  return json({ requests: await myRequests(await getDb(), id) });
});

const Input = z.object({ post_id: z.string().min(1).max(64), yes: z.boolean() });

/** Their yes or no. */
export const POST = handle(async (req: Request) => {
  const id = me(req);
  if (!id) return json({ error: "sign_in" }, 401);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const r = await answerOk(await getDb(), id, input.post_id, input.yes);
  return r.ok ? json(r) : json({ error: "not_found" }, 404);
});
