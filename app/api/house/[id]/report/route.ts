import { z } from "zod";
import { track } from "@/lib/analytics";
import { getDb } from "@/lib/db";
import { reportSceneLine } from "@/lib/house-scenes";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { REPORT_REASONS } from "@/lib/rules";

const Input = z.object({ line: z.number().int().min(1).max(40), reason: z.enum(REPORT_REASONS).default("other") });

/**
 * Reports one line of a house scene (lib/house-scenes.ts), like a line in a watch room's chat: one report per person
 * per line, and once enough distinct viewers report it (REPORT_HIDE_THRESHOLD) the line is hidden and what it told is
 * taken back out of the story state. A repeat is a 200 that doesn't count.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const input = parseBody(Input, await readJson(req), "invalid_report");
  const result = await reportSceneLine(await getDb(), id, input.line, sess.userId, input.reason);
  if (!result.ok) return json({ error: result.error }, result.status, sess);
  if (result.reported) track("content_reported", { target: "house_scene", reason: input.reason });
  return json({ reported: true, hidden: result.hidden }, result.reported ? 201 : 200, sess);
});
