import { applyDecision, diditConfig, fetchDecision } from "@/lib/adult/age-check";
import { getDb } from "@/lib/db";
import { authFromRequest, handle } from "@/lib/http";
import { requestBase } from "@/lib/site";

export const dynamic = "force-dynamic";

const back = (req: Request, result: string): Response =>
  new Response(null, { status: 303, headers: { location: `${requestBase(req)}/after-dark/subscribe?age=${result}`, "cache-control": "no-store" } });

/**
 * Where Didit sends the person back (?verificationSessionId=&status=, lib/adult/age-check.ts). The status in the query
 * is only a hint: the decision is read from Didit's API, and counts only when it names this signed-in person. The
 * webhook usually got there first; recording again changes nothing. Then on to the subscribe page, which says how it went.
 */
export const GET = handle(async (req: Request) => {
  const config = diditConfig();
  if (!config) return new Response("Age checks aren't available yet.", { status: 404 });
  const auth = authFromRequest(req);
  const sessionId = new URL(req.url).searchParams.get("verificationSessionId") ?? "";
  if (!auth?.authenticated || !/^[0-9a-f-]{8,64}$/i.test(sessionId)) return back(req, "pending");
  try {
    const outcome = await applyDecision(await getDb(), await fetchDecision(sessionId, config), auth.userId);
    return back(req, outcome === "ignored" ? "pending" : outcome);
  } catch (err) {
    console.error("[age-check] could not read a Didit decision:", err instanceof Error ? err.message : "unknown");
    return back(req, "pending");
  }
});
