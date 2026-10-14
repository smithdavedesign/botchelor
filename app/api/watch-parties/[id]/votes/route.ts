import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { WATCH_AUDIENCE_PROMPT_IDS, WATCH_CHAOS_IDS, WATCH_CHEMISTRY_IDS } from "@/lib/rules";
import { castVote } from "@/lib/watch";

// The chemistry verdict, the audience-question pick, and the chaos curveball. Opinion/flavour polls: they
// never score and never change the real outcome (predictions resolve on the canonical ending). Each only
// accepts its own choices, and only while its window is open.
const Input = z.discriminatedUnion("poll", [
  z.object({ poll: z.literal("chemistry"), choice: z.enum(WATCH_CHEMISTRY_IDS) }),
  z.object({ poll: z.literal("question"), choice: z.enum(WATCH_AUDIENCE_PROMPT_IDS) }),
  z.object({ poll: z.literal("chaos"), choice: z.enum(WATCH_CHAOS_IDS) }),
]);

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const input = parseBody(Input, await readJson(req), "invalid_vote");
  const result = await castVote(await getDb(), id, sess.userId, input.poll, input.choice);
  if (!result.ok) return json({ error: result.error, message: result.message }, result.status, sess);
  return json({ poll: input.poll, choice: input.choice }, 200, sess);
});
