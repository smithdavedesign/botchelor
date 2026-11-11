import { confirmRecoveryEmail } from "@/lib/account-recovery";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";

/**
 * Confirms a recovery email (lib/account-recovery.ts): the confirmation page's button posts here with the link's token,
 * and is sent back to say how it went. A button, never the link itself, so a mail scanner opening links confirms nothing.
 */
export const POST = handle(async (req: Request) => {
  const result = await confirmRecoveryEmail(await getDb(), new URL(req.url).searchParams.get("t"));
  if ((req.headers.get("accept") ?? "").includes("text/html")) {
    const outcome = result === "confirmed" ? "done=1" : result === "taken" ? "taken=1" : "invalid=1";
    return new Response(null, { status: 303, headers: { location: `/email/confirm-recovery?${outcome}`, "cache-control": "no-store" } });
  }
  return json({ result }, result === "confirmed" ? 200 : result === "taken" ? 409 : 400);
});
