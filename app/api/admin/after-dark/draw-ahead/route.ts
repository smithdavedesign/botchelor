import { z } from "zod";
import { drawAheadNow, waitingBeats } from "@/lib/adult/beats";
import { drawAheadNote, drawAheadView, setDrawAhead } from "@/lib/adult/draw-ahead";
import { adultViewer } from "@/lib/adult/mode";
import { mediaRefusal } from "@/lib/adult/place";
import { openScene } from "@/lib/adult/scenes";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { requestBase } from "@/lib/site";

export const dynamic = "force-dynamic";

/** Not found for everyone After Dark isn't open to (lib/adult/mode.ts). */
const hidden = () => json({ error: "not_found" }, 404);

/**
 * Draw ahead (lib/adult/draw-ahead.ts): `GET ?a&b` says whether it's offered, on for the pair, and its price;
 * `POST { a, b, on, at? }` turns it on (the running chapter's moments still waiting from line `at` start drawing, its
 * price taken first) or off (the chapter's tokens back when nothing was drawn ahead in it yet).
 */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  const q = new URL(req.url).searchParams;
  const scene = await openScene(db, viewer, q.get("a") ?? "", q.get("b") ?? "");
  if (!scene) return hidden();
  return json({ draw_ahead: await drawAheadView(db, viewer, scene.id) });
});

const Input = z.object({ a: z.string().min(1).max(120), b: z.string().min(1).max(120), on: z.boolean(), at: z.number().int().min(0).max(10_000).optional() });

export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  const input = parseBody(Input, await readJson(req), "invalid_request");
  if (input.on) {
    const refused = await mediaRefusal(db, viewer);
    if (refused) return refused;
  }
  const scene = await openScene(db, viewer, input.a, input.b);
  if (!scene) return hidden();
  const set = await setDrawAhead(db, viewer, scene.id, input.on);
  if (!set.ok) return json({ error: "not_set", message: set.message }, set.status);
  const drawing = input.on ? await drawAheadNow(db, { id: scene.id, owner: viewer, a: scene.a.id, b: scene.b.id, chapter: scene.chapter }, await waitingBeats(db, scene.id, scene.chapter, input.at ?? 0), requestBase(req)) : 0;
  const view = await drawAheadView(db, viewer, scene.id);
  // Turned on with moments waiting, and the chapter's price couldn't be taken: it turned itself off again.
  if (input.on && !view.on) return json({ error: "needs_tokens", draw_ahead: view, message: `Draw ahead takes ${view.price} token${view.price === 1 ? "" : "s"} a chapter. Get more on the shop page.` }, 402);
  const back =set.refunded > 0 ? ` Your ${set.refunded === 1 ? "token is" : "tokens are"} back: nothing was drawn ahead this chapter.` : "";
  return json({ draw_ahead: view, drawing, refunded: set.refunded, note: input.on ? drawAheadNote(view) : `Draw ahead is off: moments wait for "Picture this?" again.${back}` });
});
