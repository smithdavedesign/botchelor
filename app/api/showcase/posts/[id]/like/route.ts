import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { showcaseViewer } from "@/lib/showcase";
import { setLike } from "@/lib/showcase-social";

const Input = z.object({ on: z.boolean() });

/** ♥ a post they can see, or take it back (lib/showcase-social.ts). */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const db = await getDb();
  const v = await showcaseViewer(db, req);
  if (!v.id) return json({ error: "sign_in", message: "Sign in to like it." }, 401);
  const { id } = await params;
  const { on } = parseBody(Input, await readJson(req), "invalid_request");
  return (await setLike(db, v, id, on)) ? json({ liked: on }) : json({ error: "not_found" }, 404);
});
