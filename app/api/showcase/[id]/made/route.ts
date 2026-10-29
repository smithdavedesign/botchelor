import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { showcaseViewer } from "@/lib/showcase";
import { madeOf } from "@/lib/showcase-made";

export const dynamic = "force-dynamic";

/** How a showcase post was made (lib/showcase-made.ts): the model, the prompt and who's in it, for whoever may see it. */
export const GET = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const db = await getDb();
  const { id } = await params;
  const made = await madeOf(db, await showcaseViewer(db, req), id);
  return made ? json(made) : json({ error: "not_found" }, 404);
});
