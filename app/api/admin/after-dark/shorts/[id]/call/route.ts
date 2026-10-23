import { z } from "zod";
import { adultViewer } from "@/lib/adult/mode";
import { callOf, cantCall, FIRST_MOVES, FURTHEST_MAX, makeCall, YES_NO } from "@/lib/adult/predictions";
import { detectBot } from "@/lib/bots";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";

const Input = z.object({
  first_move: z.enum(FIRST_MOVES),
  furthest: z.number().int().min(0).max(FURTHEST_MAX),
  their_place: z.enum(YES_NO),
  // The bonus: skip it, or call it.
  second_night: z.enum(YES_NO).nullable().optional(),
});

const hidden = () => json({ error: "not_found" }, 404);

/** The viewer and the Short's id, or null for anyone After Dark isn't open to, and every bot. */
async function viewer(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (detectBot(req.headers.get("user-agent"), req.headers.get("signature-agent"))) return null;
  const db = await getDb();
  const who = await adultViewer(db, req);
  return who ? { db, who, id: (await ctx.params).id } : null;
}

/** Call it (lib/adult/predictions.ts): make or change the call on a Short before pressing play. Free; no tokens. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const v = await viewer(req, ctx);
  if (!v) return hidden();
  const input = parseBody(Input, await readJson(req), "invalid_call");
  const r = await makeCall(v.db, v.who, v.id, { ...input, second_night: input.second_night ?? null });
  return r.ok ? json({ call: r.call }) : json({ error: r.error, message: r.message }, r.status);
});

/** The viewer's call on a Short, and why they can't make one (null when they can). */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const v = await viewer(req, ctx);
  if (!v) return hidden();
  const why = await cantCall(v.db, v.who, v.id);
  if (why?.status === 404) return hidden();
  return json({ call: await callOf(v.db, v.who, v.id), closed: why?.message ?? null });
});
