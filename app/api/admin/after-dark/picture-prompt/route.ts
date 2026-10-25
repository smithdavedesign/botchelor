import { isAdmin } from "@/lib/admins";
import { autoPicturePrompt } from "@/lib/adult/auto-pictures";
import { adultViewer } from "@/lib/adult/mode";
import { openScene } from "@/lib/adult/scenes";
import { loadCharacter } from "@/lib/character";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";

/** Not found for everyone but an admin After Dark is open to. */
const hidden = () => json({ error: "not_found" }, 404);

/**
 * The prompt the chapter's picture would be drawn from, as the scene stands now (lib/adult/auto-pictures.ts
 * autoPicturePrompt): nothing is drawn or spent. `?a=&b=`. Admins only, to check what a picture will say before paying
 * for it (David, 2026-10-25: the prompt had her in lingerie leaving a bar), and for scripts/e2e-after-dark-scene.mjs.
 */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer || !(await isAdmin(db, viewer))) return hidden();
  const q = new URL(req.url).searchParams;
  const scene = await openScene(db, viewer, q.get("a") ?? "", q.get("b") ?? "");
  if (!scene) return hidden();
  const [a, b] = await Promise.all([loadCharacter(db, scene.a.id), loadCharacter(db, scene.b.id)]);
  if (!a || !b) return hidden();
  const prompt = autoPicturePrompt(
    { id: scene.id, chapter: scene.chapter, place: scene.place ?? scene.date?.setting ?? null, set_place: scene.set_place, stage: scene.stage, lines: scene.lines, home: scene.place_history.at(-1)?.home ?? null },
    a,
    b,
    viewer,
  );
  return json({ prompt, chapter: scene.chapter, stage: scene.stage, place: scene.set_place ?? scene.place });
});
