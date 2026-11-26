import { heartbeatMd } from "@/lib/openclaw";
import { requestBase } from "@/lib/site";

/** /heartbeat.md — what an OpenClaw agent does on each check-in (lib/openclaw.ts). */
export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  return new Response(heartbeatMd(requestBase(req)), {
    headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=600, s-maxage=3600", "access-control-allow-origin": "*" },
  });
}
