import { z } from "zod";
import { ROLEPLAY_IDS } from "@/lib/adult/roleplays";
import { drawStepInSet, listStepInScenes, quickStepIn, startStepIn, stepInCast, stepInFollowUp, stepInViewer } from "@/lib/adult/step-in";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { CARD_OPENING_MAX } from "@/lib/scene-cards";
import { inBackground } from "@/lib/sets";

// The character's opening is a model call (two, when the first draft can't be used).
export const maxDuration = 300;

const Start = z.object({
  character_id: z.string().min(1).max(64),
  // A place's id from After Dark's scene catalog (lib/adult/step-in.ts stepInPlaces), or "story": where the roleplay's
  // own story is set (lib/adult/roleplays.ts `at`; only with a roleplay).
  place: z.string().min(1).max(120),
  // One of After Dark's roleplays and which side of it the viewer plays (0: its first role); null or left out: none.
  roleplay: z.object({ id: z.enum(ROLEPLAY_IDS), you: z.union([z.literal(0), z.literal(1)]).optional() }).nullable().optional(),
  // How it opens: one of the three, any of them, or one sentence of the viewer's own (checked before anything is kept).
  opening: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal("surprise"), z.object({ written: z.string().max(CARD_OPENING_MAX * 4) })]).optional(),
});

/**
 * One click (lib/adult/step-in.ts quickStepIn): only who, and their running scene with that character or a new one at
 * the character's place. With a roleplay (a card on the front page's shelf): who and which story, always a new scene.
 */
const Quick = z.object({
  character_id: z.string().min(1).max(64),
  quick: z.literal(true),
  roleplay: z.object({ id: z.enum(ROLEPLAY_IDS), you: z.union([z.literal(0), z.literal(1)]).optional() }).optional(),
});

/** Not found for anyone Step in isn't open to (lib/adult/step-in.ts stepInViewer), exactly like After Dark's other closed pieces. */
const hidden = () => json({ error: "not_found" }, 404);

/** The viewer's Step in scenes (running, then ended) and who they may step in with. */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await stepInViewer(db, req);
  if (!viewer) return hidden();
  const [scenes, cast] = await Promise.all([listStepInScenes(db, viewer), stepInCast(db, viewer)]);
  return json({ scenes, cast });
});

/**
 * Starts a scene (lib/adult/step-in.ts startStepIn): who, where, the roleplay and the viewer's side of it, how it opens.
 * The character opens it: one of the month's Step in replies. A written opening that trips the self-harm check answers with the crisis
 * resources and starts nothing.
 *
 * With `quick: true` and only who (quickStepIn): the scene they have running with that character (`resumed`), or a new
 * one made without its opening, so the answer is immediate; the scene's page has the character open it. With a
 * `roleplay` too (a card on the front page's shelf), a new scene in that roleplay, made the same way, where its story
 * is set.
 *
 * A scene at a roleplay's own place has that place's picture asked for past the response (drawStepInSet: drawn once
 * for everyone, checked, free or a fraction of a cent); nothing waits on it. And a scene whose opening was drawn here
 * has its continuity sheet read for it past the response (stepInFollowUp), as after any reply.
 */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await stepInViewer(db, req);
  if (!viewer) return hidden();
  const body = await readJson(req);
  if (body && typeof body === "object" && (body as { quick?: unknown }).quick === true) {
    const quick = parseBody(Quick, body, "invalid_request");
    const q = await quickStepIn(db, viewer, quick.character_id, new Date(), { roleplay: quick.roleplay });
    if (!q.ok) {
      const { ok: _ok, status, ...rest } = q;
      return json(rest, status);
    }
    // A card's scene is at its story's own place: its picture is asked for past the response (drawn once for everyone).
    if (quick.roleplay && !q.resumed) inBackground(() => drawStepInSet(db, viewer, q.id));
    return json({ id: q.id, resumed: q.resumed });
  }
  const input = parseBody(Start, body, "invalid_request");
  const r = await startStepIn(db, viewer, input);
  if (!r.ok) {
    const { ok: _ok, status, ...body } = r;
    return json(body, status);
  }
  if (input.roleplay) inBackground(() => drawStepInSet(db, viewer, r.id));
  // The opening is a reply like any other: where the two of them are and what the character has on start from it.
  if (r.replied !== false) inBackground(() => stepInFollowUp(db, r.id));
  return json({ id: r.id, scene: r.view, ...(r.replied === false ? { replied: false, message: r.message } : {}) });
});
