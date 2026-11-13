import { z } from "zod";
import { isSignedInAdmin } from "@/lib/admins";
import { getDb } from "@/lib/db";
import { buildLiveFace, collectLiveFaces, dropLiveFace, liveFaceMode, liveFaceState } from "@/lib/live-face";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { requestBase } from "@/lib/site";

export const dynamic = "force-dynamic";

const Input = z.object({ character_id: z.string().min(1).max(120), action: z.enum(["build", "drop"]).default("build") });

/**
 * An admin builds a character's live face at the renderer (lib/live-face; one of the plan's few a month, so never on a
 * call): `POST { character_id }` asks for it from the kit's portrait and answers with the renderer's id (the build takes
 * hours; `GET ?character=` follows it). `action: "drop"` forgets it here and there.
 */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  if (!(await isSignedInAdmin(db, authFromRequest(req)))) return json({ error: "not_found" }, 404);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  if (input.action === "drop") return json({ dropped: await dropLiveFace(db, input.character_id) });
  const r = await buildLiveFace(db, input.character_id, requestBase(req));
  if (!r.ok) return json({ error: r.error, message: r.message }, r.status);
  return json({ face_id: r.face_id, status: r.status }, 202);
});

export const GET = handle(async (req: Request) => {
  const db = await getDb();
  if (!(await isSignedInAdmin(db, authFromRequest(req)))) return json({ error: "not_found" }, 404);
  const character = new URL(req.url).searchParams.get("character")?.trim() ?? "";
  if (!character) return json({ error: "invalid_request" }, 400);
  await collectLiveFaces(db, process.env, character).catch(() => 0);
  const face = await liveFaceState(db, character, requestBase(req));
  return json({ mode: liveFaceMode(), face: face && { provider: face.provider, face_id: face.provider_face_id, status: face.status, error: face.error, updated_at: face.updated_at } });
});
