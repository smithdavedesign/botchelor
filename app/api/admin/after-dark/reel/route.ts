import { z } from "zod";
import { adultViewer } from "@/lib/adult/mode";
import { advanceReel, listReels, makeReel } from "@/lib/adult/reels";
import { openScene, type SceneLine } from "@/lib/adult/scenes";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { requestBase } from "@/lib/site";

// Voicing and queueing six shots takes a little while.
export const maxDuration = 300;

const id = z.string().min(1).max(64);
const Input = z.object({ a: id, b: id, night_id: id.optional() });

/** Not found for everyone but a viewer after dark is open to (lib/adult/mode.ts). */
const hidden = () => json({ error: "not_found" }, 404);

/** Make a video of the night (lib/adult/reels.ts): the running scene, or one of their saved nights. */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  const input = parseBody(Input, await readJson(req), "invalid_request");
  let lines: SceneLine[] | null = null;
  if (input.night_id) {
    lines = (await db.query<{ lines: SceneLine[] }>(`select lines from adult_nights where id = $1 and owner_id = $2`, [input.night_id, viewer])).rows[0]?.lines ?? null;
  } else {
    lines = (await openScene(db, viewer, input.a, input.b))?.lines ?? null;
  }
  if (!lines) return hidden();
  const r = await makeReel(db, viewer, input.a, input.b, lines, requestBase(req));
  if (!r.ok) return json({ error: r.error, message: r.message }, r.status);
  return json({ reel: r.reel });
});

/** One reel, advanced (?id=), or the pair's reels (?a=&b=). */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  const q = new URL(req.url).searchParams;
  const reelId = q.get("id");
  if (reelId) {
    const reel = await advanceReel(db, viewer, reelId);
    return reel ? json({ reel }) : hidden();
  }
  return json({ reels: await listReels(db, viewer, q.get("a") ?? "", q.get("b") ?? "") });
});
