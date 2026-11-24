import { z } from "zod";
import { answerBeat, PICTURE_FIELD_MAX, pictureNow, previewPicture, redrawPicture, SCENE_CUSTOM_MAX, SCENE_DIALOG_MAX } from "@/lib/adult/beats";
import { adultViewer } from "@/lib/adult/mode";
import { mediaRefusal } from "@/lib/adult/place";
import { listMedia } from "@/lib/adult/media";
import { WHISPER_MAX } from "@/lib/adult/director";
import { HARD_NO_IDS, INTENSITIES, OWN_LEN, OWN_MAX } from "@/lib/adult/limits";
import { FRAMING_IDS, hasProfileConsent, PROFILE_CONSENT_TEXT, recordProfileConsent, setTurnOns, TURN_ON_IDS } from "@/lib/adult/profile";
import { SCENARIOS } from "@/lib/adult/scenarios";
import {
  continueScene,
  editMemory,
  forgetWhisper,
  listNights,
  memoryView,
  openScene,
  profileView,
  redoScene,
  resetScene,
  rewindScene,
  saveFraming,
  setRoleplay,
  saveLimits,
  SET_SCENE_MAX,
  setSceneTo,
  startScenario,
} from "@/lib/adult/scenes";
import { ROLEPLAY_IDS } from "@/lib/adult/roleplays";
import { KEPT_ANSWER, KEPT_ANSWER_HEADER, type KeptAnswer } from "@/lib/adult/write-watch";
import { USER_ROLEPLAY } from "@/lib/studio/library";
import { isAdmin } from "@/lib/admins";
import { includedPrice } from "@/lib/adult/pricing";
import { getAdultSettings } from "@/lib/adult/settings";
import type { Db } from "@/lib/db";
import { SET_SCENE_TOKEN_COST } from "@/lib/allowance";
import { moreTokensLine, refundAdTokens, spendAdTokens } from "@/lib/adult/tokens";
import { crisisAware, str, type CrisisSurface } from "@/lib/crisis";
import { getDb } from "@/lib/db";
import { handle, json, jsonWhenDone, parseBody, readJson } from "@/lib/http";
import { requestBase } from "@/lib/site";

// A long scene, plus a picture or two, can take a while.
export const maxDuration = 300;

