import { securityTxt } from "@/lib/security-policy";
import { siteUrl } from "@/lib/site";

/** /.well-known/security.txt (RFC 9116): where to report a security problem, and the policy (/security). */
export const dynamic = "force-dynamic";

export function GET(): Response {
  // Always the canonical address (botchelor.com), whichever host was asked: the file names one home.
  const body = securityTxt(siteUrl());
  if (!body) return new Response("Not found\n", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600, s-maxage=86400" },
  });
}
