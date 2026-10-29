import { getDb } from "@/lib/db";
import { authFromRequest, handle, json } from "@/lib/http";
import { unpublish } from "@/lib/showcase";

/** Takes a post down: its creator's, at once (an admin's, as a moderator: removed for good). */
export const DELETE = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authFromRequest(req);
  if (!auth?.authenticated) return json({ error: "not_found" }, 404);
  const { id } = await params;
  return (await unpublish(await getDb(), auth.userId, id)) ? json({ ok: true }) : json({ error: "not_found" }, 404);
});
