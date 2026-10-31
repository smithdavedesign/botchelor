import { z } from "zod";
import { crisisAware, str } from "@/lib/crisis";
import { answerRoleplay, pairRoleplay, proposeRoleplay, ROLEPLAY_ANSWERS } from "@/lib/date-roleplays";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session, userIdFromRequest } from "@/lib/http";
import { ROLEPLAY_NOTE_MAX, ROLEPLAY_PREMISE_MAX, ROLEPLAY_ROLE_MAX, ROLEPLAY_TITLE_MAX } from "@/lib/roleplays";

type Ctx = { params: Promise<{ a: string; b: string }> };

// The terms are checked in lib/date-roleplays.ts (trimmed to their limits there); these only bound the request.
const terms = {
  character_id: z.string().min(1).max(64),
  roleplay_id: z.string().trim().min(1).max(40).optional(),
  custom: z
    .object({
      title: z.string().max(ROLEPLAY_TITLE_MAX * 2),
      premise: z.string().max(ROLEPLAY_PREMISE_MAX * 2),
      roles: z.array(z.string().max(ROLEPLAY_ROLE_MAX * 2)).length(2).optional(),
    })
    .optional(),
  my_role: z.union([z.number().int().min(0).max(1), z.string().max(ROLEPLAY_ROLE_MAX * 2)]).optional(),
  note: z.string().max(ROLEPLAY_NOTE_MAX * 2).optional(),
};
const Propose = z.object(terms);
const Answer = z.object({ ...terms, answer: z.enum(ROLEPLAY_ANSWERS), proposal_id: z.string().min(1).max(64).optional() });

/** The note and a written premise are the owner's own words: checked for self-harm intent like a date's note. */
const ownWords = (body: Record<string, unknown>) => [str(body.note), str((body.custom as Record<string, unknown> | undefined)?.premise)];

/** The couple's live roleplay (lib/date-roleplays.ts) as you see it: null when there's none, or neither is yours. */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { a, b } = await ctx.params;
  const viewer = userIdFromRequest(req);
  return json({ roleplay: await pairRoleplay(await getDb(), viewer, a, b) }, 200);
});

/** Propose a roleplay for the couple's next date, from your character (one of the two) to the other. */
export const POST = crisisAware("roleplay_note", ownWords, handle(async (req: Request, ctx: Ctx) => {
  const { a, b } = await ctx.params;
  const sess = session(req);
  const input = parseBody(Propose, await readJson(req), "invalid_request");
  if (input.character_id !== a && input.character_id !== b) return json({ error: "not_in_couple", message: "That character isn't one of this couple." }, 422, sess);
  const r = await proposeRoleplay(await getDb(), sess.userId, { ...input, with: input.character_id === a ? b : a });
  if (!r.ok) return json({ error: r.error, message: r.message }, r.status, sess);
  return json({ roleplay: r.roleplay }, 201, sess);
}));

/** Answer it: agree, decline, counter with other terms, or withdraw (your own proposal, or an agreed one). */
export const PATCH = crisisAware("roleplay_note", ownWords, handle(async (req: Request, ctx: Ctx) => {
  const { a, b } = await ctx.params;
  const sess = session(req);
  const input = parseBody(Answer, await readJson(req), "invalid_request");
  if (input.character_id !== a && input.character_id !== b) return json({ error: "not_in_couple", message: "That character isn't one of this couple." }, 422, sess);
  const r = await answerRoleplay(await getDb(), sess.userId, { ...input, with: input.character_id === a ? b : a, roleplay_proposal_id: input.proposal_id ?? null });
  if (!r.ok) return json({ error: r.error, message: r.message }, r.status, sess);
  return json({ roleplay: r.roleplay, ...("status" in r ? { status: r.status } : {}) }, 200, sess);
}));
