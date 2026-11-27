import { z } from "zod";
import { track } from "@/lib/analytics";
import { sessionsSignable } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { BLURB_MAX, buyTemplate, delistTemplate, listTemplate, MARKET_SKUS, marketListings, purchasesOf, salesOf } from "@/lib/money/marketplace";
import { moneyOn } from "@/lib/money/switches";

// The creator marketplace (lib/money/marketplace.ts). Behind MONEY_MARKETPLACE: while it is off, this answers 404.
const notFound = () => json({ error: "not_found" }, 404);
const status = (code: string) => (code === "unavailable" ? 503 : code === "not_found" ? 404 : code === "not_your_character" ? 403 : 400);

/** GET: the live listings, and your own purchases and sales. */
export const GET = handle(async (req) => {
  if (!moneyOn("marketplace")) return notFound();
  const sess = session(req);
  const db = await getDb();
  return json({ listings: await marketListings(db, sess.userId), purchases: await purchasesOf(db, sess.userId), sales: await salesOf(db, sess.userId) }, 200, sess);
});

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), character_id: z.string().min(1).max(80), sku: z.enum(MARKET_SKUS as [string, ...string[]]), blurb: z.string().max(BLURB_MAX + 200).optional() }),
  z.object({ action: z.literal("delist"), listing_id: z.string().min(1).max(40) }),
  z.object({ action: z.literal("buy"), listing_id: z.string().min(1).max(40), attest: z.literal(true, "Confirm you are 18 or older.") }),
]);

/** POST: list one of your characters, take a listing down, or start buying one (answers the Payment Link). */
export const POST = handle(async (req) => {
  if (!moneyOn("marketplace")) return notFound();
  const sess = session(req);
  const input = parseBody(Action, await readJson(req), "invalid_request");
  if (sessionsSignable() && !sess.authenticated) return json({ error: "account_required", message: "Sign in first. Nothing was charged." }, 401, sess);
  const db = await getDb();
  const r =
    input.action === "list"
      ? await listTemplate(db, sess.userId, input)
      : input.action === "delist"
        ? await delistTemplate(db, sess.userId, input.listing_id)
        : await buyTemplate(db, sess.userId, input.listing_id);
  if (!r.ok) return json({ error: r.code, message: r.error }, status(r.code), sess);
  track("money_action", { action: `market_${input.action}` });
  return json(r, input.action === "list" ? 201 : 200, sess);
});
