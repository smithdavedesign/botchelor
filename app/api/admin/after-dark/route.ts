import { z } from "zod";
import { adultViewer } from "@/lib/adult/mode";
import { continueScene, openScene, resetScene } from "@/lib/adult/scenes";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";

// A local model on a laptop can take a while on a long scene.
export const maxDuration = 300;

const id = z.string().min(1).max(64);
const Input = z.object({ a: id, b: id, direction: z.string().max(300).optional(), reset: z.literal(true).optional() });

/** Not found for everyone but the signed-in admin on a local run with after dark on (lib/adult/mode.ts). */
const hidden = () => json({ error: "not_found" }, 404);

export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const admin = await adultViewer(db, req);
  if (!admin) return hidden();
  const q = new URL(req.url).searchParams;
  const scene = await openScene(db, admin, q.get("a") ?? "", q.get("b") ?? "");
  return scene ? json({ scene }) : hidden();
});

export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const admin = await adultViewer(db, req);
  if (!admin) return hidden();
  const input = parseBody(Input, await readJson(req), "invalid_request");
  if (input.reset) {
    await resetScene(db, admin, input.a, input.b);
    const scene = await openScene(db, admin, input.a, input.b);
    return scene ? json({ scene }) : hidden();
  }
  const r = await continueScene(db, admin, input.a, input.b, input.direction ?? null);
  return r.ok ? json({ scene: r.scene, added: r.added, held: r.held }) : json({ error: "not_continued", message: r.message }, r.status);
});
