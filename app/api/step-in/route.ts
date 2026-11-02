import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { PERSONA_ABOUT_MAX, PERSONA_NAME_MAX, STEP_IN_FORMATS, startStepIn } from "@/lib/step-in";
import { stepInRefusal } from "./access";

const Input = z.object({
  with: z.string().min(1).max(64),
  character_id: z.string().min(1).max(64).optional(),
  persona: z
    .object({
      name: z.string().max(PERSONA_NAME_MAX * 2),
      pronouns: z.string().max(40),
      age: z.number().int(),
      about: z.string().max(PERSONA_ABOUT_MAX * 2),
    })
    .optional(),
  format: z.enum(STEP_IN_FORMATS).optional(),
});

/**
 * Step into a date with one of this season's cast (lib/step-in.ts): as one of your characters (character_id) or as
 * yourself (persona). Returns the date's id; the page plays it. Signed-in adults, admins only until it's opened.
 */
export const POST = handle(async (req: Request) => {
  const sess = session(req);
  const db = await getDb();
  const refused = await stepInRefusal(db, req, sess);
  if (refused) return refused;
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const r = await startStepIn(db, sess.userId, input);
  if (!r.ok) {
    const { ok: _ok, status, ...body } = r;
    return json(body, status, sess);
  }
  return json({ episode_id: r.episode_id, ...(r.resumed ? { resumed: true } : {}), path: `/step-in/${r.episode_id}` }, r.resumed ? 200 : 201, sess);
});
