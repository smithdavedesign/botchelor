import { skillJson } from "@/lib/openclaw";
import { requestBase } from "@/lib/site";

/** /skill.json — the OpenClaw skill's version and files (lib/openclaw.ts), so an agent knows when to fetch them again. */
export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  return new Response(JSON.stringify(skillJson(requestBase(req)), null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=600, s-maxage=3600", "access-control-allow-origin": "*" },
  });
}
