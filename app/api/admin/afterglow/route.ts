import { z } from "zod";
import { isSignedInAdmin } from "@/lib/admins";
import { writeMissingAfterglow } from "@/lib/afterglow-repair";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { frontierAuthorized } from "@/lib/model";

export const dynamic = "force-dynamic";

const Input = z.object({ episode_id: z.string().min(1).max(64) });

/**
 * Write the morning-after texts a date aired without (lib/afterglow-repair.ts): one date, on request, from what is
 * stored. It writes only while the date has none, so asking twice is safe, and it never touches an ending. The admin
 * password (x-frontier-key, like the other admin tools) or an admin account. It answers with counts and reasons, never
 * the texts: those stay with the characters' owners (app/api/episodes/[id]/afterglow).
 */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  if (!frontierAuthorized(req) && !(await isSignedInAdmin(db, authFromRequest(req)))) {
    return json({ error: "not_authorized", message: "Needs the admin password or an admin account." }, 401);
  }
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const result = await writeMissingAfterglow(db, input.episode_id);
  if (result.ok) return json({ episode_id: input.episode_id, ...result });
  const status = result.reason === "episode_not_found" ? 404 : result.reason === "texts_failed" ? 502 : result.reason === "generation_paused" ? 503 : 409;
  return json({ episode_id: input.episode_id, error: result.reason, ...(result.detail ? { detail: result.detail } : {}) }, status);
});
