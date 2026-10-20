import type { NextRequest } from "next/server";
import { shipHref } from "@/lib/ship-names";

/**
 * The ship name generator's form (GET /ship?a=Juniper&b=Dex) lands here and moves on to the shareable result,
 * /ship/juniper/dex. A plain form and a redirect, so it works without JavaScript and every result is a link. The
 * result page checks the names; an empty form goes back to the tool. The Location is relative, so the visitor stays
 * on the host they came in on (and keeps its cookies, the 18+ gate's included).
 */
export function GET(req: NextRequest) {
  const a = req.nextUrl.searchParams.get("a")?.trim() ?? "";
  const b = req.nextUrl.searchParams.get("b")?.trim() ?? "";
  const to = !a && !b ? "/tools/ship-name-generator" : shipHref(a, b);
  return new Response(null, { status: 303, headers: { location: to } });
}
