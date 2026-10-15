import { getApprovedAsset } from "@/lib/assets";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };
const DATA_PNG = /^data:image\/(png|jpeg|webp);base64,/;

/**
 * Serves one APPROVED character asset's image (a BYOK-generated portrait). The bytes live as a data URL in the
 * ledger, so they're streamed here with a long immutable cache instead of sitting inline in every page. Only
 * approved assets are served (the ledger never returns a pending or rejected one).
 */
export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const asset = await getApprovedAsset(await getDb(), id);
  if (!asset?.url || !DATA_PNG.test(asset.url)) return json({ error: "asset_not_found" }, 404);
  const [, type] = DATA_PNG.exec(asset.url)!;
  const bytes = Buffer.from(asset.url.slice(asset.url.indexOf(",") + 1), "base64");
  return new Response(bytes, {
    status: 200,
    headers: { "content-type": `image/${type}`, "cache-control": "public, max-age=31536000, immutable" },
  });
});
