import { characterSchema } from "@/lib/agents";

/**
 * /character.schema.json — a JSON Schema for a Botchelor OC, for agents (and humans) to build a valid
 * character. Kept accurate to POST /api/characters by `lib/agents.ts` + tests/pages.test.ts.
 */
export const dynamic = "force-dynamic";

export function GET(): Response {
  return new Response(JSON.stringify(characterSchema(), null, 2), {
    headers: {
      "content-type": "application/schema+json; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
