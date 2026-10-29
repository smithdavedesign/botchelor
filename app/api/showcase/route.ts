import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { listShowcase, parseFilters, showcaseViewer } from "@/lib/showcase";

/** A page of the showcase for this viewer (lib/showcase.ts): what they may see, with the query's filters. */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const v = await showcaseViewer(db, req);
  const r = await listShowcase(db, v, parseFilters(new URL(req.url).searchParams));
  return json(r);
});
