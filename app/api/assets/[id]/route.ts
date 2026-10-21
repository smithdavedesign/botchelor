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
  const headers = { "cache-control": "public, max-age=31536000, immutable" };
  // ?w= asks for a small copy (app/Avatar.tsx): a 1024px PNG of ~1.4 MB was drawn at 38–96px, 40 times on /watch.
  const small = await resized(bytes, new URL(req.url).searchParams.get("w"));
  if (small) return new Response(new Uint8Array(small), { status: 200, headers: { ...headers, "content-type": "image/webp" } });
  return new Response(bytes, { status: 200, headers: { ...headers, "content-type": `image/${type}` } });
});

/** The widths a small copy comes in (each one cached by the CDN for a year), so ?w= can't mint endless variants. */
const ASSET_WIDTHS = [64, 128, 256, 384] as const;

/**
 * A WebP copy at the nearest allowed width at or above `w`, or null for the original: no or a bad `w`, or sharp
 * (installed with Next) unavailable or failing. A failure never breaks the picture, it just sends the full one.
 */
async function resized(bytes: Buffer, w: string | null): Promise<Buffer | null> {
  const want = Number(w);
  if (!w || !Number.isFinite(want) || want <= 0) return null;
  const width = ASSET_WIDTHS.find((x) => x >= want) ?? ASSET_WIDTHS[ASSET_WIDTHS.length - 1];
  try {
    const { default: sharp } = await import("sharp");
    return await sharp(bytes).resize({ width, height: width, fit: "cover", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  } catch {
    return null;
  }
}
