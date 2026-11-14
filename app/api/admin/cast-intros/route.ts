import { z } from "zod";
import { isSignedInAdmin } from "@/lib/admins";
import { INTRO_RENDERER, renderIntro, renderShowIntros, showIntros } from "@/lib/cast-intros";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { inBackground } from "@/lib/sets";
import { requestBase } from "@/lib/site";

export const dynamic = "force-dynamic";

const Input = z.object({ character_id: z.string().min(1).max(120).optional() });

/**
 * An admin renders cast intros (lib/cast-intros.ts; OmniHuman on the house fal key, about $1.30 a character, David's
 * yes for the show's cast as a demo): `POST { character_id }` one character, `POST {}` everyone on this season's show
 * who lacks one; both after the response (minutes each). `GET` lists the show's intros.
 */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  if (!(await isSignedInAdmin(db, authFromRequest(req)))) return json({ error: "not_found" }, 404);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const base = requestBase(req);
  if (input.character_id) {
    const id = input.character_id;
    inBackground(async () => {
      const r = await renderIntro(db, id, base);
      if (!r.ok) console.error(`[cast-intros] ${id}: ${r.message}`);
    });
    return json({ started: [id], renderer: INTRO_RENDERER }, 202);
  }
  const show = await showIntros(db);
  inBackground(async () => {
    const r = await renderShowIntros(db, base);
    if (r.failed.length) console.error(`[cast-intros] failed: ${r.failed.map((f) => `${f.character_id}: ${f.why}`).join("; ").slice(0, 400)}`);
  });
  return json({ started: show.filter((s) => !s.intro || s.intro.status !== "ready").map((s) => s.character_id), renderer: INTRO_RENDERER }, 202);
});

export const GET = handle(async (req: Request) => {
  const db = await getDb();
  if (!(await isSignedInAdmin(db, authFromRequest(req)))) return json({ error: "not_found" }, 404);
  return json({ renderer: INTRO_RENDERER, intros: await showIntros(db) });
});
