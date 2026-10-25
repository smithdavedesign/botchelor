import { teaserAllowed } from "@/lib/asset-gate";
import { getApprovedAsset } from "@/lib/assets";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { teaserFor, teaserResponse } from "@/lib/teaser-image";

type Ctx = { params: Promise<{ id: string }> };
const DATA_URL = /^data:([\w/+.-]+);base64,/;

/**
 * The blurred teaser of an approved show asset (lib/teaser-image.ts): where /api/assets/<id> sends someone an nsfw
 * picture isn't open to. Only for a signed-in person, never a bot, and only where After Dark is offered.
 */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!teaserAllowed(req)) return json({ error: "asset_not_found" }, 404);
  const db = await getDb();
  const asset = await getApprovedAsset(db, id);
  if (!asset?.url) return json({ error: "asset_not_found" }, 404);
  const url = asset.url;
  const teaser = await teaserFor(db, { asset: id }, async () => {
    const m = DATA_URL.exec(url);
    return m ? { mime: m[1], data: Buffer.from(url.slice(url.indexOf(",") + 1), "base64") } : null;
  });
  return teaser ? teaserResponse(teaser) : json({ error: "asset_not_found" }, 404);
});
