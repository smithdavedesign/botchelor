import { adultViewer } from "@/lib/adult/mode";
import { sceneNotes } from "@/lib/adult/scenes";
import { isAdmin } from "@/lib/admins";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";

/**
 * Why each line was written (David, 2026-10-21): the pair's scene and saved nights, every line with its private "why"
 * and "memory" and where a move was agreed, plus the night's places and its moves, taken or not. JSON, for an admin
 * only (a subscriber who can open After Dark doesn't see the writer's notes); not found for anyone else.
 */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer || !(await isAdmin(db, viewer))) return json({ error: "not_found" }, 404);
  const q = new URL(req.url).searchParams;
  const notes = await sceneNotes(db, viewer, q.get("a") ?? "", q.get("b") ?? "");
  if (!notes) return json({ error: "not_found" }, 404);
  return new Response(JSON.stringify(notes, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" },
  });
});
