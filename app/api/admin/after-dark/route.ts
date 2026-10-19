import { z } from "zod";
import { adultViewer } from "@/lib/adult/mode";
import { listMedia } from "@/lib/adult/media";
import { continueScene, listNights, openScene, resetScene } from "@/lib/adult/scenes";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";

// A long scene, plus a picture or two, can take a while.
export const maxDuration = 300;

const id = z.string().min(1).max(64);
const Input = z.object({ a: id, b: id, direction: z.string().max(300).optional(), reset: z.literal(true).optional() });

/** Not found for everyone but a signed-in admin while after dark is open (lib/adult/mode.ts). */
const hidden = () => json({ error: "not_found" }, 404);

export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const admin = await adultViewer(db, req);
  if (!admin) return hidden();
  const q = new URL(req.url).searchParams;
  const scene = await openScene(db, admin, q.get("a") ?? "", q.get("b") ?? "");
  return scene ? json({ scene, gallery: await listMedia(db, [scene.a.id, scene.b.id]) }) : hidden();
});

export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const admin = await adultViewer(db, req);
  if (!admin) return hidden();
  const input = parseBody(Input, await readJson(req), "invalid_request");
  if (input.reset) {
    await resetScene(db, admin, input.a, input.b);
    const scene = await openScene(db, admin, input.a, input.b);
    return scene ? json({ scene, nights: await listNights(db, admin, input.a, input.b) }) : hidden();
  }
  const r = await continueScene(db, admin, input.a, input.b, input.direction ?? null);
  if (!r.ok) return json({ error: "not_continued", message: r.message }, r.status);
  return json({ scene: r.scene, added: r.added, held: r.held, pictures: r.pictures, ...(r.picture_note ? { picture_note: r.picture_note } : {}) });
});
