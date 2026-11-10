import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { newsletterStatus } from "@/lib/newsletter";
import { previewLetter } from "@/lib/newsletter-issue";

export const dynamic = "force-dynamic";

/**
 * Owner-only: the Sunday letter (lib/newsletter.ts) in numbers: whether it's on, how many addresses are pending, confirmed
 * and unsubscribed, today's sends against the caps, and the last few letters. Never an address. ?preview=1 adds the
 * latest week's letter as text, as built or as it would be built now.
 */
export const GET = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const db = await getDb();
  const status = await newsletterStatus(db);
  if (new URL(req.url).searchParams.get("preview") !== "1") return json(status);
  return json({ ...status, preview: await previewLetter(db).catch(() => null) });
});
