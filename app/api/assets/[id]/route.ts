import { resizedWebp } from "@/lib/thumbs";
import { AI_HEADERS, markAiImage } from "@/lib/ai-mark";
import { assetServe, PUBLIC_CACHE } from "@/lib/asset-gate";
import { getApprovedAsset, getApprovedAssetHead, getAssetThumb, keepAssetThumb } from "@/lib/assets";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };
const DATA_PNG = /^data:image\/(png|jpeg|webp);base64,/;
/** A reviewed image shipped with the app (scripts/portraits.mjs records the house cast's as /cast/<file>). */
const STATIC_CAST = /^\/cast\/[\w.-]+\.(webp|png|jpe?g)$/;

/**
 * Serves one APPROVED character asset's image (a BYOK-generated portrait, or a house portrait shipped in public/cast). The bytes live as a data URL in the
 * ledger, so they're streamed here with a long immutable cache instead of sitting inline in every page. Only
 * approved assets are served (the ledger never returns a pending or rejected one), and only to whom its content tag
 * lets them (lib/asset-gate.ts): an nsfw one is a redirect to its blurred teaser for anyone it isn't open to.
 *
 * ?w= asks for a small copy (app/Avatar.tsx): a 1024px PNG of ~1.4 MB was drawn at 38–96px, 40 times on /watch. Each
 * small copy is made once and kept (character_asset_thumbs): on 2026-10-31 a browser opening /graph asked for 56 of
 * them at once, every one decoded from its full PNG on the request, and the show's single replica stalled until the
 * gateway gave up on it for minutes. The cache answers without reading the file; the few resizes that still happen
 * run a handful at a time.
 */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const db = await getDb();
  const head = await getApprovedAssetHead(db, id);
  if (!head) return json({ error: "asset_not_found" }, 404);
  const gate = await assetServe(db, req, head.content_rating, head.character_id);
  // The answer depends on who's asking, so neither of these may be cached for everyone (json() is no-store).
  if (gate.serve === "none") return json({ error: "asset_not_found" }, 404);
  if (gate.serve === "teaser") {
    return new Response(null, { status: 302, headers: { location: `/api/assets/${id}/teaser`, "cache-control": "private, no-store" } });
  }
  // Both redirects are relative: req.url is the container's own address behind the proxy (https://localhost:8080), and
  // an absolute one sent every house portrait there, cached a day (2026-11-01 audit, R8).
  // The house cast's reviewed portraits are files in public/cast, recorded in the ledger by their path: send the
  // browser there (only that exact shape of same-site path, so this can never redirect anywhere else).
  if (head.path && STATIC_CAST.test(head.path)) {
    return new Response(null, { status: 307, headers: { location: head.path, "cache-control": gate.cache === PUBLIC_CACHE ? "public, max-age=86400" : gate.cache } });
  }
  if (!head.is_data) return json({ error: "asset_not_found" }, 404);
  // Every picture here was made by a model: it goes out with the "AI-generated" mark in its XMP and its headers
  // (lib/ai-mark.ts). A no-op for one stored with it; an older one is marked as it's sent.
  const headers = { "cache-control": gate.cache, ...AI_HEADERS };
  const width = widthFor(new URL(req.url).searchParams.get("w"));
  if (width) {
    const kept = await getAssetThumb(db, id, width);
    if (kept) return new Response(new Uint8Array(markAiImage(kept)), { status: 200, headers: { ...headers, "content-type": "image/webp" } });
  }
  const asset = await getApprovedAsset(db, id);
  if (!asset?.url || !DATA_PNG.test(asset.url)) return json({ error: "asset_not_found" }, 404);
  const [, type] = DATA_PNG.exec(asset.url)!;
  const bytes = Buffer.from(asset.url.slice(asset.url.indexOf(",") + 1), "base64");
  if (width) {
    const small = await resized(bytes, width);
    if (small) {
      await keepAssetThumb(db, id, width, small).catch(() => {});
      return new Response(new Uint8Array(markAiImage(small)), { status: 200, headers: { ...headers, "content-type": "image/webp" } });
    }
  }
  return new Response(new Uint8Array(markAiImage(bytes)), { status: 200, headers: { ...headers, "content-type": `image/${type}` } });
});

/** The widths a small copy comes in (each one cached by the CDN for a year), so ?w= can't mint endless variants. */
const ASSET_WIDTHS = [64, 128, 256, 384] as const;

/** The nearest allowed width at or above `w`, or null for the original: no or a bad `w`. */
export function widthFor(w: string | null): number | null {
  const want = Number(w);
  if (!w || !Number.isFinite(want) || want <= 0) return null;
  return ASSET_WIDTHS.find((x) => x >= want) ?? ASSET_WIDTHS[ASSET_WIDTHS.length - 1];
}

/** How many resizes run at once on this replica: the rest wait their turn rather than all decoding together. */
/** A square WebP copy at `width` (lib/thumbs.ts), or null for the original. */
const resized = (bytes: Buffer, width: number) => resizedWebp(bytes, width, { square: true });
