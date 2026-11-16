import { z } from "zod";
import { INVITE_COOKIE } from "@/lib/casting-invite-shared";
import { applyWithInvite } from "@/lib/casting-invites";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";

type Ctx = { params: Promise<{ code: string }> };

// The page puts the terms on the button (app/casting/invite/[code]); the request carries that the owner agreed to them,
// as an audition's does (app/api/characters/[id]/audition). `credit`: the creator name they want to be credited by.
const Input = z.object({
  character_id: z.string().min(1).max(80),
  consent: z.literal(true),
  credit: z.object({ handle: z.string().max(40), display_name: z.string().max(80) }).nullable().optional(),
});

/**
 * Applies one of your characters with a creator invite (lib/casting-invites.ts): no three-date wait, pre-approved, and
 * its audition date with the lead booked at once. The same character again only tries that date again.
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { code } = await ctx.params;
  const sess = session(req);
  const input = parseBody(Input, await readJson(req), "consent_required");
  const r = await applyWithInvite(await getDb(), sess, code, input.character_id, { credit: input.credit ?? null });
  if (!r.ok) return json({ error: r.error, message: r.message, ...(r.blocks ? { blocks: r.blocks } : {}), ...(r.field ? { field: r.field } : {}) }, r.status, sess);
  const res = json(r, r.again ? 200 : 201, sess);
  // Used: the builder and the character's page stop pointing back to it.
  res.headers.append("set-cookie", `${INVITE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`);
  return res;
});
