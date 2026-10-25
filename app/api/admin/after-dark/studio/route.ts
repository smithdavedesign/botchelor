import { z } from "zod";
import { FRAMINGS } from "@/lib/adult/acts";
import { adultViewer } from "@/lib/adult/mode";
import { mediaRefusal } from "@/lib/adult/place";
import { removeShare, sharePicture } from "@/lib/adult/shares";
import {
  animatePicture,
  bodyShoot,
  deleteSetup,
  moreLikeThis,
  pairMenu,
  pairShoot,
  recast,
  redoShoot,
  restyle,
  saveSetup,
  RESTYLE_DETAILS,
  RESTYLE_STEPS,
  saveRestyleLooks,
  setBodyReference,
  setStrength,
  setStudioLimits,
  shoot,
  studioState,
  upscalePicture,
  type JobResult,
  type StudioFail,
} from "@/lib/adult/studio";
import { CUSTOM_MAX, DIALOG_MAX, EXTRA_MAX, GROUP_IDS, TRANSCRIPT_MAX } from "@/lib/adult/studio-catalog";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { requestBase } from "@/lib/site";

// A shoot draws up to four pictures at once (a minute or so) and checks each: a couple of minutes at most.
export const maxDuration = 300;

const id = z.string().min(1).max(64);
const model = z.string().max(120).nullable().optional();
/** On the viewer's own Venice or Replicate key (Connections, After Dark pictures) instead of ours. */
const own_key = z.boolean().optional();
/** A shoot's choices: one option id per group, accessories up to three (lib/adult/studio-catalog.ts checks each). */
const Choices = z
  .object(Object.fromEntries(GROUP_IDS.filter((g) => g !== "accessories").map((g) => [g, z.string().max(60).optional()])) as Record<string, z.ZodOptional<z.ZodString>>)
  .extend({
    accessories: z.array(z.string().max(60)).max(3).optional(),
    // The owner's own words (lib/adult/studio-catalog.ts): an overall direction, words added to a single section, and a line for a speech bubble.
    custom: z.string().max(CUSTOM_MAX).optional(),
    // partialRecord, not record: a record over an enum key is exhaustive in zod 4 (it would demand every section).
    extra: z.partialRecord(z.enum(GROUP_IDS), z.string().max(EXTRA_MAX)).optional(),
    dialog: z.string().max(DIALOG_MAX).optional(),
  })
  .strict();
/** A shoot together's choices, as a setup keeps them (the partner is picked when it runs). */
const PairChoices = z
  .object({
    act: z.string().max(40).optional(),
    swap: z.boolean().optional(),
    outfit: z.string().max(40).optional(),
    framing: z.enum(FRAMINGS).optional(),
    place: z.string().max(40).optional(),
    light: z.string().max(40).nullable().optional(),
  })
  .strict();
/** A restyle's changes: a pick per look step or detail (lib/adult/studio.ts restyleWords checks each). */
const Changes = z.object(Object.fromEntries([...RESTYLE_STEPS, ...RESTYLE_DETAILS].map((k) => [k, z.string().max(40).optional()]))).strict();

const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("shoot"), character_id: id, choices: Choices, model, own_key }),
  z.object({ action: z.literal("restyle"), character_id: id, changes: Changes, model, own_key }),
  z.object({ action: z.literal("save_looks"), character_id: id, changes: Changes }),
  z.object({ action: z.literal("recast"), character_id: id, model, own_key }),
  z.object({ action: z.literal("body"), character_id: id, nude: z.boolean().optional(), model, own_key }),
  z.object({
    action: z.literal("pair"),
    character_id: id,
    partner: id,
    act: z.string().max(40),
    swap: z.boolean().optional(),
    outfit: z.string().max(40),
    framing: z.enum(FRAMINGS),
    place: z.string().max(40),
    light: z.string().max(40).nullable().optional(),
    // The owner's own words, like the Shoot tab (David, 2026-10-24: "the Together page doesn't have enough options").
    custom: z.string().max(CUSTOM_MAX).optional(),
    dialog: z.string().max(DIALOG_MAX).optional(),
    model,
    own_key,
  }),
  z.object({ action: z.literal("variations"), character_id: id, image_id: id, model, own_key }),
  z.object({ action: z.literal("upscale"), character_id: id, image_id: id, own_key }),
  z.object({ action: z.literal("share"), character_id: id, image_id: id, to_character: id, kind: z.enum(["after_dark", "photo"]) }),
  z.object({ action: z.literal("unshare"), character_id: id, share_id: id }),
  z.object({ action: z.literal("save_setup"), character_id: id, name: z.string().max(80), kind: z.enum(["shoot", "pair"]), choices: z.union([Choices, PairChoices]), model }),
  z.object({ action: z.literal("delete_setup"), character_id: id, setup_id: id }),
  z.object({
    action: z.literal("animate"),
    character_id: id,
    image_id: id,
    motion: z.string().max(30).optional(),
    seconds: z.union([z.literal(5), z.literal(10)]),
    // The owner guides the clip (lib/adult/studio-catalog.ts): what should happen, what they say, and the lines around it.
    guide: z.string().max(CUSTOM_MAX).optional(),
    dialog: z.string().max(DIALOG_MAX).optional(),
    transcript: z.string().max(TRANSCRIPT_MAX).optional(),
  }),
  z.object({ action: z.literal("use_body"), character_id: id, image_id: id.nullable() }),
  z.object({ action: z.literal("limits"), character_id: id, intensity: z.string().max(20).optional(), hard_nos: z.array(z.string().max(30)).max(30).optional() }),
  z.object({ action: z.literal("strength"), character_id: id, strength: z.string().max(20) }),
  z.object({ action: z.literal("redo"), shoot_id: id }),
]);

