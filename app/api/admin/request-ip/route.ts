import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { handle, json } from "@/lib/http";
import { clientIp, clientIpSource, isCloudflareIp } from "@/lib/limits";

export const dynamic = "force-dynamic";

/** The headers that say where a request came from and which host it asked for, as they reached the app. */
const HEADERS = ["do-connecting-ip", "cf-connecting-ip", "x-forwarded-for", "x-real-ip", "cf-connecting-o2o", "cf-ipcountry", "cf-region-code", "x-forwarded-host", "host"] as const;

/**
 * Admin only: how this request's address reached the app (docs/stages.md, "where a visitor is, still to measure"), so
 * each host can be checked with made-up headers: botchelor.com through our Cloudflare zone; ad, www and the
 * ondigitalocean.app ones straight to DigitalOcean's edge. It says which address the limits key on (lib/limits.ts
 * clientIp) and from which header, and shows whether what a caller sent got through. Only this request's own headers,
 * back to the admin who sent them; nothing is kept.
 */
export const GET = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const edge = req.headers.get("do-connecting-ip")?.trim() ?? "";
  return json({
    headers: Object.fromEntries(HEADERS.map((h) => [h, req.headers.get(h)])),
    client_ip: clientIp(req.headers),
    source: clientIpSource(req.headers),
    do_connecting_ip_is_cloudflare: edge ? isCloudflareIp(edge) : null,
  });
});