const id = z.string().min(1).max(64);
/** The owner's changes to a scene picture's context (lib/adult/beats.ts PictureEdit). */
const PictureEditInput = z.object({
  happening: z.string().max(PICTURE_FIELD_MAX).optional(),
  wearing: z.string().max(PICTURE_FIELD_MAX).optional(),
  place: z.string().max(PICTURE_FIELD_MAX).optional(),
  mood: z.string().max(PICTURE_FIELD_MAX).optional(),
  extra: z.string().max(SCENE_CUSTOM_MAX).optional(),
});
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
  // The viewer's limits for the pair (lib/adult/limits.ts): the intensity and the hard nos.
  limits: z
    .object({
      intensity: z.enum(INTENSITIES).optional(),
      hard_nos: z.object({ chips: z.array(z.enum(HARD_NO_IDS as [string, ...string[]])).max(HARD_NO_IDS.length).optional(), own: z.array(z.string().max(OWN_LEN * 2)).max(OWN_MAX * 2).optional() }).optional(),
    })
    .optional(),
  // Start a night from a scenario (lib/adult/scenarios.ts); how the viewer frames the pair; a character's turn-ons.
  scenario: z.enum(SCENARIOS.map((x) => x.id) as [string, ...string[]]).optional(),
  framing: z.enum(FRAMING_IDS as [string, ...string[]]).nullable().optional(),
  // This chapter's roleplay (lib/adult/roleplays.ts), sent with set_scene from the scene picker, or on its own (null clears it).
  // `opening`: which of its card's three openings the first lines play (lib/scene-cards.ts); left out, the first.
  roleplay: z
    .object({ id: z.union([z.enum(ROLEPLAY_IDS), z.string().regex(USER_ROLEPLAY)]), swap: z.boolean().optional(), opening: z.number().int().min(0).max(2).optional() })
    .nullable()
    .optional(),
  turn_ons: z.object({ character_id: id, ids: z.array(z.enum(TURN_ON_IDS as [string, ...string[]])).max(TURN_ON_IDS.length) }).optional(),
  // Their memory, seen and edited (null text deletes): a PG note, a fact, or the night's recap.
  memory_edit: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("note"), of: z.enum(["a", "b"]), text: z.string().max(600).nullable() }),
      z.object({ kind: z.literal("fact"), id, text: z.string().max(400).nullable() }),
      z.object({ kind: z.literal("recap"), text: z.string().max(2400).nullable() }),
    ])
    .optional(),
  // Beat pictures (lib/adult/beats.ts): the viewer's answer to an offered moment, or Picture this at a line. `custom`
  // leads the scene picture and `dialog` is a speech-bubble line (both optional; held to the lines).
  beat: z.object({ id, answer: z.enum(["now", "later"]), custom: z.string().max(SCENE_CUSTOM_MAX).optional(), dialog: z.string().max(SCENE_DIALOG_MAX).optional(), edit: PictureEditInput.optional() }).optional(),
  picture_now: z.object({ line: z.number().int().min(0).max(10_000), custom: z.string().max(SCENE_CUSTOM_MAX).optional(), dialog: z.string().max(SCENE_DIALOG_MAX).optional(), edit: PictureEditInput.optional() }).optional(),
  // What a scene picture would be drawn from, nothing drawn (lib/adult/beats.ts previewPicture), and Redraw.
  picture_preview: z.object({ beat: id.optional(), line: z.number().int().min(0).max(10_000).optional(), picture: id.optional(), edit: PictureEditInput.optional() }).optional(),
  redraw: z.object({ picture_id: id, edit: PictureEditInput.optional() }).optional(),
  // GDPR Art. 9 (lib/adult/profile.ts PROFILE_CONSENT_TEXT): the ticked consent, sent with a save of turn-ons or hard
  // nos (consent), or on its own when the box is ticked (profile_consent: what was saved before is now under it).
  consent: z.literal(true).optional(),
  profile_consent: z.literal(true).optional(),
});

/** The consent's state, for the Limits and "What they're into" panels. */
const consentView = async (db: Awaited<ReturnType<typeof getDb>>, viewer: string) => ({ given: await hasProfileConsent(db, viewer), text: PROFILE_CONSENT_TEXT });

/** Not found for everyone but a signed-in admin while after dark is open (lib/adult/mode.ts). */
const hidden = () => json({ error: "not_found" }, 404);

export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const admin = await adultViewer(db, req);
  if (!admin) return hidden();
  const q = new URL(req.url).searchParams;
  // Each one's turn-ons, for a character whose profile the viewer may set (theirs; an admin's house cast).
  if (q.get("profile") === "1") {
    const profile = await profileView(db, admin, q.get("a") ?? "", q.get("b") ?? "");
    return profile ? json({ profile, consent: await consentView(db, admin) }) : hidden();
  }
  // Whether the viewer has agreed to their turn-ons and hard nos being stored (the Limits panel asks when it opens).
  if (q.get("consent") === "1") return json({ consent: await consentView(db, admin) });
  // What they remember, for the page's memory panel (owner-scoped).
  if (q.get("memory") === "1") {
    const memory = await memoryView(db, admin, q.get("a") ?? "", q.get("b") ?? "");
    return memory ? json({ memory }) : hidden();
  }
  const scene = await openScene(db, admin, q.get("a") ?? "", q.get("b") ?? "");
  if (!scene) return hidden();
  // What a page waiting on a write asks for (lib/adult/write-watch.ts). `gallery=0`: the scene alone, for its looks
  // every few seconds while the lines are written (the gallery is every picture and video of the pair, and nothing in
  // it is what the page is waiting for). `nights=1`: their saved nights too, once it has followed a write whose answer
  // it lost to its end: a step can file a chapter, and that answer would have carried the list.
  return json({
    scene,
    ...(q.get("gallery") === "0" ? {} : { gallery: await listMedia(db, [scene.a.id, scene.b.id], admin, { withArchived: true }) }),
    ...(q.get("nights") === "1" ? { nights: await listNights(db, admin, scene.a.id, scene.b.id) } : {}),
  });
});

