import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { claimTemplate } from "@/lib/money/marketplace";
import { moneyOn } from "@/lib/money/switches";

const Claim = z.object({ order_id: z.string().min(1).max(40), name: z.string().max(200) });

/**
 * POST: make your own copy from a paid template purchase, under a name of your choosing (lib/money/marketplace.ts).
 * A paid purchase can be claimed even if the switch is later turned off: it was paid for.
 */
export const POST = handle(async (req) => {
  const sess = session(req);
  const input = parseBody(Claim, await readJson(req), "invalid_request");
  const r = await claimTemplate(await getDb(), sess.userId, input.order_id, input);
  if (!r.ok) {
    if (r.code === "not_found" && !moneyOn("marketplace")) return json({ error: "not_found" }, 404);
    return json({ error: r.code, message: r.error }, r.code === "not_found" ? 404 : r.code === "name_taken" || r.code === "claimed" ? 409 : 400, sess);
  }
  return json(r, 201, sess);
});
