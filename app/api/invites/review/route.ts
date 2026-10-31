import { decideInvite, verifyReviewToken } from "@/lib/adult/invites";
import { getDb } from "@/lib/db";
import { handle } from "@/lib/http";

/**
 * The review page's Approve and Decline buttons (lib/adult/invites.ts). The signed link is the permission: it only
 * ever reaches the operator's and admins' inboxes. Sends the browser back to the page to say what happened.
 */
export const POST = handle(async (req: Request) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("t");
  const back = (q: string) => new Response(null, { status: 303, headers: { location: `/invites/review?t=${encodeURIComponent(token ?? "")}&${q}` } });
  const userId = verifyReviewToken(token);
  if (!userId) return back("invalid=1");
  const form = await req.formData().catch(() => null);
  const action = form?.get("action");
  if (action !== "approve" && action !== "decline") return back("invalid=1");
  const result = await decideInvite(await getDb(), userId, action === "approve" ? "approved" : "declined");
  if (!result.ok) return back(result.why === "not_found" ? "invalid=1" : "already=1");
  return back(`done=${result.invite.status}${result.welcomed ? "&welcomed=1" : ""}`);
});
