import { hasAdultCookie } from "@/lib/age";
import { accessHere } from "@/lib/adult/place";
import { previewPost, previewStill, previewTilesAllowed } from "@/lib/adult/preview";
import { detectBot } from "@/lib/bots";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json } from "@/lib/http";
import { teaserFor, teaserResponse } from "@/lib/teaser-image";

type Ctx = { params: Promise<{ id: string }> };

/**
 * One tile of the locked preview (lib/adult/preview.ts): a showcase post's server-blurred teaser, never its picture, for
 * someone After Dark's Gallery or Studio isn't open to. Only a post the preview may show (an admin's published explicit
 * post, live and unheld), only to someone who has said they're 18+, isn't a crawler, and is somewhere After Dark's
 * pictures are allowed. Anything else is the same not-found.
 */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const bot = Boolean(detectBot(req.headers.get("user-agent"), req.headers.get("signature-agent")));
  const attested = hasAdultCookie(req.headers.get("cookie"));
  if (bot || !attested) return json({ error: "not_found" }, 404);
  const db = await getDb();
  const here = await accessHere(db, authFromRequest(req), req.headers);
  if (!previewTilesAllowed({ bot, attested, mode: here.mode })) return json({ error: "not_found" }, 404);
  const post = await previewPost(db, id);
  if (!post) return json({ error: "not_found" }, 404);
  const teaser = await teaserFor(db, { adult: post.media_id }, () => previewStill(db, post));
  return teaser ? teaserResponse(teaser) : json({ error: "not_found" }, 404);
});
