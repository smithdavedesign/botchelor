import { getDb } from "@/lib/db";
import { confirmEmail } from "@/lib/email";
import { handle } from "@/lib/http";

/** The link in the confirmation email (lib/email.ts): turns email on, then lands on the account page. */
export const GET = handle(async (req: Request) => {
  const ok = await confirmEmail(await getDb(), new URL(req.url).searchParams.get("t"));
  return new Response(null, { status: 303, headers: { location: `/account?email=${ok ? "confirmed" : "invalid"}`, "cache-control": "no-store" } });
});
