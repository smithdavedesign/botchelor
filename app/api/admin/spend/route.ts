import { z } from "zod";
import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { addEntry, addKnownCosts, CATEGORIES, deleteEntry, EVERY, isMonth, KINDS, monthOf, spendView } from "@/lib/spend";

export const dynamic = "force-dynamic";

/** Admin: the spend tracker's month (lib/spend.ts): costs, income, each provider's live balance and the entries. */
export const GET = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const m = new URL(req.url).searchParams.get("month");
  return json(await spendView(await getDb(), isMonth(m) ? m : monthOf(new Date())));
});

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const Entry = z
  .object({
    kind: z.enum(KINDS),
    category: z.enum(CATEGORIES),
    provider: z.string().trim().min(1).max(60),
    label: z.string().trim().min(1).max(120),
    usd: z.number().min(0).max(1_000_000),
    every: z.enum(EVERY),
    starts_on: z.string().refine(isDay),
    ends_on: z.string().refine(isDay).nullable().optional(),
    note: z.string().trim().max(300).nullable().optional(),
  })
  .refine((e) => !e.ends_on || e.ends_on >= e.starts_on, { message: "ends_on before starts_on" });

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), entry: Entry }),
  z.object({ action: z.literal("delete"), id: z.string().min(1).max(64) }),
  z.object({ action: z.literal("add_known") }),
]);

/** Admin: add an entry, delete one, or fill in the documented costs (KNOWN_COSTS) not yet entered. */
export const POST = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const body = parseBody(Body, await readJson(req), "bad_entry");
  const db = await getDb();
  const by = authFromRequest(req)?.userId ?? null;
  if (body.action === "add") {
    const e = body.entry;
    const id = await addEntry(db, { ...e, usd: Math.round(e.usd * 100) / 100, ends_on: e.ends_on ?? null, note: e.note || null }, by);
    return json({ id });
  }
  if (body.action === "delete") return (await deleteEntry(db, body.id)) ? json({ deleted: true }) : json({ error: "not_found" }, 404);
  return json({ added: await addKnownCosts(db, by) });
});
