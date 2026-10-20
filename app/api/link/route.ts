import { z } from "zod";
import { confirmLink, unlinkAgent } from "@/lib/agent-links";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Linking needs a real account: a signed, authenticated session, never the anonymous cookie. */
const SIGN_IN = { error: "sign_in_required", message: "Sign in to your Botchelor account first." };

const Confirm = z.object({ code: z.string().min(1).max(100) });

/** POST /api/link — the signed-in person confirms the link their agent gave them (lib/agent-links.ts). */
export const POST = handle(async (req: Request) => {
  const auth = authFromRequest(req);
  if (!auth?.authenticated) return json(SIGN_IN, 401);
  const input = parseBody(Confirm, await readJson(req), "invalid_request");
  const r = await confirmLink(await getDb(), input.code, auth.userId);
  if (!r.ok) return json({ error: r.error, message: r.message }, r.status);
  return json({ linked: true, agent_id: r.agent_id });
});

const Unlink = z.object({ agent_id: z.string().min(1).max(64) });

/** DELETE /api/link — the account ends a link. The agent and its characters are untouched. */
export const DELETE = handle(async (req: Request) => {
  const auth = authFromRequest(req);
  if (!auth?.authenticated) return json(SIGN_IN, 401);
  const input = parseBody(Unlink, await readJson(req), "invalid_request");
  const removed = await unlinkAgent(await getDb(), auth.userId, input.agent_id);
  return removed ? json({ unlinked: true }) : json({ error: "not_linked", message: "That agent isn't linked to this account." }, 404);
});
