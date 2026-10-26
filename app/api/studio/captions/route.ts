import { z } from "zod";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { pgCaptions } from "@/lib/studio/pg-captions";

// One call to the show's free model, and a retry when the first reply can't be used.
export const maxDuration = 60;

const Input = z.object({ picture_id: z.string().min(1).max(64), fresh: z.boolean().optional() });

/** Captions in their character's voice for one of their PG Studio pictures (lib/studio/pg-captions.ts). */
export const POST = handle(async (req: Request) => {
  const auth = authFromRequest(req);
  if (!auth?.authenticated) return json({ error: "sign_in", message: "Sign in to write captions." }, 401);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const r = await pgCaptions(await getDb(), auth.userId, input.picture_id, { fresh: input.fresh });
  return r.ok ? json({ captions: r.captions }) : json({ error: r.error, message: r.message }, r.status);
});
