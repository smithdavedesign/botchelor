import { z } from "zod";
import { adultViewer } from "@/lib/adult/mode";
import { mediaRefusal } from "@/lib/adult/place";
import { collectPresence, makePresence, presenceBlocked, presenceOf } from "@/lib/adult/presence";
import { playableIds } from "@/lib/adult/characters";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { inBackground } from "@/lib/sets";
import { requestBase } from "@/lib/site";

export const dynamic = "force-dynamic";
// Seven edits and a video queued: made after the response, within the function's time.
export const maxDuration = 300;

/** Not found for everyone After Dark isn't open to (lib/adult/mode.ts). */
const hidden = () => json({ error: "not_found" }, 404);

/**
 * The theater's presence (lib/adult/presence.ts; docs/PRDs/theater-immersion.md): `GET ?ids=a,b` gives each character's
 * expressions and living portrait for this viewer (collecting a loop that's done first); `POST { character_id }` makes
 * what's missing, after the response. Only for characters in their After Dark, and never where media isn't offered.
 */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  const refused = await mediaRefusal(db, viewer);
  if (refused) return refused;
  // In their After Dark, or someone who left the cast that they keep a pair with (#1132).
  const eligible = await playableIds(db, viewer);
  const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").filter((id) => eligible.has(id)).slice(0, 4);
  await collectPresence(db, viewer).catch(() => 0);
  return json({ presence: await presenceOf(db, viewer, ids) });
});

const Input = z.object({ character_id: z.string().min(1).max(120) });

export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  const refused = await mediaRefusal(db, viewer);
  if (refused) return refused;
  const input = parseBody(Input, await readJson(req), "invalid_presence");
  if (!(await playableIds(db, viewer)).has(input.character_id)) return hidden();
  // What would stop it (no face yet, no output check, the month's pictures used) is said now, not lost in the background.
  const blocked = await presenceBlocked(db, viewer, input.character_id);
  if (blocked) return json({ error: blocked.error, message: blocked.message }, blocked.status);
  const base = requestBase(req);
  // What went wrong is kept on the rows for the theater to say (presenceOf's `failed`), and logged.
  inBackground(async () => {
    const made = await makePresence(db, viewer, input.character_id, base);
    const wrong = made.ok ? made.failed : [made.message];
    if (wrong.length) console.error(`[presence] ${input.character_id}: ${wrong.join("; ").slice(0, 400)}`);
  });
  return json({ started: true }, 202);
});
