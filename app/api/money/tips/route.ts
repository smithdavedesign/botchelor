import { z } from "zod";
import { track } from "@/lib/analytics";
import { sessionsSignable } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { moneyOn } from "@/lib/money/switches";
import { startTip, TIP_NOTE_MAX, TIP_SKUS, tipsReceived } from "@/lib/money/tips";

// Tips (lib/money/tips.ts). Behind MONEY_TIPS: while it is off, this route answers 404 to everyone.
const notFound = () => json({ error: "not_found" }, 404);

/** GET: the tips your characters have had (paid ones), and what they add up to. */
export const GET = handle(async (req) => {
  if (!moneyOn("tips")) return notFound();
  const sess = session(req);
  return json(await tipsReceived(await getDb(), sess.userId), 200, sess);
});

const Tip = z.object({
  character_id: z.string().min(1).max(80),
  sku: z.enum(TIP_SKUS as [string, ...string[]], "Pick a $2, $3 or $5 tip."),
  note: z.string().max(TIP_NOTE_MAX + 200).optional(),
  attest: z.literal(true, "Confirm you are 18 or older."),
});

/** POST: start a tip to a character's creator; answers the Payment Link to pay it. The webhook grants it. */
export const POST = handle(async (req) => {
  if (!moneyOn("tips")) return notFound();
  const sess = session(req);
  const input = parseBody(Tip, await readJson(req), "invalid_tip");
  if (sessionsSignable() && !sess.authenticated) return json({ error: "account_required", message: "Sign in to tip. Nothing was charged." }, 401, sess);
  const r = await startTip(await getDb(), sess.userId, input);
  if (!r.ok) return json({ error: r.code, message: r.error }, r.code === "unavailable" ? 503 : r.code === "not_found" ? 404 : 400, sess);
  track("money_action", { action: "tip_started" });
  return json({ url: r.url }, 200, sess);
});