// A steer and a whisper are the viewer's own words: checked for self-harm intent (lib/crisis.ts), the reply then
// carries crisis_resources whatever else it says.
const ownWords = (b: Record<string, unknown>) => [str(b.direction), str((b.whisper as { text?: unknown } | undefined)?.text)];
const surface = (b: Record<string, unknown>): CrisisSurface => (b.whisper ? "after_dark_whisper" : "after_dark_steer");

/**
 * A chapter's price (lib/adult/settings.ts chapter_tokens, David 2026-10-25: "each chapter cost 1 token"), taken when a
 * step starts one: the night's first lines, or the first after a chapter closes (`always`: a scenario, which starts a
 * night). Admins don't pay, and a subscriber's chapters are included (#1005; David, 2026-10-30; lib/adult/pricing.ts),
 * bounded by the month's scene steps. The tokens taken, or the refusal; the caller gives them back if no lines come.
 */
async function payChapter(db: Db, viewer: string, a: string, b: string, opts: { always?: boolean } = {}): Promise<{ paid: number } | Response> {
  const price = (await includedPrice(db, viewer, (await getAdultSettings(db)).chapter_tokens)).tokens;
  if (price <= 0) return { paid: 0 };
  if (!opts.always) {
    const scene = await openScene(db, viewer, a, b);
    if (!scene || scene.lines.length) return { paid: 0 };
  }
  if (!(await spendAdTokens(db, viewer, price))) {
    return json({ error: "needs_tokens", message: `Each chapter costs ${price} token${price === 1 ? "" : "s"} (up to 120 lines, with its pictures). ${moreTokensLine()}` }, 402);
  }
  return { paid: price };
}

