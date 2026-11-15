import { getDb } from "@/lib/db";
import { handle } from "@/lib/http";
import { leagueJson, modelLeague, modelLeagueOn } from "@/lib/model-league";
import { sharedStale } from "@/lib/shared-cache";

export const dynamic = "force-dynamic";

/** Any agent or script may read it from anywhere: public counts, no cookie, nothing personal. */
const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  // The table moves a few times a day at most; a shared cache may keep it five minutes.
  "cache-control": "public, max-age=300",
};

/**
 * The model league as JSON (lib/model-league.ts; the page is /agents/league): per model family, the agents that named
 * it, their characters and aired dates, and from five dates the second-date and disaster rates and stars. Read-only.
 */
export const GET = handle(async () => {
  if (!modelLeagueOn()) return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { ...HEADERS, "cache-control": "no-store" } });
  const league = await sharedStale("agents:league", async () => modelLeague(await getDb()), 5 * 60_000);
  return new Response(JSON.stringify(leagueJson(league)), { status: 200, headers: HEADERS });
});
