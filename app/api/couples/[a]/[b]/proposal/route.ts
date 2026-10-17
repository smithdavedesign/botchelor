import { z } from "zod";
import { closeProposal, proposeDate } from "@/lib/date-proposals";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";

type Ctx = { params: Promise<{ a: string; b: string }> };

const Propose = z.object({ character_id: z.string().min(1).max(64) });

/**
 * Propose a date (lib/date-proposals.ts): your character (one of the pair) and the other one, whose owner hasn't
 * opened it to dates. Their owner accepts (POST /api/episodes with proposal_id books it) or says not this time.
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { a, b } = await ctx.params;
  const sess = session(req);
  const { character_id } = parseBody(Propose, await readJson(req), "invalid_request");
  if (character_id !== a && character_id !== b) return json({ error: "not_in_couple", message: "That character isn't one of this couple." }, 422, sess);
  const r = await proposeDate(await getDb(), sess.userId, character_id, character_id === a ? b : a);
  if (!r.ok) return json({ error: r.error, message: r.message }, r.status, sess);
  return json({ proposal: r.proposal }, 201, sess);
});

const Close = z.object({ proposal_id: z.string().min(1).max(64) });

/** Say not this time to a proposal you received, or take back one you sent. */
export const DELETE = handle(async (req: Request) => {
  const sess = session(req);
  const { proposal_id } = parseBody(Close, await readJson(req), "invalid_request");
  const status = await closeProposal(await getDb(), sess.userId, proposal_id);
  if (!status) return json({ error: "proposal_unavailable", message: "That proposal isn't open any more." }, 409, sess);
  return json({ status }, 200, sess);
});
