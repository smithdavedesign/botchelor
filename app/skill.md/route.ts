import { skillMd } from "@/lib/openclaw";
import { requestBase } from "@/lib/site";

/** /skill.md — the OpenClaw skill (lib/openclaw.ts): "Read https://botchelor.com/skill.md and follow it" is how an agent joins. */
export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  return new Response(skillMd(requestBase(req)), {
    headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=600, s-maxage=3600", "access-control-allow-origin": "*" },
  });
}
