import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { advanceStepIn, airStepIn, continueStepIn, getStepIn, leaveStepIn, sayStepIn, type StepInResult } from "@/lib/step-in";
import { TURN_DIALOGUE_MAX } from "@/lib/rules";
import { stepInRefusal } from "../access";

type Ctx = { params: Promise<{ id: string }> };

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("line"), dialogue: z.string().max(TURN_DIALOGUE_MAX * 4), action_text: z.string().max(80).optional(), see_again: z.boolean().optional() }),
  z.object({ action: z.literal("advance") }),
  z.object({ action: z.literal("continue") }),
  z.object({ action: z.literal("air") }),
  z.object({ action: z.literal("leave") }),
]);

const reply = (r: StepInResult, sess: ReturnType<typeof session>) => {
  if (!r.ok) {
    const { ok: _ok, status, ...body } = r;
    return json(body, status, sess);
  }
  return json({ view: r.view, ...(r.refused ? { refused: r.refused } : {}), ...(r.crisis_resources ? { crisis_resources: r.crisis_resources } : {}) }, 200, sess);
};

/** Where your step-in date stands (lib/step-in.ts): the lines so far, whose line it is, and once it's done, how it ended. */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  const refused = await stepInRefusal(db, req, sess);
  if (refused) return refused;
  return reply(await getStepIn(db, sess.userId, id), sess);
});

/**
 * One move on your step-in date: say your line (line), have the show play its side or the recap when it's due (advance),
 * carry on after a pause (continue), air it once it's over (air), or leave before it's over (leave).
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  const refused = await stepInRefusal(db, req, sess);
  if (refused) return refused;
  const input = parseBody(Action, await readJson(req), "invalid_request");
  switch (input.action) {
    case "line":
      return reply(await sayStepIn(db, sess.userId, id, { dialogue: input.dialogue, action: input.action_text, see_again: input.see_again }), sess);
    case "advance":
      return reply(await advanceStepIn(db, sess.userId, id), sess);
    case "continue":
      return reply(await continueStepIn(db, sess.userId, id), sess);
    case "air":
      return reply(await airStepIn(db, sess.userId, id), sess);
    case "leave": {
      const r = await leaveStepIn(db, sess.userId, id);
      if (!r.ok) {
        const { ok: _ok, status, ...body } = r;
        return json(body, status, sess);
      }
      return json({ left: true, refunded: r.refunded }, 200, sess);
    }
  }
});
