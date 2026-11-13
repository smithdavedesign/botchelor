import { getDb } from "@/lib/db";
import { collectFaceKits, faceKitOf } from "@/lib/face-kit";
import { handle, json } from "@/lib/http";
import { requestBase } from "@/lib/site";

export const dynamic = "force-dynamic";

/**
 * A character's face kit for a call (lib/face-kit.ts; app/companion/[id]/LiveFace.tsx): `GET ?character=<id>` gives the
 * parts that are ready (as /api/face-kit/<id> links), whether more is on its way, and why a part failed. A loop that's
 * done on Replicate is collected first (its frames checked here: this route carries ffmpeg, next.config.ts). Open to
 * anyone: the kit is a character's public, PG-checked face, and the links say nothing else.
 */
export const GET = handle(async (req: Request) => {
  const character = new URL(req.url).searchParams.get("character")?.trim() ?? "";
  if (!character || character.length > 120) return json({ error: "invalid_request" }, 400);
  const db = await getDb();
  await collectFaceKits(db, character).catch(() => 0);
  return json({ kit: await faceKitOf(db, character, requestBase(req)) });
});
