import { getApprovedAsset } from "@/lib/assets";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };
const DATA_PNG = /^data:image\/(png|jpeg|webp);base64,/;
/** A reviewed image shipped with the app (scripts/portraits.mjs records the house cast's as /cast/<file>). */
const STATIC_CAST = /^\/cast\/[\w.-]+\.(webp|png|jpe?g)$/;

/**
 * Serves one APPROVED character asset's image (a BYOK-generated portrait, or a house portrait shipped in public/cast). The bytes live as a data URL in the
 * ledger, so they're streamed here with a long immutable cache instead of sitting inline in every page. Only
 * approved assets are served (the ledger never returns a pending or rejected one).
 */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const asset = await getApprovedAsset(await getDb(), id);
  // The house cast's reviewed portraits are files in public/cast, recorded in the ledger by their path: send the
  // browser there (only that exact shape of same-site path, so this can never redirect anywhere else).
  if (asset?.url && STATIC_CAST.test(asset.url)) {
    return new Response(null, { status: 307, headers: { location: new URL(asset.url, req.url).toString(), "cache-control": "public, max-age=86400" } });
  }
  if (!asset?.url || !DATA_PNG.test(asset.url)) return json({ error: "asset_not_found" }, 404);
  const [, type] = DATA_PNG.exec(asset.url)!;
  const bytes = Buffer.from(asset.url.slice(asset.url.indexOf(",") + 1), "base64");
  return new Response(bytes, {
    status: 200,
    headers: { "content-type": `image/${type}`, "cache-control": "public, max-age=31536000, immutable" },
  });
});