const act = crisisAware(surface, ownWords, handle(async (req: Request) => {
  const db = await getDb();
  const admin = await adultViewer(db, req);
  if (!admin) return hidden();
  const input = parseBody(Input, await readJson(req), "invalid_request");
  if (input.reset) {
    await resetScene(db, admin, input.a, input.b);
    const scene = await openScene(db, admin, input.a, input.b);
    return scene ? json({ scene, nights: await listNights(db, admin, input.a, input.b) }) : hidden();
  }
  if (input.set_scene !== undefined) {
    // Set the scene: 1 bought token (admins don't pay, like clips), given back if the place is refused.
    const pays = !(await isAdmin(db, admin));
    if (pays && !(await spendAdTokens(db, admin, SET_SCENE_TOKEN_COST))) {
      return json({ error: "needs_tokens", message: `Setting the scene costs ${SET_SCENE_TOKEN_COST} token. ${moreTokensLine()}` }, 402);
    }
    const moved = await setSceneTo(db, admin, input.a, input.b, input.set_scene);
    if (!moved.ok) {
      if (pays) await refundAdTokens(db, admin, SET_SCENE_TOKEN_COST);
      return json({ error: "not_moved", message: moved.message }, moved.status);
    }
    // The roleplay picked with the place, for the chapter (the picker's second screen).
    const played = input.roleplay !== undefined ? await setRoleplay(db, admin, input.a, input.b, input.roleplay) : null;
    return json({ scene: played ?? moved.scene, ...(moved.auto_picture ? { auto_picture: true } : {}) });
  }
  if (input.rewind) {
    const back = await rewindScene(db, admin, input.a, input.b);
    if (!back.ok) return json({ error: "not_rewound", message: back.message }, back.status);
    return json({ scene: back.scene, rewound: back.rewound, nights: await listNights(db, admin, input.a, input.b) });
  }
  if (input.scenario) {
    const pay = await payChapter(db, admin, input.a, input.b, { always: true });
    if (pay instanceof Response) return pay;
    const r = await startScenario(db, admin, input.a, input.b, input.scenario);
    if (!r.ok && pay.paid) await refundAdTokens(db, admin, pay.paid);
    if (!r.ok) return json({ error: "not_started", message: r.message, ...(r.placed ? { scene: r.placed, nights: await listNights(db, admin, input.a, input.b) } : {}) }, r.status);
    return json({ scene: r.scene, added: r.added, held: r.held, repeats: r.repeats, dropped: r.dropped, pictures: r.pictures, nights: await listNights(db, admin, input.a, input.b) });
  }
  if (input.roleplay !== undefined) {
    const scene = await setRoleplay(db, admin, input.a, input.b, input.roleplay);
    return scene ? json({ scene }) : hidden();
  }
  if (input.framing !== undefined) {
    const scene = await saveFraming(db, admin, input.a, input.b, input.framing);
    return scene ? json({ scene }) : hidden();
  }
  if (input.profile_consent && !input.turn_ons && !input.limits) {
    await recordProfileConsent(db, admin);
    return json({ consent: { given: true, text: PROFILE_CONSENT_TEXT } });
  }
  if (input.turn_ons) {
    // Only for one of this pair, in the viewer's After Dark.
    if (!(await openScene(db, admin, input.a, input.b)) || ![input.a, input.b].includes(input.turn_ons.character_id)) return hidden();
    const r = await setTurnOns(db, admin, input.turn_ons.character_id, input.turn_ons.ids, { consent: input.consent });
    if (!r.ok) return json({ error: r.consent_required ? "consent_required" : "not_saved", message: r.message, ...(r.consent_required ? { consent_text: PROFILE_CONSENT_TEXT } : {}) }, r.status);
    return json({ profile: await profileView(db, admin, input.a, input.b), consent: await consentView(db, admin) });
  }
  if (input.limits) {
    const r = await saveLimits(db, admin, input.a, input.b, input.limits, { consent: input.consent });
    if (!r.ok) return json({ error: r.consent_required ? "consent_required" : "not_saved", message: r.message, ...(r.consent_required ? { consent_text: PROFILE_CONSENT_TEXT } : {}) }, r.status);
    return json({ scene: r.scene, consent: await consentView(db, admin) });
  }
  if (input.memory_edit) {
    const r = await editMemory(db, admin, input.a, input.b, input.memory_edit);
    if (!r.ok) return json({ error: "not_saved", message: r.message }, r.status);
    return json({ scene: r.scene, memory: r.memory });
  }
  if (input.picture_preview) {
    // What it would be drawn from, as the form shows it: nothing drawn, nothing spent.
    const scene = await openScene(db, admin, input.a, input.b);
    if (!scene) return hidden();
    const plan = await previewPicture(db, admin, { ...scene, a: scene.a.id, b: scene.b.id, place: scene.set_place ?? scene.place }, input.picture_preview, input.picture_preview.edit);
    if (!plan.ok) return json({ error: "not_previewed", message: plan.message }, plan.status);
    return json({ preview: { fields: plan.fields, wearing_from: plan.wearing_from, edit: plan.edit, prompt: plan.prompt } });
  }
  if (input.redraw) {
    // A picture, so the regional rule first, as on every other media route (text only in the UK and Japan, lib/adult/place.ts).
    const refused = await mediaRefusal(db, admin);
    if (refused) return refused;
    const scene = await openScene(db, admin, input.a, input.b);
    if (!scene) return hidden();
    // What a picture from the shot menu costs, given back if it doesn't come: free for an admin, included with a
    // subscription (#1005, David 2026-10-30), bounded by the month's pictures.
    const price = (await includedPrice(db, admin, (await getAdultSettings(db)).menu_picture_tokens)).tokens;
    if (price > 0 && !(await spendAdTokens(db, admin, price))) {
      return json({ error: "needs_tokens", message: `Redrawing a picture costs ${price} token${price === 1 ? "" : "s"}. ${moreTokensLine()}` }, 402);
    }
    const r = await redrawPicture(db, admin, input.redraw.picture_id, input.redraw.edit, requestBase(req), { ...scene, a: scene.a.id, b: scene.b.id, place: scene.set_place ?? scene.place }, price);
    if (!r.ok) {
      if (price > 0) await refundAdTokens(db, admin, price);
      return json({ error: "not_pictured", message: r.message }, r.status);
    }
    return json({ scene: (await openScene(db, admin, input.a, input.b)) ?? scene, beat: r.beat });
  }
  if (input.beat || input.picture_now) {
    // Drawing one now (a beat's "now", or Picture this) is a picture: the regional rule first. "Later" draws nothing.
    if (input.picture_now || input.beat?.answer === "now") {
      const refused = await mediaRefusal(db, admin);
      if (refused) return refused;
    }
    const scene = await openScene(db, admin, input.a, input.b);
    if (!scene) return hidden();
    const r = input.beat
      ? await answerBeat(db, admin, input.beat.id, input.beat.answer, requestBase(req), { custom: input.beat.custom, dialog: input.beat.dialog, edit: input.beat.edit })
      : await pictureNow(db, admin, { ...scene, a: scene.a.id, b: scene.b.id, place: scene.set_place ?? scene.place }, input.picture_now!.line, requestBase(req), { custom: input.picture_now!.custom, dialog: input.picture_now!.dialog, edit: input.picture_now!.edit });
    if (!r.ok) return json({ error: "not_pictured", message: r.message }, r.status);
    // The scene again, with the beat's new status; the picture lands in the gallery a little later.
    return json({ scene: (await openScene(db, admin, input.a, input.b)) ?? scene, beat: r.beat });
  }
  if (input.forget_whisper) {
    const scene = await forgetWhisper(db, admin, input.a, input.b, input.forget_whisper);
    return scene ? json({ scene }) : hidden();
  }
  // A step that starts a chapter pays for it (a redo rewrites a step already paid for).
  const pay = input.redo ? { paid: 0 } : await payChapter(db, admin, input.a, input.b);
  if (pay instanceof Response) return pay;
  const r = input.redo
    ? await redoScene(db, admin, input.a, input.b)
    : await continueScene(db, admin, input.a, input.b, input.direction ?? null, input.steer_mode ?? "nudge", { whisper: input.whisper ?? null });
  if (!r.ok && pay.paid) await refundAdTokens(db, admin, pay.paid);
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
    // #1053: who wrote the step, when it wasn't their own writer (the fallback, or the fast one's opening).
    ...(r.writer_note ? { writer_note: r.writer_note } : {}),
    // #1136: a steer its lines followed only partly, for the page's "Steer again?".
    ...(r.steer_unfollowed ? { steer_unfollowed: r.steer_unfollowed } : {}),
    // A redo can take back a chapter's close, so its night list may have changed.
    ...(input.redo ? { nights: await listNights(db, admin, input.a, input.b) } : {}),
  });
}));

