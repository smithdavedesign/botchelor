import { z } from "zod";
import { adultViewer } from "@/lib/adult/mode";
import { pollClip, startClip } from "@/lib/adult/media";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";

export const maxDuration = 120;

const Input = z.object({ image_id: z.string().min(1).max(64), motion: z.string().max(300).optional() });

/** Starts a clip from a gallery picture (fal's queue). */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const admin = await adultViewer(db, req);
  if (!admin) return json({ error: "not_found" }, 404);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  try {
    return json({ clip: await startClip(db, admin, input.image_id, input.motion ?? "") });
  } catch (err) {
    return json({ error: "not_started", message: err instanceof Error ? err.message : "The clip didn't start." }, 422);
  }
});

/** Checks a pending clip (the page polls this every few seconds). */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const admin = await adultViewer(db, req);
  if (!admin) return json({ error: "not_found" }, 404);
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return json({ status: await pollClip(db, id, admin) });
});