/** Not found for everyone After Dark isn't open to (lib/adult/mode.ts); the Studio's own rules are lib/adult/studio.ts's. */
const hidden = () => json({ error: "not_found" }, 404);
const failed = (r: StudioFail) => json({ error: r.error, message: r.message }, r.status);

/** The Studio for one character (?character=): what the page shows; with ?partner=, the pair shoot's menu for them. */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  // Text only where they connect from (lib/adult/place.ts): no pictures, video or voice.
  const refused = await mediaRefusal(db, viewer);
  if (refused) return refused;
  const q = new URL(req.url).searchParams;
  const character = q.get("character") ?? "";
  const partner = q.get("partner");
  if (partner) {
    const m = await pairMenu(db, viewer, character, partner);
    return m.ok ? json({ pair_menu: m.menu }) : failed(m);
  }
  const r = await studioState(db, viewer, character);
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
      return job(input.character_id, await shoot(db, viewer, input.character_id, { choices: input.choices, model: input.model, own_key: input.own_key }, base));
    case "restyle":
      return job(input.character_id, await restyle(db, viewer, input.character_id, { changes: input.changes, model: input.model, own_key: input.own_key }, base));
    case "recast":
      return job(input.character_id, await recast(db, viewer, input.character_id, { model: input.model, own_key: input.own_key }));
    case "body":
      return job(input.character_id, await bodyShoot(db, viewer, input.character_id, { nude: input.nude, model: input.model, own_key: input.own_key }, base));
    case "pair": {
      const { action: _a, character_id, ...pair } = input;
      return job(character_id, await pairShoot(db, viewer, character_id, pair, base));
    }
    case "variations":
      return job(input.character_id, await moreLikeThis(db, viewer, input.character_id, { image_id: input.image_id, model: input.model, own_key: input.own_key }, base));
    case "upscale":
      return job(input.character_id, await upscalePicture(db, viewer, input.character_id, { image_id: input.image_id, own_key: input.own_key }));
    case "share": {
      const r = await sharePicture(db, viewer, { image_id: input.image_id, to_character: input.to_character, kind: input.kind });
      return r.ok ? after(input.character_id, { share: r.share }) : failed(r);
    }
    case "save_setup": {
      const r = await saveSetup(db, viewer, input.character_id, { name: input.name, kind: input.kind, choices: input.choices, model: input.model });
      return r.ok ? after(input.character_id, { setup: r.setup }) : failed(r);
    }
    case "delete_setup": {
      const ok = await deleteSetup(db, viewer, input.setup_id);
      return ok ? after(input.character_id, {}) : json({ error: "not_found", message: "No setup of yours with that id." }, 404);
    }
    case "animate":
      return job(input.character_id, await animatePicture(db, viewer, input.character_id, { image_id: input.image_id, motion: input.motion, seconds: input.seconds, guide: input.guide, dialog: input.dialog, transcript: input.transcript }, base));
    case "unshare": {
      // The sharer takes an After Dark share back (a photo already in their texts stays: it was sent).
      const ok = await removeShare(db, viewer, input.share_id);
      return ok ? after(input.character_id, {}) : json({ error: "not_found", message: "No share of yours with that id." }, 404);
    }
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
