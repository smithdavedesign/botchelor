import { indexNowKey } from "@/lib/indexnow";

/** /indexnow-key.txt — proves to IndexNow that this host owns the key (lib/indexnow.ts). 404 when unset. */
export const dynamic = "force-dynamic";

export function GET(): Response {
  const key = indexNowKey();
  if (!key) return new Response("not found", { status: 404 });
  return new Response(key, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400" } });
}
