import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { confirmSubscription } from "@/lib/newsletter";

/**
 * Confirms a sign-up to the Sunday letter (lib/newsletter.ts): the confirmation page's button posts here with the link's
 * token, and is sent back to say it's done. A button, never the link itself, so a mail scanner opening links can't
 * confirm anyone.
 */
export const POST = handle(async (req: Request) => {
  const ok = await confirmSubscription(await getDb(), new URL(req.url).searchParams.get("t"));
  if ((req.headers.get("accept") ?? "").includes("text/html")) {
    return new Response(null, { status: 303, headers: { location: `/newsletter/confirm?${ok ? "done=1" : "invalid=1"}` } });
  }
  return json({ confirmed: ok }, ok ? 200 : 400);
});