/** How often a kept answer sends a byte while its write runs: well inside the edge's 100 seconds of silence. */
const KEPT_EVERY_MS = 15_000;

/**
 * One move in the pair's scene. A step's lines can take minutes on the richer writer, and the host's edge ends a
 * response that sends nothing for 100 seconds (docs/hosting.md): the page then got no answer, while the write went on
 * behind it (David, 2026-11-24: "times out and only after you refresh page you see the writing"). So the theater asks
 * for a write's answer to be kept alive (KEPT_ANSWER_HEADER, lib/adult/write-watch.ts): the same work, answered as a
 * stream that sends a newline now and then (lib/http.ts jsonWhenDone) and ends with `{ kept, status, body }`, the
 * status and JSON it would have had. The stream itself is a 200 from its first byte, so the real status is inside.
 * Every other caller (the admin MCP, scripts, tests) gets the plain answer, unchanged, and so does anyone After Dark
 * isn't open to.
 */
export const POST = async (req: Request): Promise<Response> => {
  if (req.headers.get(KEPT_ANSWER_HEADER) !== KEPT_ANSWER) return act(req);
  // Only for someone After Dark is open to: anyone else gets the plain not-found, never a stream that says there's
  // something here.
  if (!(await adultViewer(await getDb(), req).catch(() => null))) return act(req);
  return jsonWhenDone(
    req,
    async (): Promise<KeptAnswer> => {
      const res = await act(req);
      const body = (await res.json().catch(() => ({}))) as unknown;
      return { kept: true, status: res.status, body: body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {} };
    },
    KEPT_EVERY_MS,
  );
};
