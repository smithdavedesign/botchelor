import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import {
  addPersonFor,
  answerTie,
  declareTie,
  editPersonFor,
  editTieFor,
  endTieFor,
  leavePlaceFor,
  removePersonFor,
  setPlaceFor,
  theirPeople,
  tieCandidates,
  type DeclareBy,
  type Refusal,
} from "@/lib/social/declare";
import { socialDeclareOn } from "@/lib/social/switch";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const text = (max: number) => z.string().max(max * 2);
const words = (max: number) => text(max).nullish();
const visibility = z.enum(["public", "owner"]).optional();
const id = z.string().trim().min(1).max(80);

/** A person: the name and relation the form gives; the lib checks lengths and words (and says why in plain words). */
const Person = z.object({
  name: text(40),
  relation: text(40),
  pronouns: words(20),
  note: words(160),
  deceased: z.boolean().optional(),
  visibility,
  story: words(240),
  since: words(40),
});

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add_person"), person: Person }),
  z.object({ action: z.literal("edit_person"), person_id: id, person: Person.partial() }),
  z.object({ action: z.literal("remove_person"), person_id: id }),
  z.object({
    action: z.literal("declare_tie"),
    with: id,
    relation: text(40),
    reversed: z.boolean().optional(),
    story: words(240),
    since: words(40),
    visibility,
  }),
  z.object({ action: z.literal("answer_tie"), tie_id: id, answer: z.enum(["yes", "no"]) }),
  z.object({ action: z.literal("end_tie"), tie_id: id }),
  z.object({ action: z.literal("edit_tie"), tie_id: id, story: words(240), since: words(40), visibility }),
  z.object({
    action: z.literal("set_place"),
    role: z.enum(["lives", "works", "regular", "studied"]),
    place: words(120),
    name: words(60),
    neighbourhood: words(80),
    since: words(40),
    visibility,
  }),
  z.object({ action: z.literal("leave_place"), place_id: id, role: z.enum(["lives", "works", "regular", "studied"]) }),
]);

const refused = (r: Refusal, sess: ReturnType<typeof session>) => json({ error: r.error, message: r.message }, r.status, sess);

/**
 * "Their people" (docs/PRDs/social-network.md section 6.2, lib/social/declare.ts): a character's circle as you may see
 * it, and, with `?q=`, the characters one of yours may be tied to (yours first, then the public who match).
 */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id: characterId } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  if (!socialDeclareOn()) return json({ error: "off", message: "People and ties can't be changed right now." }, 409, sess);
  const q = new URL(req.url).searchParams.get("q");
  if (q !== null) {
    const r = await tieCandidates(db, { userId: sess.userId, source: "owner" }, characterId, q);
    return r.ok ? json({ character_id: characterId, candidates: r.candidates }, 200, sess) : refused(r, sess);
  }
  const view = await theirPeople(db, characterId, sess.userId);
  if (!view) return json({ error: "character_not_found", message: "No character with that id." }, 404, sess);
  return json(view, 200, sess);
});

/**
 * Changes "Their people" of one of your characters, one action at a time: an off-screen person (add, edit, remove), a
 * tie (declare one, answer a proposal, end one, change one), a place (set, leave). Each refusal says why.
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { id: characterId } = await ctx.params;
  const sess = session(req);
  const body = parseBody(Action, await readJson(req), "invalid_circle_action");
  const db = await getDb();
  const by: DeclareBy = { userId: sess.userId, source: "owner" };
  switch (body.action) {
    case "add_person": {
      const r = await addPersonFor(db, by, characterId, body.person);
      return r.ok ? json({ person_id: r.person.id, tie_id: r.tie.id }, 201, sess) : refused(r, sess);
    }
    case "edit_person": {
      const r = await editPersonFor(db, by, body.person_id, body.person);
      return r.ok ? json({ person_id: r.person.id }, 200, sess) : refused(r, sess);
    }
    case "remove_person": {
      const r = await removePersonFor(db, by, body.person_id);
      return r.ok ? json({ removed: body.person_id }, 200, sess) : refused(r, sess);
    }
    case "declare_tie": {
      const r = await declareTie(db, by, characterId, body);
      return r.ok ? json({ tie_id: r.tie.id, status: r.status, news: r.news }, r.news ? 201 : 200, sess) : refused(r, sess);
    }
    case "answer_tie": {
      const r = await answerTie(db, by, body.tie_id, body.answer === "yes");
      return r.ok ? json({ tie_id: r.tie.id, status: r.tie.status }, 200, sess) : refused(r, sess);
    }
    case "end_tie": {
      const r = await endTieFor(db, by, body.tie_id);
      return r.ok ? json({ tie_id: body.tie_id, ended: r.ended }, 200, sess) : refused(r, sess);
    }
    case "edit_tie": {
      const { story, since, visibility: v } = body;
      const r = await editTieFor(db, by, body.tie_id, { ...(story !== undefined ? { story } : {}), ...(since !== undefined ? { since } : {}), ...(v ? { visibility: v } : {}) });
      return r.ok ? json({ tie_id: r.tie.id }, 200, sess) : refused(r, sess);
    }
    case "set_place": {
      const r = await setPlaceFor(db, by, characterId, body);
      return r.ok ? json({ place_id: r.place.id, key: r.place.key, role: r.role }, 200, sess) : refused(r, sess);
    }
    case "leave_place": {
      const r = await leavePlaceFor(db, by, characterId, body.place_id, body.role);
      return r.ok ? json({ left: body.place_id, role: body.role }, 200, sess) : refused(r, sess);
    }
  }
});
