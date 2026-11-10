import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { leaveNewsletter } from "@/lib/newsletter";

/**
 * Leaving the Sunday letter (lib/newsletter.ts). Mail apps POST here straight from their own unsubscribe button (RFC 8058
 * one-click, the List-Unsubscribe header); the unsubscribe page's button posts here too and is sent back to say it's done.
 */
export const POST = handle(async (req: Request) => {
  const ok = await leaveNewsletter(await getDb(), new URL(req.url).searchParams.get("t"));
  if ((req.headers.get("accept") ?? "").includes("text/html")) {
    return new Response(null, { status: 303, headers: { location: `/newsletter/unsubscribe?${ok ? "done=1" : "invalid=1"}` } });
  }
  return json({ unsubscribed: ok }, ok ? 200 : 400);
});
