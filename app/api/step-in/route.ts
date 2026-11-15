import { z } from "zod";
import { adultCookie } from "@/lib/age";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { PERSONA_ABOUT_MAX, PERSONA_NAME_MAX, STEP_IN_FORMATS, startStepIn } from "@/lib/step-in";
import { AGE_REFUSAL, passedAgeGate, stepInWho } from "./access";

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
  /** The start screen's "I'm 18 or over" box, for a visitor the gate hasn't asked (the page is open without it). */
  attest: z.boolean().optional(),
});

/**
 * Step into a date with one of this season's cast (lib/step-in.ts): as one of your characters (character_id) or as
 * yourself (persona). Returns the date's id; the page plays it. Open to everyone who's said they're 18+ (the gate's
 * cookie, or `attest: true` from the start screen's box, which sets that same cookie once the date starts, as the
 * builder's box does); a visitor without an account plays as a guest, under the caps in lib/step-in.ts.
 */
export const POST = handle(async (req: Request) => {
  const sess = session(req);
  const db = await getDb();
  const access = await stepInWho(db, req, sess);
  if ("refused" in access) return access.refused;
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const gated = passedAgeGate(req);
  if (!gated && input.attest !== true) return json({ ...AGE_REFUSAL, field: "attest" }, 403, sess);
  const r = await startStepIn(db, sess.userId, input, new Date(), access.who);
  if (!r.ok) {
    const { ok: _ok, status, ...body } = r;
    return json(body, status, sess);
  }
  const res = json({ episode_id: r.episode_id, ...(r.resumed ? { resumed: true } : {}), path: `/step-in/${r.episode_id}` }, r.resumed ? 200 : 201, sess);
  // The box is their 18+ answer: remembered in the gate's own cookie, so the date's page (behind the gate) opens.
  if (!gated) res.headers.append("set-cookie", adultCookie(new URL(req.url).protocol === "https:"));
  return res;
});
