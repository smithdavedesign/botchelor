import { z } from "zod";
import { crisisAware, str } from "@/lib/crisis";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { overLimit } from "@/lib/limits";
import { clearPersona, getPersona, SCENE_PERSONA_MAX, setPersona, showPersonaIssue } from "@/lib/persona";

/** Saves an hour and a day, per account: it's a setting, so this only stops a script. */
const PERSONA_SAVE_LIMITS = { perHour: 30, perDay: 100 };

// The limits are checked in lib/persona.ts (and say so in words); these only bound the request.
const Input = z.object({
  name: z.string().max(SCENE_PERSONA_MAX.name * 4),
  look: z.string().max(SCENE_PERSONA_MAX.look * 4).optional(),
  about: z.string().max(SCENE_PERSONA_MAX.about * 4).optional(),
});

const SIGN_IN = { error: "sign_in", message: "Who you are in scenes is kept with your account. Sign in first." };

/**
 * Who you are in scenes (lib/persona.ts): a name to be called, a line on how you look, a line on who you are. GET reads
 * it, POST saves it, DELETE forgets it. Accounts only. It's make-believe for scenes (a companion's scene, a date you
 * step into): checked by the show's check before it's stored (PG, adults, no real people; an age under 18 gets the
 * adults-only message), and a refused one is neither stored nor logged: what was saved before stays.
 */
export const GET = handle(async (req: Request) => {
  const sess = session(req);
  if (!sess.authenticated) return json({ persona: null }, 200, sess);
  return json({ persona: await getPersona(await getDb(), sess.userId) }, 200, sess);
});

/** What they wrote is their own words: checked for self-harm intent like a date's note (the help rides the reply). */
export const POST = crisisAware("companion", (body) => [str(body.look), str(body.about)], handle(async (req: Request) => {
  const sess = session(req);
  if (!sess.authenticated) return json(SIGN_IN, 401, sess);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const db = await getDb();
  if (await overLimit(db, "persona", sess.userId, PERSONA_SAVE_LIMITS)) {
    return json({ error: "rate_limited", message: "That's a lot of changes for now. Try again in a bit." }, 429, sess);
  }
  const saved = await setPersona(db, sess.userId, input, showPersonaIssue);
  if (!saved.ok) return json({ error: saved.error, field: saved.field, message: saved.message }, 422, sess);
  return json({ persona: saved.persona }, 200, sess);
}));

export const DELETE = handle(async (req: Request) => {
  const sess = session(req);
  if (!sess.authenticated) return json(SIGN_IN, 401, sess);
  await clearPersona(await getDb(), sess.userId);
  return json({ persona: null }, 200, sess);
});
