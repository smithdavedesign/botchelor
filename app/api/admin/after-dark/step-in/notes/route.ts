import { z } from "zod";
import { getStepInScene, stepInViewer } from "@/lib/adult/step-in";
import { NOTE_PACES, notePrefs, NOTES_ABOUT, notesWaiting, PACES, seenNote, setNotePrefs, setSceneNotes } from "@/lib/adult/step-in-notes";
import { NOTE_WHY_WORDS, writeNoteNow } from "@/lib/adult/step-in-notes-pass";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";

// "now" is a reply (an admin trying it): a model call, two when the first draft can't be kept.
export const maxDuration = 300;

const id = z.string().min(1).max(64);
const hour = z.number().int().min(0).max(23);
const Action = z.discriminatedUnion("action", [
  // Their choice: how often (null: off), their quiet hours as two whole hours in their own clock, and the time zone
  // their browser gave (lib/adult/step-in-notes.ts keeps a zone it doesn't know as UTC).
  z.object({ action: z.literal("save"), pace: z.enum(NOTE_PACES).nullable(), quiet_from: hour.optional(), quiet_to: hour.optional(), time_zone: z.string().max(64).optional() }),
  // One scene told not to be written to first, or to again.
  z.object({ action: z.literal("scene"), scene_id: id, off: z.boolean() }),
  // They've seen the note that was waiting in a scene (its page opened).
  z.object({ action: z.literal("seen"), scene_id: id }),
  // An admin has one written now in a scene of their own, to see it work.
  z.object({ action: z.literal("now"), scene_id: id }),
]);

/** Not found for anyone Step in isn't open to, exactly like After Dark's other closed pieces. */
const hidden = () => json({ error: "not_found" }, 404);

const state = async (db: Awaited<ReturnType<typeof getDb>>, viewer: string) => ({
  notes: await notePrefs(db, viewer),
  about: NOTES_ABOUT,
  paces: NOTE_PACES.map((p) => ({ id: p, label: PACES[p].label, says: PACES[p].says })),
  waiting: await notesWaiting(db, viewer),
});

/**
 * The character writing first (lib/adult/step-in-notes.ts): `GET` is the viewer's choice (off until they turn it on),
 * what turning it on means in words, and the notes waiting for them; `POST` saves the choice, tells one scene not to,
 * marks a waiting note seen, or (an admin only) has one written now. Only the viewer's own.
 */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await stepInViewer(db, req);
  if (!viewer) return hidden();
  return json(await state(db, viewer));
});

export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await stepInViewer(db, req);
  if (!viewer) return hidden();
  const input = parseBody(Action, await readJson(req), "invalid_request");
  if (input.action === "save") {
    await setNotePrefs(db, viewer, { pace: input.pace, quiet_from: input.quiet_from, quiet_to: input.quiet_to, time_zone: input.time_zone });
    return json(await state(db, viewer));
  }
  if (input.action === "scene") {
    if (!(await setSceneNotes(db, viewer, input.scene_id, input.off))) return hidden();
    const scene = await getStepInScene(db, viewer, input.scene_id);
    return scene.ok ? json({ scene: scene.view }) : hidden();
  }
  if (input.action === "seen") {
    // Nothing to say when nothing was waiting: the page asks whenever it opens on one.
    return json({ seen: await seenNote(db, viewer, input.scene_id) });
  }
  const r = await writeNoteNow(db, viewer, input.scene_id);
  if (!r.ok && r.status === 404) return hidden();
  const scene = await getStepInScene(db, viewer, input.scene_id);
  if (!scene.ok) return hidden();
  return r.ok ? json({ scene: scene.view, note: r.id }) : json({ error: r.why, message: NOTE_WHY_WORDS[r.why], scene: scene.view }, r.status);
});
