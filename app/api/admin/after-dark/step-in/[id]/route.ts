import { z } from "zod";
import { HARD_NO_IDS, INTENSITIES, OWN_LEN, OWN_MAX } from "@/lib/adult/limits";
import { mediaRefusal } from "@/lib/adult/place";
import {
  carryOnStepIn,
  continueStepIn,
  deleteStepIn,
  endStepIn,
  getStepInScene,
  moveStepIn,
  regenerateStepIn,
  saveStepInLimits,
  sendStepInLine,
  STEP_IN_LINE_MAX,
  stepInFollowUp,
  stepInRemember,
  stepInViewer,
  swipeStepIn,
  takeBackStepIn,
  type StepInSend,
} from "@/lib/adult/step-in";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { inBackground } from "@/lib/sets";

type Ctx = { params: Promise<{ id: string }> };

// A reply is a model call (two, when the first draft can't be used), on a writer that can take a minute or more.
export const maxDuration = 300;

const Action = z.discriminatedUnion("action", [
  // What the viewer says and does: checked (lib/adult/step-in.ts) before it's kept, then the character answers.
  // `talk`: the answer is the short spoken kind (the composer's Talk switch), not prose.
  z.object({ action: z.literal("send"), text: z.string().max(STEP_IN_LINE_MAX * 2), talk: z.boolean().optional() }),
  // What the viewer said out loud on a call (the words the browser heard): the same checks, and the character answers
  // out loud (a few spoken sentences; its voice is the voice route's).
  z.object({ action: z.literal("say"), text: z.string().max(STEP_IN_LINE_MAX * 2) }),
  // The newest reply drawn again (the earlier draws kept), and flipping through the draws kept (free).
  z.object({ action: z.literal("regenerate") }),
  z.object({ action: z.literal("swipe"), to: z.enum(["prev", "next"]) }),
  // The character carries on without the viewer writing anything.
  z.object({ action: z.literal("continue") }),
  // The last exchange, gone.
  z.object({ action: z.literal("take_back") }),
  // The viewer's limits for the scene (lib/adult/limits.ts), with the ticked consent to storing hard nos when given now.
  z.object({
    action: z.literal("limits"),
    limits: z.object({
      intensity: z.enum(INTENSITIES).optional(),
      hard_nos: z.object({ chips: z.array(z.enum(HARD_NO_IDS as [string, ...string[]])).max(HARD_NO_IDS.length).optional(), own: z.array(z.string().max(OWN_LEN * 2)).max(OWN_MAX * 2).optional() }).optional(),
    }),
    consent: z.literal(true).optional(),
  }),
  // The scene moves to another place from the catalog (a public place keeps everything to a kiss at most).
  z.object({ action: z.literal("move"), place: z.string().min(1).max(120) }),
  // Ended and filed: kept, readable, with its recap.
  z.object({ action: z.literal("end") }),
  // Carry on after the crisis resources.
  z.object({ action: z.literal("carry_on") }),
]);

/** Not found for anyone Step in isn't open to, exactly like After Dark's other closed pieces. */
const hidden = () => json({ error: "not_found" }, 404);

const answer = async (db: Awaited<ReturnType<typeof getDb>>, viewer: string, id: string, r: StepInSend): Promise<Response> => {
  if (r.ok) return json({ scene: r.view, ...(r.replied === false ? { replied: false, message: r.message } : {}) });
  if (r.status === 404) return hidden();
  const { ok: _ok, status, ...body } = r;
  // The scene as it stands goes with a refusal, so the page shows a pause or a kept line without asking again.
  const now = await getStepInScene(db, viewer, id);
  return json({ ...body, ...(now.ok ? { scene: now.view } : {}) }, status);
};

/** The scene: its lines as they stand, its limits, and what can be done next. */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const db = await getDb();
  const viewer = await stepInViewer(db, req);
  if (!viewer) return hidden();
  const r = await getStepInScene(db, viewer, id);
  return r.ok ? json({ scene: r.view }) : hidden();
});

/** One move in a scene (lib/adult/step-in.ts). A reply counts one of the month's scene steps, written or said out loud; a swipe, a move and the rest are free. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const db = await getDb();
  const viewer = await stepInViewer(db, req);
  if (!viewer) return hidden();
  const input = parseBody(Action, await readJson(req), "invalid_request");
  let r: StepInSend;
  switch (input.action) {
    case "send":
      r = await sendStepInLine(db, viewer, id, input.text, new Date(), { talk: input.talk === true });
      break;
    case "say": {
      // A call is voice: not where only text is allowed (lib/adult/place.ts), like the voice route itself.
      const refused = await mediaRefusal(db, viewer);
      if (refused) return refused;
      r = await sendStepInLine(db, viewer, id, input.text, new Date(), { call: true });
      break;
    }
    case "regenerate":
      r = await regenerateStepIn(db, viewer, id);
      break;
    case "swipe":
      r = await swipeStepIn(db, viewer, id, input.to);
      break;
    case "continue":
      r = await continueStepIn(db, viewer, id);
      break;
    case "take_back":
      r = await takeBackStepIn(db, viewer, id);
      break;
    case "limits":
      r = await saveStepInLimits(db, viewer, id, input.limits, { consent: input.consent });
      break;
    case "move":
      r = await moveStepIn(db, viewer, id, input.place);
      break;
    case "end":
      r = await endStepIn(db, viewer, id);
      break;
    case "carry_on":
      r = await carryOnStepIn(db, viewer, id);
      break;
  }
  // The rolling recap, past the response, once the scene is long (never in the way of a reply).
  if (r.ok && (input.action === "send" || input.action === "say" || input.action === "continue" || input.action === "regenerate")) inBackground(() => stepInFollowUp(db, id));
  // A scene that ends is read once more for what its character should remember (only for a viewer with memory on).
  if (r.ok && input.action === "end") inBackground(() => stepInRemember(db, id, { atEnd: true }));
  return answer(db, viewer, id, r);
});

/** Deletes the scene with every line of it. */
export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const db = await getDb();
  const viewer = await stepInViewer(db, req);
  if (!viewer) return hidden();
  const r = await deleteStepIn(db, viewer, id);
  return r.ok ? json({ deleted: true }) : hidden();
});
