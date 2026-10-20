import { z } from "zod";
import { adultViewer } from "@/lib/adult/mode";
import { listMedia } from "@/lib/adult/media";
import { continueScene, listNights, openScene, resetScene, SET_SCENE_MAX, setSceneTo } from "@/lib/adult/scenes";
import { isAdmin } from "@/lib/admins";
import { refundBoughtTokens, SET_SCENE_TOKEN_COST, spendBoughtTokens } from "@/lib/allowance";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";

// A long scene, plus a picture or two, can take a while.
export const maxDuration = 300;

const id = z.string().min(1).max(64);
const Input = z.object({ a: id, b: id, direction: z.string().max(300).optional(), reset: z.literal(true).optional(), set_scene: z.string().max(SET_SCENE_MAX).optional(), steer_mode: z.enum(["nudge", "direct"]).optional() });

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
  if (input.set_scene !== undefined) {
    // Set the scene: 1 bought token (admins don't pay, like clips), given back if the place is refused.
    const pays = !(await isAdmin(db, admin));
    if (pays && !(await spendBoughtTokens(db, admin, SET_SCENE_TOKEN_COST))) {
      return json({ error: "needs_tokens", message: `Setting the scene costs ${SET_SCENE_TOKEN_COST} token. Get more on the shop page.` }, 402);
    }
    const moved = await setSceneTo(db, admin, input.a, input.b, input.set_scene);
    if (!moved.ok) {
      if (pays) await refundBoughtTokens(db, admin, SET_SCENE_TOKEN_COST);
      return json({ error: "not_moved", message: moved.message }, moved.status);
    }
    return json({ scene: moved.scene });
  }
  const r = await continueScene(db, admin, input.a, input.b, input.direction ?? null, input.steer_mode ?? "nudge");
  if (!r.ok) return json({ error: "not_continued", message: r.message }, r.status);
  return json({ scene: r.scene, added: r.added, held: r.held, pictures: r.pictures, ...(r.picture_note ? { picture_note: r.picture_note } : {}) });
});
