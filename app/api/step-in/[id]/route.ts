import { z } from "zod";
import { track } from "@/lib/analytics";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { timedDb, timeRequest } from "@/lib/request-timing";
import { advanceStepIn, airStepIn, continueStepIn, getStepIn, leaveStepIn, sayStepIn, type StepInResult } from "@/lib/step-in";
import { TURN_DIALOGUE_MAX } from "@/lib/rules";
import { AGE_REFUSAL, passedAgeGate, stepInWho } from "../access";

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

/**
 * A move that can wait on the show's side (its line, the verdict, the recap), timed (lib/request-timing.ts): one
 * step_in_timing line says how long it took and how much of that was the database and the model. Numbers only.
 */
async function timed(action: "line" | "advance" | "continue", episodeId: string, fn: () => Promise<StepInResult>): Promise<StepInResult> {
  const { result, timing } = await timeRequest(fn);
  track("step_in_timing", { episode_id: episodeId, action, state: result.ok ? result.view.state : result.error, ...timing });
  return result;
}

/** Where your step-in date stands (lib/step-in.ts): the lines so far, whose line it is, and once it's done, how it ended. */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  const access = await stepInWho(db, req, sess);
  if ("refused" in access) return access.refused;
  if (!passedAgeGate(req)) return json(AGE_REFUSAL, 403, sess);
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
  const access = await stepInWho(db, req, sess);
  if ("refused" in access) return access.refused;
  if (!passedAgeGate(req)) return json(AGE_REFUSAL, 403, sess);
  const input = parseBody(Action, await readJson(req), "invalid_request");
  switch (input.action) {
    case "line": {
      const counted = timedDb(db);
      return reply(await timed("line", id, () => sayStepIn(counted, sess.userId, id, { dialogue: input.dialogue, action: input.action_text, see_again: input.see_again }, access.who)), sess);
    }
    case "advance": {
      const counted = timedDb(db);
      return reply(await timed("advance", id, () => advanceStepIn(counted, sess.userId, id)), sess);
    }
    case "continue": {
      const counted = timedDb(db);
      return reply(await timed("continue", id, () => continueStepIn(counted, sess.userId, id)), sess);
    }
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
