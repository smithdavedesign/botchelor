import { z } from "zod";
import { isSignedInAdmin } from "@/lib/admins";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { frontierAuthorized } from "@/lib/model";
import { datePlanAtNightOn, nightPlansOn, nightPlansView } from "@/lib/night-plans";
import { producerView, skipBeat, skipDay, unskipBeat } from "@/lib/producer";

export const dynamic = "force-dynamic";

/** The admin password (x-frontier-key, like the other admin tools) or an admin account (lib/admins.ts). */
async function authorized(req: Request): Promise<boolean> {
  if (frontierAuthorized(req)) return true;
  return isSignedInAdmin(await getDb(), authFromRequest(req));
}
const NOT_AUTHORIZED = { error: "not_authorized", message: "Needs the admin password or an admin account." };

/** The producer's last week (lib/producer.ts): each day's beat, its evidence, what came of it, and the night's plans. */
async function view() {
  const db = await getDb();
  const [producer, plans] = await Promise.all([producerView(db), nightPlansView(db).catch(() => [])]);
  return { ...producer, switches: { producer: producer.on, date_plan_at_night: datePlanAtNightOn(), night_plans: nightPlansOn() }, plans };
}

export const GET = handle(async (req) => {
  if (!(await authorized(req))) return json(NOT_AUTHORIZED, 401);
  return json(await view());
});

const Input = z.object({ action: z.enum(["skip", "unskip"]) });

/** "Skip tomorrow's beat" (and taking it back): the day gets no beat, no wants from the producer and no vote twists. */
export const POST = handle(async (req) => {
  if (!(await authorized(req))) return json(NOT_AUTHORIZED, 401);
  const input = parseBody(Input, await readJson(req), "invalid_producer_action");
  const db = await getDb();
  const day = skipDay(new Date());
  if (input.action === "skip") await skipBeat(db, day);
  else await unskipBeat(db, day);
  return json(await view());
});
