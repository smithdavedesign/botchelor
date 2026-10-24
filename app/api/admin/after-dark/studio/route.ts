import { z } from "zod";
import { adultViewer } from "@/lib/adult/mode";
import { mediaRefusal } from "@/lib/adult/place";
import {
  bodyShoot,
  recast,
  redoShoot,
  restyle,
  RESTYLE_DETAILS,
  RESTYLE_STEPS,
  saveRestyleLooks,
  setBodyReference,
  setStrength,
  setStudioLimits,
  shoot,
  studioState,
  type JobResult,
  type StudioFail,
} from "@/lib/adult/studio";
import { GROUP_IDS } from "@/lib/adult/studio-catalog";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { requestBase } from "@/lib/site";

// A shoot draws up to four pictures at once (a minute or so) and checks each: a couple of minutes at most.
export const maxDuration = 300;

const id = z.string().min(1).max(64);
const model = z.string().max(120).nullable().optional();
/** A shoot's choices: one option id per group, accessories up to three (lib/adult/studio-catalog.ts checks each). */
const Choices = z
  .object(Object.fromEntries(GROUP_IDS.filter((g) => g !== "accessories").map((g) => [g, z.string().max(60).optional()])) as Record<string, z.ZodOptional<z.ZodString>>)
  .extend({ accessories: z.array(z.string().max(60)).max(3).optional() })
  .strict();
/** A restyle's changes: a pick per look step or detail (lib/adult/studio.ts restyleWords checks each). */
const Changes = z.object(Object.fromEntries([...RESTYLE_STEPS, ...RESTYLE_DETAILS].map((k) => [k, z.string().max(40).optional()]))).strict();

const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("shoot"), character_id: id, choices: Choices, model }),
  z.object({ action: z.literal("restyle"), character_id: id, changes: Changes, model }),
  z.object({ action: z.literal("save_looks"), character_id: id, changes: Changes }),
  z.object({ action: z.literal("recast"), character_id: id, model }),
  z.object({ action: z.literal("body"), character_id: id, nude: z.boolean().optional(), model }),
  z.object({ action: z.literal("use_body"), character_id: id, image_id: id.nullable() }),
  z.object({ action: z.literal("limits"), character_id: id, intensity: z.string().max(20).optional(), hard_nos: z.array(z.string().max(30)).max(30).optional() }),
  z.object({ action: z.literal("strength"), character_id: id, strength: z.string().max(20) }),
  z.object({ action: z.literal("redo"), shoot_id: id }),
]);

/** Not found for everyone After Dark isn't open to (lib/adult/mode.ts); the Studio's own rules are lib/adult/studio.ts's. */
const hidden = () => json({ error: "not_found" }, 404);
const failed = (r: StudioFail) => json({ error: r.error, message: r.message }, r.status);

/** The Studio for one character (?character=): what the page shows. */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  // Text only where they connect from (lib/adult/place.ts): no pictures, video or voice.
  const refused = await mediaRefusal(db, viewer);
  if (refused) return refused;
  const r = await studioState(db, viewer, new URL(req.url).searchParams.get("character") ?? "");
  return r.ok ? json({ state: r.state }) : failed(r);
});

/** One Studio action; the answer carries the Studio's state after it, so the page never asks twice. */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  // Text only where they connect from (lib/adult/place.ts): no pictures, video or voice.
  const refused = await mediaRefusal(db, viewer);
  if (refused) return refused;
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const base = requestBase(req);
  const after = async (characterId: string, extra: Record<string, unknown>) => {
    const s = await studioState(db, viewer, characterId);
    return json({ ...extra, ...(s.ok ? { state: s.state } : {}) });
  };
  const job = async (characterId: string, r: JobResult) => (r.ok ? after(characterId, { shoot: r.shoot, pictures: r.pictures, refunded: r.refunded, message: r.message }) : failed(r));
  switch (input.action) {
    case "shoot":
      return job(input.character_id, await shoot(db, viewer, input.character_id, { choices: input.choices, model: input.model }, base));
    case "restyle":
      return job(input.character_id, await restyle(db, viewer, input.character_id, { changes: input.changes, model: input.model }, base));
    case "recast":
      return job(input.character_id, await recast(db, viewer, input.character_id, { model: input.model }));
    case "body":
      return job(input.character_id, await bodyShoot(db, viewer, input.character_id, { nude: input.nude, model: input.model }, base));
    case "save_looks": {
      const r = await saveRestyleLooks(db, viewer, input.character_id, input.changes);
      return r.ok ? after(input.character_id, { appearance: r.appearance }) : failed(r);
    }
    case "use_body": {
      const r = await setBodyReference(db, viewer, input.character_id, input.image_id);
      return r.ok ? after(input.character_id, {}) : failed(r);
    }
    case "limits": {
      const r = await setStudioLimits(db, viewer, input.character_id, input);
      return r.ok ? after(input.character_id, {}) : failed(r);
    }
    case "strength": {
      const r = await setStrength(db, viewer, input.character_id, input.strength);
      return r.ok ? after(input.character_id, {}) : failed(r);
    }
    case "redo": {
      const r = await redoShoot(db, viewer, input.shoot_id, base);
      if (!r.ok) return failed(r);
      const cid = (await db.query<{ character_id: string }>(`select character_id from adult_studio_shoots where id = $1`, [r.shoot.id])).rows[0]?.character_id ?? "";
      return job(cid, r);
    }
  }
});
