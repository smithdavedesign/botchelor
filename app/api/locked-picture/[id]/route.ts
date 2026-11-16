import { detectBot } from "@/lib/bots";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json } from "@/lib/http";
import { lockedPictureTextsOn } from "@/lib/locked-picture";
import { lockedTile, tileCharacter } from "@/lib/locked-picture-tile";

/** The tile is the same for a day: it changes only when the character's portrait does. Kept in the viewer's browser only. */
const CACHE = "private, max-age=86400";

/**
 * GET /api/locked-picture/<character id>: the locked tile in a character's texts (lib/locked-picture.ts), a 256x320
 * JPEG made on request from that character's own PG portrait, blurred until no detail is left
 * (lib/locked-picture-tile.ts). It is a door, never a picture of anything: nothing of After Dark is read, drawn or sent
 * here, whoever asks.
 *
 * For a signed-in person only (the tile sits in their own thread), never a crawler; a private character's only for its
 * owner. Off (LOCKED_PICTURE_TEXTS=0) and everything else: 404.
 */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const none = () => json({ error: "not_found" }, 404);
  if (!lockedPictureTextsOn() || detectBot(req.headers.get("user-agent"), req.headers.get("signature-agent"))) return none();
  const auth = authFromRequest(req);
  if (!auth?.authenticated) return none();
  const db = await getDb();
  const character = await tileCharacter(db, id);
  if (!character || (character.private && character.owner_id !== auth.userId)) return none();
  const tile = await lockedTile(db, character);
  if (!tile) return none();
  return new Response(new Uint8Array(tile), {
    status: 200,
    headers: { "content-type": "image/jpeg", "cache-control": CACHE, "x-robots-tag": "noindex" },
  });
});
