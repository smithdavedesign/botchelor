import { getDb } from "@/lib/db";
import { handle, json, readJsonOr, session } from "@/lib/http";
import { addEntry, loadLifeAll, removeEntry } from "@/lib/life-record";
import { setGoal, updateGoal, vetoShift } from "@/lib/life-days";
import { GOAL_STATUSES, type GoalStatus } from "@/lib/life-record-shared";
import { ownsCharacter } from "@/lib/souls";
import { requestFeature } from "@/lib/feature-requests";
import { extCards, setExtData } from "@/lib/persona-ext-host";
import { getModel } from "@/lib/model";

type Ctx = { params: Promise<{ id: string }> };

/**
 * A character's life record (lib/life-record.ts). GET: its public entries, or for its owner every entry, the fields it
 * can fill and its asks for new fields. POST { field, value, period?, private? } adds an entry; DELETE ?entry= removes
 * one. { action: "add_goal", text } sets a goal, { action: "goal_status", goal_id, status } settles one, and
 * { action: "veto_shift", shift_id, undo? } vetoes a growth shift (lib/life-days.ts). { action: "request_feature", title, ask }
 * asks the show for a feature (lib/feature-requests.ts); { action: "ext_set", extension, data, clear? } fills in a persona
 * extension (lib/persona-ext-host.ts). Owner only for changes. New fields are asked for over MCP (character_life propose_field).
 */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  const owner = await ownsCharacter(db, id, sess.userId);
  const all = await loadLifeAll(db, id, { asks: owner });
  return json(
    {
      character_id: id,
      entries: owner ? all.entries : all.entries.filter((e) => e.visibility === "public"),
      fields: all.fields,
      goals: all.goals,
      days: all.days,
      extensions: extCards(all.ext, owner ? "owner" : "public").map((c) => (owner ? c : { slug: c.slug, title: c.title, lines: c.lines })),
      ...(owner ? { field_asks: all.asks, growth: all.shifts, feature_requests: all.features } : {}),
    },
    200,
    sess,
  );
});

export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  if (!(await ownsCharacter(db, id, sess.userId))) return json({ error: "character_not_found" }, 404, sess);
  const body = ((await readJsonOr(req, 4096, {})) ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  // Goals and growth (lib/life-days.ts): body.action says which; without one it's an entry.
  if (body.action === "add_goal") {
    const g = await setGoal(db, id, str(body.text), "owner");
    return g.ok ? json({ goal: g.goal }, 200, sess) : json({ error: g.error, message: g.message }, 400, sess);
  }
  if (body.action === "goal_status") {
    const status = (GOAL_STATUSES as readonly string[]).includes(str(body.status)) ? (str(body.status) as GoalStatus) : null;
    const g = status ? await updateGoal(db, id, str(body.goal_id), { status }) : null;
    return g ? json({ goal: g }, 200, sess) : json({ error: "not_found", message: "No such goal." }, 404, sess);
  }
  if (body.action === "veto_shift") {
    const ok = await vetoShift(db, id, str(body.shift_id), body.undo === true);
    return ok ? json({ shift_id: str(body.shift_id), vetoed: body.undo !== true }, 200, sess) : json({ error: "not_found", message: "No such change." }, 404, sess);
  }
  if (body.action === "request_feature") {
    const r = await requestFeature(db, { characterId: id, ownerId: String(sess.userId), title: str(body.title), ask: str(body.ask) }, { model: getModel(undefined, false) });
    return r.ok ? json({ feature_request: r.request }, 200, sess) : json({ error: r.error, message: r.message }, r.error === "limited" ? 429 : 400, sess);
  }
  if (body.action === "ext_set") {
    const r = await setExtData(db, id, str(body.extension), body.data, { clear: body.clear === true });
    return r.ok ? json({ extension: str(body.extension), data: r.data }, 200, sess) : json({ error: r.error, message: r.message }, r.error === "not_found" ? 404 : 400, sess);
  }
  const r = await addEntry(db, {
    characterId: id,
    field: typeof body.field === "string" ? body.field : "",
    value: typeof body.value === "string" ? body.value : "",
    period: typeof body.period === "string" ? body.period : null,
    private: body.private === true,
    source: "owner",
  });
  return r.ok ? json({ entry: r.entry }, 200, sess) : json({ error: r.error, message: r.message }, r.error === "unknown_field" ? 404 : 400, sess);
});

export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  if (!(await ownsCharacter(db, id, sess.userId))) return json({ error: "character_not_found" }, 404, sess);
  const entry = new URL(req.url).searchParams.get("entry") ?? "";
  return (await removeEntry(db, id, entry)) ? json({ removed: entry }, 200, sess) : json({ error: "not_found", message: "No such entry." }, 404, sess);
});
