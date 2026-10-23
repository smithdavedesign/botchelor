import { z } from "zod";
import { adultViewer } from "@/lib/adult/mode";
import { listMedia } from "@/lib/adult/media";
import { WHISPER_MAX } from "@/lib/adult/director";
import { SCENE_HEATS } from "@/lib/adult/heat";
import { continueScene, forgetWhisper, listNights, openScene, redoScene, resetScene, rewindScene, SET_SCENE_MAX, setSceneHeat, setSceneTo } from "@/lib/adult/scenes";
import { isAdmin } from "@/lib/admins";
import { refundBoughtTokens, SET_SCENE_TOKEN_COST, spendBoughtTokens } from "@/lib/allowance";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";

// A long scene, plus a picture or two, can take a while.
export const maxDuration = 300;

const id = z.string().min(1).max(64);
const Input = z.object({
  a: id,
  b: id,
  direction: z.string().max(300).optional(),
  reset: z.literal(true).optional(),
  set_scene: z.string().max(SET_SCENE_MAX).optional(),
  steer_mode: z.enum(["nudge", "direct"]).optional(),
  // The director (lib/adult/director.ts): take the last step back, or take it back and write it again; a whisper to one
  // of the two (instead of a steer), or forget one still running.
  rewind: z.literal(true).optional(),
  redo: z.literal(true).optional(),
  whisper: z.object({ to: z.enum(["a", "b"]), text: z.string().min(1).max(WHISPER_MAX) }).optional(),
  forget_whisper: z.enum(["a", "b"]).optional(),
  // How explicitly the scene is written (lib/adult/heat.ts). Alone, it's only set; with a step, it's set first.
  heat: z.enum(SCENE_HEATS).optional(),
});

/** Not found for everyone but a signed-in admin while after dark is open (lib/adult/mode.ts). */
const hidden = () => json({ error: "not_found" }, 404);

export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const admin = await adultViewer(db, req);
  if (!admin) return hidden();
  const q = new URL(req.url).searchParams;
  const scene = await openScene(db, admin, q.get("a") ?? "", q.get("b") ?? "");
  return scene ? json({ scene, gallery: await listMedia(db, [scene.a.id, scene.b.id]) }) : hidden();
});

export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const admin = await adultViewer(db, req);
  if (!admin) return hidden();
  const input = parseBody(Input, await readJson(req), "invalid_request");
  if (input.heat) {
    const scene = await setSceneHeat(db, admin, input.a, input.b, input.heat);
    if (!scene) return hidden();
    const step = [input.direction, input.reset, input.set_scene, input.steer_mode, input.rewind, input.redo, input.whisper, input.forget_whisper];
    if (step.every((v) => v === undefined)) return json({ scene });
  }
  if (input.reset) {
    await resetScene(db, admin, input.a, input.b);
    const scene = await openScene(db, admin, input.a, input.b);
    return scene ? json({ scene, nights: await listNights(db, admin, input.a, input.b) }) : hidden();
  }
  if (input.set_scene !== undefined) {
    // Set the scene: 1 bought token (admins don't pay, like clips), given back if the place is refused.
    const pays = !(await isAdmin(db, admin));
    if (pays && !(await spendBoughtTokens(db, admin, SET_SCENE_TOKEN_COST))) {
      return json({ error: "needs_tokens", message: `Setting the scene costs ${SET_SCENE_TOKEN_COST} token. Get more on the shop page.` }, 402);
    }
    const moved = await setSceneTo(db, admin, input.a, input.b, input.set_scene);
    if (!moved.ok) {
      if (pays) await refundBoughtTokens(db, admin, SET_SCENE_TOKEN_COST);
      return json({ error: "not_moved", message: moved.message }, moved.status);
    }
    return json({ scene: moved.scene, ...(moved.auto_picture ? { auto_picture: true } : {}) });
  }
  if (input.rewind) {
    const back = await rewindScene(db, admin, input.a, input.b);
    if (!back.ok) return json({ error: "not_rewound", message: back.message }, back.status);
    return json({ scene: back.scene, rewound: back.rewound, nights: await listNights(db, admin, input.a, input.b) });
  }
  if (input.forget_whisper) {
    const scene = await forgetWhisper(db, admin, input.a, input.b, input.forget_whisper);
    return scene ? json({ scene }) : hidden();
  }
  const r = input.redo
    ? await redoScene(db, admin, input.a, input.b)
    : await continueScene(db, admin, input.a, input.b, input.direction ?? null, input.steer_mode ?? "nudge", { whisper: input.whisper ?? null });
  if (!r.ok) return json({ error: "not_continued", message: r.message }, r.status);
  return json({
    scene: r.scene,
    added: r.added,
    held: r.held,
    repeats: r.repeats,
    dropped: r.dropped,
    pictures: r.pictures,
    ...(r.picture_note ? { picture_note: r.picture_note } : {}),
    // A picture of the chapter or the new place is being drawn (lib/adult/auto-pictures.ts): the page looks for it shortly.
    ...(r.auto_picture ? { auto_picture: true } : {}),
    // A redo can take back a chapter's close, so its night list may have changed.
    ...(input.redo ? { nights: await listNights(db, admin, input.a, input.b) } : {}),
  });
});
