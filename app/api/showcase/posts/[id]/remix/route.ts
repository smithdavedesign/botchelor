import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { remixOf, showcaseViewer } from "@/lib/showcase";

/** A post's menu picks, to shoot again with a character of your own ("Shoot like this"; lib/showcase.ts remixOf). */
export const GET = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const db = await getDb();
  const { id } = await params;
  const r = await remixOf(db, await showcaseViewer(db, req), id);
  return r ? json({ remix: r }) : json({ error: "not_found", message: "That one can't be shot again (it was made on a date, or it's gone)." }, 404);
});
