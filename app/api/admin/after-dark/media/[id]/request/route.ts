import { isSignedInAdmin } from "@/lib/admins";
import { mediaRequest } from "@/lib/adult/request-log";
import { getDb } from "@/lib/db";
import { authFromRequest, json } from "@/lib/http";

/**
 * What made one picture, clip or reel shot: its prompt, model and the request sent for it (lib/adult/request-log.ts).
 * Admins only (David, 2026-10-24: "so we can track why it fails"); not found for everyone else.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const db = await getDb();
  if (!(await isSignedInAdmin(db, authFromRequest(req)))) return json({ error: "not_found" }, 404);
  const made = await mediaRequest(db, (await params).id);
  return made ? json(made) : json({ error: "not_found" }, 404);
}
