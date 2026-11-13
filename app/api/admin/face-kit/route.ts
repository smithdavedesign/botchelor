import { z } from "zod";
import { isSignedInAdmin } from "@/lib/admins";
import { getDb } from "@/lib/db";
import { collectFaceKits, faceKitBlocked, faceKitOf, makeFaceKit } from "@/lib/face-kit";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { inBackground } from "@/lib/sets";
import { requestBase } from "@/lib/site";

export const dynamic = "force-dynamic";

const Input = z.object({ character_id: z.string().min(1).max(120) });

/**
 * An admin draws a character's face kit (lib/face-kit.ts), or redraws its failed parts: `POST { character_id }` starts
 * it after the response (seven edits and a clip queued), uncounted against the day's few. `GET ?character=` is the kit
 * as the page sees it.
 */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  if (!(await isSignedInAdmin(db, authFromRequest(req)))) return json({ error: "not_found" }, 404);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const base = requestBase(req);
  const blocked = await faceKitBlocked(db, input.character_id, base);
  if (blocked) return json({ error: blocked.error, message: blocked.message }, blocked.status);
  inBackground(async () => {
    const made = await makeFaceKit(db, input.character_id, base);
    const wrong = made.ok ? made.failed : [made.message];
    if (wrong.length) console.error(`[face-kit] ${input.character_id}: ${wrong.join("; ").slice(0, 400)}`);
  });
  return json({ started: true }, 202);
});

export const GET = handle(async (req: Request) => {
  const db = await getDb();
  if (!(await isSignedInAdmin(db, authFromRequest(req)))) return json({ error: "not_found" }, 404);
  const character = new URL(req.url).searchParams.get("character")?.trim() ?? "";
  if (!character) return json({ error: "invalid_request" }, 400);
  await collectFaceKits(db, character).catch(() => 0);
  return json({ kit: await faceKitOf(db, character, requestBase(req)) });
});
