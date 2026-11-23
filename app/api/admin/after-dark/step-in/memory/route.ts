import { z } from "zod";
import { eligibleIds } from "@/lib/adult/characters";
import { stepInViewer } from "@/lib/adult/step-in";
import { addFact, editFact, FACT_MAX, forgetFacts, listFacts, MEMORY_CONSENT_TEXT, memoryOn, setMemory, type MemoryFail } from "@/lib/adult/step-in-memory";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";

const id = z.string().min(1).max(64);
const Action = z.discriminatedUnion("action", [
  // The switch: on only with the consent ticked now; off forgets everything, for every character.
  z.object({ action: z.literal("on"), consent: z.literal(true) }),
  z.object({ action: z.literal("off") }),
  // One character's memory of the viewer: add a fact of their own, rewrite or pin one, forget one or all of it.
  z.object({ action: z.literal("add"), character_id: id, text: z.string().max(FACT_MAX * 4) }),
  z.object({ action: z.literal("edit"), character_id: id, fact_id: id, text: z.string().max(FACT_MAX * 4).optional(), pinned: z.boolean().optional() }),
  z.object({ action: z.literal("forget"), character_id: id, fact_id: id.optional() }),
]);

/** Not found for anyone Step in isn't open to, exactly like After Dark's other closed pieces. */
const hidden = () => json({ error: "not_found" }, 404);
const refused = (r: MemoryFail) => {
  const { ok: _ok, status, ...body } = r;
  return json(body, status);
};

/**
 * What a character remembers about the viewer (lib/adult/step-in-memory.ts): `GET ?character=<id>` is the switch, the
 * consent's words and every fact; `POST` turns memory on or off, or changes one character's facts. Only the viewer's
 * own, and only for a character who's in their After Dark.
 */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await stepInViewer(db, req);
  if (!viewer) return hidden();
  const character = new URL(req.url).searchParams.get("character")?.trim() ?? "";
  if (!character || !(await eligibleIds(db, viewer)).has(character)) return hidden();
  const on = await memoryOn(db, viewer);
  return json({ on, consent_text: MEMORY_CONSENT_TEXT, fact_max: FACT_MAX, facts: on ? await listFacts(db, viewer, character) : [] });
});

export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await stepInViewer(db, req);
  if (!viewer) return hidden();
  const input = parseBody(Action, await readJson(req), "invalid_request");
  if (input.action === "on" || input.action === "off") {
    const r = await setMemory(db, viewer, input.action === "on", { consent: input.action === "on" ? input.consent : undefined });
    return r.ok ? json({ on: r.on, forgotten: r.forgotten, facts: [] }) : refused(r);
  }
  if (!(await eligibleIds(db, viewer)).has(input.character_id)) return hidden();
  if (input.action === "add") {
    const r = await addFact(db, viewer, input.character_id, input.text);
    if (!r.ok) return refused(r);
  } else if (input.action === "edit") {
    const r = await editFact(db, viewer, input.fact_id, { text: input.text, pinned: input.pinned });
    if (!r.ok) return refused(r);
  } else {
    await forgetFacts(db, viewer, input.character_id, input.fact_id);
  }
  return json({ on: await memoryOn(db, viewer), facts: await listFacts(db, viewer, input.character_id) });
});
