import { isAdmin } from "@/lib/admins";
import { previewPicture } from "@/lib/adult/beats";
import { adultViewer } from "@/lib/adult/mode";
import { openScene } from "@/lib/adult/scenes";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";

/** Not found for everyone but an admin After Dark is open to. */
const hidden = () => json({ error: "not_found" }, 404);

/**
 * The prompt the chapter's picture would be drawn from, as the scene stands now: the moment at its latest line, through
 * the same plan every scene picture is drawn from (lib/adult/beats.ts planBeat: their faces, the lines, what they wear,
 * the place and its situation, the mood). Nothing is drawn or spent. `?a=&b=`. Admins only, to check what a picture will
 * say before paying for it, and for scripts/e2e-after-dark-scene.mjs.
 */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer || !(await isAdmin(db, viewer))) return hidden();
  const q = new URL(req.url).searchParams;
  const scene = await openScene(db, viewer, q.get("a") ?? "", q.get("b") ?? "");
  if (!scene) return hidden();
  const plan = await previewPicture(db, viewer, { ...scene, a: scene.a.id, b: scene.b.id, place: scene.set_place ?? scene.place }, {}, null);
  if (!plan.ok) return json({ error: "not_previewed", message: plan.message }, plan.status);
  return json({ prompt: plan.prompt, fields: plan.fields, chapter: scene.chapter, stage: scene.stage, place: scene.set_place ?? scene.place });
});
