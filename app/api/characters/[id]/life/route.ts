import { getDb } from "@/lib/db";
import { handle, json, readJsonOr, session } from "@/lib/http";
import { addEntry, loadFields, loadLife, proposalsOf, removeEntry } from "@/lib/life-record";
import { ownsCharacter } from "@/lib/souls";

type Ctx = { params: Promise<{ id: string }> };

/**
 * A character's life record (lib/life-record.ts). GET: its public entries, or for its owner every entry, the fields it
 * can fill and its asks for new fields. POST { field, value, period?, private? } adds an entry; DELETE ?entry= removes
 * one. Owner only for changes. New fields are asked for over MCP (character_life propose_field).
 */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  const owner = await ownsCharacter(db, id, sess.userId);
  const [entries, fields, asks] = await Promise.all([loadLife(db, id), loadFields(db), owner ? proposalsOf(db, id) : Promise.resolve([])]);
  return json({ character_id: id, entries: owner ? entries : entries.filter((e) => e.visibility === "public"), fields, ...(owner ? { field_asks: asks } : {}) }, 200, sess);
});

export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  if (!(await ownsCharacter(db, id, sess.userId))) return json({ error: "character_not_found" }, 404, sess);
  const body = ((await readJsonOr(req, 4096, {})) ?? {}) as Record<string, unknown>;
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
