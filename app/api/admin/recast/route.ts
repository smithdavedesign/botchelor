import { z } from "zod";
import { PATCH as patchCharacter } from "@/app/api/characters/[id]/route";
import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { findMatches } from "@/lib/dating";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, sessionCookies } from "@/lib/http";
import { drawRecastBody, drawRecastPortrait, PROPS_MAX, RECAST_LOOK_MAX, recastOwner, ROLE_MAX, SCENE_MAX, KIND_MAX, type RecastRole } from "@/lib/recast";
import { answerMatch, swipe } from "@/lib/swipes";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const id = z.string().min(1).max(64);
const roleFields = {
  role: z.string().trim().min(1).max(ROLE_MAX).optional(),
  props: z.string().trim().max(PROPS_MAX).optional(),
  scene: z.string().trim().max(SCENE_MAX).optional(),
  kind: z.string().trim().max(KIND_MAX).optional(),
};
const Input = z.discriminatedUnion("action", [
  // The owner's own edit, as the owner (the PATCH body: every check of an ordinary edit applies).
  z.object({ action: z.literal("update"), character_id: id, patch: z.record(z.string(), z.unknown()) }),
  // Their portrait from their look (saved first when given), showing who they are (role, props, setting).
  z.object({ action: z.literal("portrait"), character_id: id, look: z.string().trim().max(RECAST_LOOK_MAX).optional(), ...roleFields }),
  // Their full-body reference from that portrait, in what they wear and hold.
  z.object({ action: z.literal("body"), character_id: id, outfit: z.string().trim().max(200).optional(), ...roleFields }),
  // Who suits them, by the deck's own ranking (as their owner sees it).
  z.object({ action: z.literal("rank"), character_id: id, limit: z.number().int().min(1).max(200).optional() }),
  // A like, as their owner swipes it.
  z.object({ action: z.literal("like"), character_id: id, target_id: id }),
  // Their answer to a match, as their owner's agent gives it.
  z.object({ action: z.literal("answer"), character_id: id, with_id: id, yes: z.boolean() }),
]);

/**
 * Admin only (the admin password or a signed-in admin): the recast of the show's own agent-made characters (lib/recast.ts).
 * Each action acts on one agent-made character, as its owner, through the same code an owner's edit, swipe or answer
 * runs; never a person's character, a house one, or one kept only for its old dates. Pictures given a `role` must read as
 * it (lib/recast.ts: one pushed redraw at most, then flagged with role_ok false).
 */
const roleOf = (i: { role?: string; props?: string; scene?: string; kind?: string }): RecastRole | null =>
  i.role ? { role: i.role, props: i.props ?? null, scene: i.scene ?? null, kind: i.kind ?? null } : null;

export const POST = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const db = await getDb();
  const owner = await recastOwner(db, input.character_id);
  if (!owner) return json({ error: "character_not_found", message: "No agent-made character on the show with that id." }, 404);

  switch (input.action) {
    case "update": {
      const cookie = sessionCookies({ userId: owner, authenticated: true })[0].split(";")[0];
      const edit = new Request(new URL(`/api/characters/${input.character_id}`, req.url), {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(input.patch),
      });
      const res = await patchCharacter(edit, { params: Promise.resolve({ id: input.character_id }) });
      const body = await res.json().catch(() => ({}));
      return json({ updated: res.ok, status: res.status, result: body }, res.ok ? 200 : res.status);
    }
    case "portrait": {
      const r = await drawRecastPortrait(db, input.character_id, input.look, roleOf(input));
      return json(r, r.ok ? 200 : r.again ? 503 : 422);
    }
    case "body": {
      const r = await drawRecastBody(db, input.character_id, req.url, input.outfit ?? null, roleOf(input));
      return json(r, r.ok ? 200 : r.status);
    }
    case "rank": {
      const r = await findMatches(db, owner, input.character_id, input.limit ?? 10, 200);
      return json({ ok: true, matches: (r?.matches ?? []).map((m) => ({ id: m.id, name: m.name, made_by: m.made_by, can_ask_out: m.can_ask_out, score: m.score, why: m.why, relationship: m.relationship ?? null })) });
    }
    case "like": {
      const r = await swipe(db, owner, input.character_id, input.target_id, true);
      return json(r, r.ok ? 200 : r.status);
    }
    case "answer": {
      const r = await answerMatch(db, owner, input.character_id, input.with_id, input.yes);
      return json(r, r.ok ? 200 : r.status);
    }
  }
});
