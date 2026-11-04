import { getDb } from "@/lib/db";
import { handle, json, session } from "@/lib/http";
import { PLAN_IDS, PLANS, planLink, planPrice, planState, portalLink } from "@/lib/paid-plans";

/** Your plans (lib/paid-plans.ts): each one's price, whether it's on sale, and where yours stands. */
export const GET = handle(async (req) => {
  const sess = session(req);
  const db = await getDb();
  const plans = await Promise.all(
    PLAN_IDS.map(async (id) => {
      const state = sess.authenticated ? await planState(db, sess.userId, id) : { status: "none" as const, active: false, period_end: null };
      return { plan: id, name: PLANS[id].name, price: planPrice(id), on_sale: planLink(id) !== null, status: state.status, active: state.active, period_end: state.period_end, manage: state.status === "none" ? null : portalLink() };
    }),
  );
  return json({ plans }, 200, sess);
});
