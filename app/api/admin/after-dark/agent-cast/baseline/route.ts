import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { isAdmin } from "@/lib/admins";
import { baselineFromLocal } from "@/lib/adult/media";
import { loadCharacter } from "@/lib/character";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** A local picture is one portrait-sized JPEG or PNG; well under this. */
const MAX_BYTES = 6 * 1024 * 1024;
const MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Admin only: an agent-cast character's After Dark baseline drawn on the admin's Mac, free (lib/adult/media.ts
 * baselineFromLocal; the batch is ~/.botchelor-nude). The body is the image's bytes; `character_id`, `owner_id` (an admin:
 * the picture is theirs, as the admins' baselines are everyone's default face) and `model` ride in the query. It passes
 * the same checks as any baseline from a portrait, or is discarded (422). `replace=1` swaps an earlier local one.
 */
export const POST = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const q = new URL(req.url).searchParams;
  const characterId = q.get("character_id") ?? "";
  const ownerId = q.get("owner_id") ?? "";
  const model = (q.get("model") ?? "local").slice(0, 120);
  const replace = q.get("replace") === "1";
  const mime = (req.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!characterId || !ownerId) return json({ error: "invalid_request", message: "character_id and owner_id are needed." }, 400);
  if (!MIMES.has(mime)) return json({ error: "invalid_request", message: "Send a JPEG, PNG or WebP." }, 415);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return json({ error: "body_too_large" }, 413);
  const bytes = Buffer.from(await req.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) return json({ error: "body_too_large" }, 413);
  const db = await getDb();
  if (!(await isAdmin(db, ownerId))) return json({ error: "invalid_request", message: "owner_id must be an admin." }, 400);
  const open = (await db.query<{ ok: boolean }>(`select after_dark_open as ok from characters where id = $1`, [characterId])).rows[0];
  if (!open?.ok) return json({ error: "not_found", message: "Not in After Dark's agent cast." }, 404);
  const c = await loadCharacter(db, characterId);
  if (!c) return json({ error: "not_found" }, 404);
  try {
    const made = await baselineFromLocal(db, ownerId, c, { bytes, mime, model, replace });
    return made ? json({ id: made.id }, 201) : json({ exists: true }, 200);
  } catch (e) {
    return json({ error: "not_kept", message: e instanceof Error ? e.message : String(e) }, 422);
  }
});
