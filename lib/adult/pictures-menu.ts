/**
 * Picture shot menus (David, 2026-10-22, from the competitor analysis): a picture of BOTH of them, composed from four
 * choices: the act (lib/adult/acts.ts), what they wear (by how far the night has gone), the framing (wide, medium or
 * close) and the place (where they are now, or anywhere the night has been). It's drawn by the keyframe pipeline
 * (lib/adult/reels.ts): their two baselines, plus the place's drawn set when there's one, made into one picture by the
 * multi-image edit (Venice's qwen-edit-uncensored, or Replicate's Qwen-Image-Edit), checked by Hive (moderation and the
 * age question) before anything is kept, and stored in the pair's gallery as a scene picture.
 *
 * Held like a clip (lib/adult/clips.ts): nothing the night hasn't reached, nothing past kissing (or out of their
 * clothes) somewhere public, nothing past the pair's limits, David's lines on every word. It counts against the month's
 * pictures (lib/adult/usage.ts) and costs menu_picture_tokens bought tokens (1 by default), admins free; a picture the
 * check refuses, or a provider failure, gives the token back and isn't counted. While Hive is over its daily limit
 * (lib/adult/hive-limit.ts) nothing is drawn or spent.
 */
import { picturesBlocked } from "./readiness";
import { isAdmin } from "../admins";
import { refundBoughtTokens, spendBoughtTokens } from "../allowance";
import { loadCharacter, type Character } from "../character";
import type { Db } from "../db";
import { keepBytes } from "../object-store";
import { checkAdultText } from "../safety";
import { actById, actFor, actLocked, actMenu, actRuledOut, crossesTaboo, FRAMING_WORDS, FRAMINGS, povFor, type Eyes, type Framing, type MediaLimits, type MenuAct } from "./acts";
import { fallbackNote, runMedia } from "./fallback";
import { hivePausedErrorMessage, hivePausedMessage, HivePausedError } from "./hive-limit";
import { checkMedia, checkReady, mediaGate } from "./moderation";
import { mediaLimits, nightStands } from "./clips";
import { isPublicPlace } from "./continuity";
import { ensureBaseline, signedMediaUrl, type Media } from "./media";
import { shownNude } from "./attire";
import { baselines, drawKeyframe, drawReplicateKeyframe, KEYFRAME_MODEL, keyframePrompt, NUDE_FROM, nudeBaselines, placeWords, povPrompt, reelCast, reelNight, replicateSetImage, setPictures, type ReelPerson } from "./reels";
import { framingScores } from "./framing";
import { levelForStage, tagOnCreate } from "./media-tags";
import { NO_STEERING, steeringFor } from "./steering";
import { eligiblePair } from "./scenes";
import { adultKeys, getAdultSettings, type MediaProvider } from "./settings";
import { requestJson, withRequestLog } from "./request-log";
import { STAGES } from "./stages";
import { countUse, overCap, usageLeft } from "./usage";

const UNDRESSING = STAGES.indexOf("undressing");
const LAST = STAGES.length - 1;

/** What they wear in a picture: offered once the night has got this far (`minStage`), and how undressed that is (`dress`). */
export type Outfit = { id: string; label: string; minStage: number; dress: number; words: string };

/** The outfits, dressed first. Past dressed, somewhere private only. */
export const OUTFITS: readonly Outfit[] = [
  { id: "tonight", label: "As they are tonight", minStage: 0, dress: 0, words: "both fully clothed, in what they're wearing tonight, shirts and tops on and done up" },
  { id: "dressed_up", label: "Dressed up", minStage: 0, dress: 0, words: "both dressed up for a night out in smart evening clothes, fully clothed" },
  { id: "casual", label: "Casual", minStage: 0, dress: 0, words: "both in relaxed, casual clothes, fully clothed" },
  { id: "underwear", label: "Underwear", minStage: UNDRESSING, dress: UNDRESSING, words: "both down to their underwear" },
  { id: "half", label: "Half undressed", minStage: UNDRESSING, dress: UNDRESSING, words: "both half undressed, their clothes half off or pushed aside" },
  { id: "sheet", label: "Under a sheet", minStage: LAST, dress: LAST, words: "both nude under a white bedsheet that covers them from the waist down" },
  { id: "nude", label: "Nude", minStage: LAST, dress: LAST, words: "both nude" },
];
export const outfitById = (id: string): Outfit | null => OUTFITS.find((o) => o.id === id) ?? null;

export const FRAMING_LABEL: Record<Framing, string> = { wide: "Wide: all of them and the room", medium: "Medium: from the thighs up", close: "Close: their faces" };

/**
 * What's asked for: the act (who leads swapped, or not), what they wear, the framing, and the place (one of the menu's);
 * or seen through one of their eyes (`eyes`, the act's first-person view, which frames itself).
 */
export type PictureChoice = { act: string; swap?: boolean; outfit: string; framing: Framing; place: string; eyes?: Eyes | null };

/** A place the menu offers: where they are now, or somewhere the night has been, and whether it's public. */
export type PicturePlace = { place: string; now: boolean; public: boolean; home: "a" | "b" | null };

/** The places a picture can be in: where they are now, then the rest of the night's stops, newest first, each once. */
export function picturePlaces(where: { place: string | null; set: string | null; history: readonly { place: string; set: string | null; home: "a" | "b" | null }[] }): PicturePlace[] {
  const out: PicturePlace[] = [];
  const seen = new Set<string>();
  const add = (label: string | null | undefined, home: "a" | "b" | null, now: boolean) => {
    const place = (label ?? "").trim();
    const key = place.toLowerCase().replace(/[’']/g, "");
    if (!place || seen.has(key) || out.length >= 6) return;
    seen.add(key);
    out.push({ place, now, public: isPublicPlace(place, home), home });
  };
  add(where.set ?? where.place, where.history.at(-1)?.home ?? null, true);
  for (const stop of [...where.history].reverse()) add(stop.set ?? stop.place, stop.home, false);
  return out;
}

/** One outfit as the menu shows it: offered now, or locked and why. */
export type MenuOutfit = { id: string; label: string; minStage: number; private: boolean; available: boolean; why: string | null };

/** The menu for a pair's picture (the API's GET): the price, what's left this month, and the four choices. */
export type PictureMenu = {
  price: number;
  /** Pictures left this month; null for an admin (never capped). */
  left: number | null;
  /** The acts their limits allow, each with the outfits it can have. */
  acts: (MenuAct & { outfits: readonly string[] })[];
  /** The outfits their limits allow: offered by how far the night has gone (an act or a place may narrow them). */
  outfits: MenuOutfit[];
  framings: { id: Framing; label: string }[];
  places: PicturePlace[];
};

/** Whether an outfit is out for this pair altogether: past the intensity, or its words cross a hard no. */
const outfitRuledOut = (o: Outfit, limits: MediaLimits) => o.minStage > limits.maxStage || limits.hit(o.words) !== null;

export async function pictureMenu(db: Db, ownerId: string, x: string, y: string): Promise<PictureMenu | null> {
  const pair = await eligiblePair(db, ownerId, x, y);
  const night = pair ? await reelNight(db, ownerId, ...pair) : null;
  if (!pair || !night) return null;
  const [ca, cb] = await Promise.all([loadCharacter(db, pair[0]), loadCharacter(db, pair[1])]);
  if (!ca || !cb) return null;
  const cast = reelCast(ca, cb, ownerId);
  const limits = await mediaLimits(db, ownerId, ...pair);
  const stands = nightStands(night.where);
  const price = (await isAdmin(db, ownerId)) ? 0 : (await getAdultSettings(db)).menu_picture_tokens;
  return {
    price,
    left: await usageLeft(db, ownerId, "pictures"),
    // Each act as the night stands; a place picked on the menu can still lock one (somewhere public).
    // With how well each framing does for them (lib/adult/framing.ts): badges, and what works first.
    acts: actMenu({ stage: stands.stage, publicPlace: false }, cast, [ca.name, cb.name], limits, await framingScores(db, ownerId)).map((a) => ({
      ...a,
      outfits: actById(a.id)!.outfits.filter((id) => OUTFITS.some((o) => o.id === id && !outfitRuledOut(o, limits))),
    })),
    outfits: OUTFITS.filter((o) => !outfitRuledOut(o, limits)).map((o) => ({
      id: o.id,
      label: o.label,
      minStage: o.minStage,
      private: o.dress >= UNDRESSING,
      available: o.minStage <= stands.stage,
      why: o.minStage <= stands.stage ? null : `Once they've got to ${STAGES[o.minStage]}`,
    })),
    framings: FRAMINGS.map((id) => ({ id, label: FRAMING_LABEL[id] })),
    places: picturePlaces(night.where),
  };
}

/**
 * A picture's plan: its keyframe prompt (with the place's drawn set as the last picture, or without), the place, how far
 * it goes, the act, and whose eyes it's seen through (then only the other one's face goes in).
 */
type PicturePlan = { promptFor: (withSet: boolean) => string; place: string; stage: number; act?: string; eyes?: Eyes };

/**
 * Whether these choices can be a picture of the pair's night as it stands: the act and the outfit reached and inside
 * the limits, the outfit one the act can have, the place one of the night's (and private, past kissing or out of their
 * clothes), every word within David's lines. The plan, or why not.
 */
export function planPicture(
  choice: PictureChoice,
  ctx: {
    cast: readonly [ReelPerson, ReelPerson];
    stage: number;
    places: readonly PicturePlace[];
    limits: MediaLimits;
    light?: string;
    custom?: string;
    /** The owner's words on single sections, already one line (studio-catalog.ts pairExtraWords). */
    extra?: string;
    dialog?: string;
    /** Drawn like a picture they already have (Picture 3: its pose, framing and place). */
    reference?: boolean;
    /** What the viewer's ratings of the two of them steer toward (lib/adult/steering.ts), in the picture's words. */
    steer?: string;
  },
): { ok: true; plan: PicturePlan } | { ok: false; status: number; error: string; message: string } {
  const no = (error: string, message: string, status = 422) => ({ ok: false as const, status, error, message });
  const act = actById(choice.act);
  if (!act) return no("unknown_act", "That act isn't on the menu.");
  const outfit = outfitById(choice.outfit);
  if (!outfit) return no("unknown_outfit", "That outfit isn't on the menu.");
  if (!FRAMINGS.includes(choice.framing)) return no("unknown_framing", "Wide, medium or close.");
  const where = ctx.places.find((p) => p.place === choice.place);
  if (!where) return no("unknown_place", "Pick a place the night has been.");
  if (actRuledOut(act, ctx.cast, ctx.limits) || outfitRuledOut(outfit, ctx.limits)) return no("not_allowed", "That's past the limits you've set for these two.");
  const locked = actLocked(act, { stage: ctx.stage, publicPlace: where.public });
  if (locked) return no("not_yet", `${act.label}: ${locked[0].toLowerCase()}${locked.slice(1)}.`);
  if (outfit.minStage > ctx.stage) return no("not_yet", `${outfit.label}: once they've got to ${STAGES[outfit.minStage]}.`);
  if (where.public && outfit.dress >= UNDRESSING) return no("not_yet", `${outfit.label}: somewhere private first.`);
  if (!act.outfits.includes(outfit.id)) return no("not_with_act", `${act.label} doesn't go with "${outfit.label.toLowerCase()}".`);
  const filled = actFor(act, ctx.cast, choice.swap === true);
  const stage = Math.max(act.dress, outfit.dress);
  // Seen through one of their eyes: the act's first-person still (it frames itself), only the other one's face in.
  const pov = choice.eyes ? povFor(act, ctx.cast, choice.eyes, choice.swap === true) : null;
  if (choice.eyes && !pov) return no("no_view", `${act.label} has no view through those eyes.`);
  if (pov && ctx.reference) return no("no_view", "A picture drawn like another keeps both of them in frame.");
  const frame = pov ? pov.still : `${filled.pose} ${FRAMING_WORDS[choice.framing]}`;
  const opts = { explicit: ctx.limits.explicit, clothes: outfit.words, light: ctx.light, custom: ctx.custom, extra: ctx.extra, dialog: ctx.dialog, steer: ctx.steer };
  const prompt = (withSet: boolean) =>
    pov && choice.eyes
      ? povPrompt(ctx.cast as [ReelPerson, ReelPerson], choice.eyes, frame, placeWords(where.place, ctx.cast), stage, withSet, opts)
      : keyframePrompt(ctx.cast as [ReelPerson, ReelPerson], frame, placeWords(where.place, ctx.cast), stage, withSet, { ...opts, reference: ctx.reference });
  // Every word the choices put in front of a picture model, the owner's own (custom, extra, dialog) included, held to David's
  // lines (the menu's words were written to them; this is the backstop). Not the prompt's own fixed words: "Make one
  // photograph" reads to the age check as "make [her] one", and it's right to be that strict.
  const words = `${frame} ${outfit.words} ${placeWords(where.place, ctx.cast)} ${ctx.light ?? ""} ${ctx.custom ?? ""} ${ctx.extra ?? ""} ${ctx.dialog ?? ""}`;
  if (!checkAdultText({ words }).ok || crossesTaboo(words) || ctx.limits.hit(words)) return no("not_allowed", "That picture crosses one of the lines After Dark never crosses.");
  return { ok: true, plan: { promptFor: prompt, place: where.place, stage, act: act.id, ...(pov && choice.eyes ? { eyes: choice.eyes } : {}) } };
}

export type MenuPictureResult = { ok: true; picture: Media } | { ok: false; status: number; error: string; message: string };

/**
 * Makes a picture from the menu: plans it (nothing spent on a refusal), checks the month's pictures, spends the price
 * (admins free), draws it from both baselines (and the place's set), checks it with Hive before anything is kept, and
 * stores it in the pair's gallery. A refusal by the check, or a provider failure, gives the tokens back.
 */
export async function makeMenuPicture(db: Db, ownerId: string, x: string, y: string, choice: PictureChoice, baseUrl: string): Promise<MenuPictureResult> {
  const pair = await eligiblePair(db, ownerId, x, y);
  const night = pair ? await reelNight(db, ownerId, ...pair) : null;
  if (!pair || !night) return { ok: false, status: 404, error: "not_found", message: "Pick two characters who are in after dark." };
  const [a, b] = pair;
  // Never a picture of a character nobody has set up (lib/adult/readiness.ts).
  const notReady = await picturesBlocked(db, ownerId, a, b);
  if (notReady) return { ok: false, status: 409, error: "not_ready", message: notReady };
  const settings = await getAdultSettings(db);
  const keys = await adultKeys(db);
  const onReplicate = settings.media_provider === "replicate";
  if (!(onReplicate ? keys.replicate : keys.venice) || !(await checkReady(db))) {
    return { ok: false, status: 409, error: "not_set_up", message: `Pictures need the ${onReplicate ? "Replicate" : "Venice"} and Hive keys in After Dark's settings.` };
  }
  const [ca, cb] = await Promise.all([loadCharacter(db, a), loadCharacter(db, b)]);
  if (!ca || !cb) return { ok: false, status: 404, error: "not_found", message: "Pick two characters who are in after dark." };
  const cast = reelCast(ca, cb, ownerId);
  const limits = await mediaLimits(db, ownerId, a, b);
  // Their ratings of the two of them steer this one too (lib/adult/steering.ts): the fixes, in the picture's words.
  const steer = (await steeringFor(db, ownerId, [a, b]).catch(() => NO_STEERING)).positive.join(", ");
  const planned = planPicture(choice, { cast, stage: nightStands(night.where).stage, places: picturePlaces(night.where), limits, steer });
  if (!planned.ok) return planned;
  const { plan } = planned;
  const reject = (reason: string) =>
    db.query(`insert into adult_rejections (id, owner_id, kind, reason) values ($1, $2, 'scene', $3)`, [crypto.randomUUID(), ownerId, `menu picture: ${reason}`.slice(0, 300)]).catch(() => {});
  // Hive over its daily limit (lib/adult/hive-limit.ts): refused before anything is drawn or spent (an admin's own go to
  // the alternative checker, lib/adult/moderation.ts admin_checker).
  const gate = await mediaGate(db, { owner: ownerId });
  if (!gate.ok) {
    await reject(gate.reason);
    return { ok: false, status: 503, error: "hive_paused", message: gate.message };
  }
  const capped = await overCap(db, ownerId, "pictures");
  if (capped) return { ok: false, status: 429, error: "over_cap", message: capped };
  const pays = !(await isAdmin(db, ownerId));
  const price = settings.menu_picture_tokens;
  if (pays && price > 0 && !(await spendBoughtTokens(db, ownerId, price))) {
    return { ok: false, status: 402, error: "needs_tokens", message: `A picture from the menu costs ${price} token${price === 1 ? "" : "s"}. Get more on the shop page.` };
  }
  const giveBack = async () => {
    if (pays && price > 0) await refundBoughtTokens(db, ownerId, price);
  };
  const tokensBack = pays && price > 0 ? ` Your token${price === 1 ? " is" : "s are"} back.` : "";
  const kept = await keepPictureOfBoth(db, ownerId, [ca, cb], plan, { keys, settings, baseUrl, reject });
  if (!kept.ok) {
    await giveBack();
    if (kept.error === "hive_paused" && kept.pausedErr) return { ok: false, status: 503, error: "hive_paused", message: hivePausedErrorMessage(kept.pausedErr, pays && price > 0) };
    return { ok: false, status: kept.status, error: kept.error, message: `${kept.message}${tokensBack}` };
  }
  return { ok: true, picture: kept.picture };
}

/** Why a picture of both wasn't kept; `pausedErr` when a baseline made first found Hive out. */
/** From "undressing" (stage 4 of 5) on, a night's picture starts from their body references. */
const BODY_FROM = 3;
/** Each one's body reference set in the Studio (adult_identity.body_image_id, ready), and whether it shows them nude; or null. */
async function bodyReferences(db: Db, ownerId: string, ids: readonly [string, string]): Promise<[BodyReference | null, BodyReference | null]> {
  const { rows } = await db.query<{ character_id: string; id: string }>(
    `select d.character_id, i.id from adult_identity d join adult_images i on i.id = d.body_image_id and i.status = 'ready' where d.owner_id = $1 and d.character_id = any($2)`,
    [ownerId, [...ids]],
  );
  const of = async (c: string): Promise<BodyReference | null> => {
    const id = rows.find((r) => r.character_id === c)?.id;
    return id ? { id, nude: await shownNude(db, id) } : null;
  };
  return [await of(ids[0]), await of(ids[1])];
}
type BodyReference = { id: string; nude: boolean };

export type KeepFailure = { ok: false; status: number; error: "hive_paused" | "check_busy" | "discarded" | "not_made"; message: string; pausedErr?: HivePausedError };

/**
 * A picture of both of them, drawn and kept: their two baselines (made first if they have none) and the place's drawn
 * set when there is one, made into one picture by the multi-image edit on the configured provider (the other when it's
 * limited), checked by Hive (moderation and the age question) before anything is kept, then stored in the pair's
 * gallery as a scene picture and counted for the month. The caller has already held it to the lines and limits, checked
 * the gate and the cap, and taken any price. Menu pictures and beat pictures (lib/adult/beats.ts) both come through here.
 */
export async function keepPictureOfBoth(
  db: Db,
  ownerId: string,
  [ca, cb]: [Character, Character],
  plan: { promptFor: (withSet: boolean) => string; place: string | null; stage?: number; act?: string; eyes?: Eyes },
  ctx: {
    keys: Awaited<ReturnType<typeof adultKeys>>;
    settings: Awaited<ReturnType<typeof getAdultSettings>>;
    baseUrl: string;
    reject: (reason: string) => Promise<unknown>;
    scene?: { chapter: number; place: string | null };
  },
): Promise<{ ok: true; picture: Media } | KeepFailure> {
  const { keys, settings, baseUrl, reject } = ctx;
  let file: { bytes: Buffer; mime: string };
  let made: { provider: MediaProvider; fell_back: boolean };
  let prompt = plan.promptFor(false);
  let sent: string | null = null;
  try {
    for (const c of [ca, cb]) await ensureBaseline(db, ownerId, c);
    // At sex (NUDE_FROM), from their nude baselines: an edit keeps what the pictures it starts from wear (lib/adult/attire.ts).
    const nude = (plan.stage ?? 0) >= NUDE_FROM ? await nudeBaselines(db, ownerId, ca, cb, baseUrl) : null;
    const bases = nude ?? (await baselines(db, ca.id, cb.id, ownerId));
    if (!bases) throw new Error("a picture of each of them is needed first");
    // A night's picture from undressing on: each one's body reference from the Studio, head to toe, when they have one
    // (David, 2026-10-25: their face and body set up first, so the date's pictures aren't guesses); the face otherwise.
    // From sex on, only a body reference that's itself nude: an edit keeps what its pictures wear, whatever the prompt
    // says, so a dressed one gives way to the nude baseline.
    const bodies = ctx.scene && (plan.stage ?? 0) >= BODY_FROM ? await bodyReferences(db, ownerId, [ca.id, cb.id]) : [null, null];
    const usable = bodies.map((r) => (r && (r.nude || (plan.stage ?? 0) < NUDE_FROM) ? r.id : null));
    const both = bases.map((id, i) => signedMediaUrl(usable[i] ?? id, baseUrl));
    // Seen through one of their eyes: only the other one's face (one face to keep, nothing to blend).
    const faces = plan.eyes ? [both[plan.eyes === "a" ? 1 : 0]] : both;
    const set = plan.place ? ((await setPictures(db, [plan.place])).get(plan.place) ?? null) : null;
    // With the place's drawn set as Picture 3, the prompt says to keep its room and its light.
    prompt = plan.promptFor(Boolean(set));
    // One picture, one job: drawn on the other provider when the configured one is limited (lib/adult/fallback.ts).
    // What it sent is kept with it (lib/adult/request-log.ts): both providers' when it fell back.
    const logged = await withRequestLog(() => runMedia(db, "keyframe", (p) => {
      if (p === "replicate") {
        const r = { token: keys.replicate!, keyframe: settings.replicate_keyframe_model, video: settings.replicate_video_model, videoLora: settings.replicate_video_lora };
        return drawReplicateKeyframe(r, prompt, set && plan.place ? [...faces, replicateSetImage(set, plan.place, baseUrl)] : faces);
      }
      return drawKeyframe(keys.venice!, prompt, set ? [...faces, set] : faces);
    }));
    sent = requestJson(logged.requests);
    const drawn = logged.value;
    file = drawn.value;
    made = { provider: drawn.provider, fell_back: drawn.fell_back };
  } catch (err) {
    // A baseline made first found Hive out (lib/adult/hive-limit.ts): the pause's own message.
    if (err instanceof HivePausedError) return { ok: false, status: 503, error: "hive_paused", message: err.message, pausedErr: err };
    return { ok: false, status: 502, error: "not_made", message: `The picture couldn't be made (${err instanceof Error ? err.message.slice(0, 160) : "error"}).` };
  }
  // The output check on the picture itself, before anything is kept, whoever made it: a refusal is discarded, never stored.
  const verdict = await checkMedia(db, { base64: file.bytes.toString("base64"), mime: file.mime }, "image", { owner: ownerId });
  if (!verdict.ok) {
    // Hive out of its daily allowance: discarded, logged, and the pause says until when.
    if (verdict.paused) {
      await reject(verdict.reason);
      return { ok: false, status: 503, error: "hive_paused", message: hivePausedMessage(verdict.paused, { discarded: true }) };
    }
    const busy = verdict.reason.startsWith("the check couldn't run");
    if (!busy) await reject(verdict.reason);
    return busy
      ? { ok: false, status: 503, error: "check_busy", message: "The safety check couldn't look at it just now, so it wasn't kept. Try again in a few minutes." }
      : { ok: false, status: 422, error: "discarded", message: `The safety check discarded that picture (${verdict.reason}).` };
  }
  const id = crypto.randomUUID();
  const kept = await keepBytes("after-dark", id, file.bytes, file.mime);
  await db.query(
    `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, object_key, status, provider, fell_back, scene_chapter, scene_place, model, request)
     values ($1, $2, $3, $4, 'scene', $5, $6, $7, $8, 'ready', $9, $10, $11, $12, $13, $14::jsonb)`,
    [
      id, ownerId, ca.id, cb.id, prompt.slice(0, 2000), file.mime, kept.data, kept.object_key, made.provider, made.fell_back, ctx.scene?.chapter ?? null, ctx.scene?.place ?? null,
      made.provider === "replicate" ? settings.replicate_keyframe_model : KEYFRAME_MODEL,
      sent,
    ],
  );
  // What it shows, known now (lib/adult/media-tags.ts tagOnCreate; the framing scores read it), and how far it goes.
  await tagOnCreate(db, id, ownerId, { pair: true, act: plan.act ?? null, eyes: plan.eyes ?? null, stage: plan.stage ?? null }).catch(() => {});
  if (typeof plan.stage === "number") await db.query(`update adult_images set level = $2 where id = $1`, [id, levelForStage(plan.stage)]);
  await countUse(db, ownerId, "pictures");
  return {
    ok: true,
    picture: {
      id, character_id: ca.id, character_b: cb.id, kind: "scene", status: "ready", created_at: new Date().toISOString(), mime: file.mime, clip: false,
      provider: made.provider, fell_back: made.fell_back, note: fallbackNote(made.provider, made.fell_back),
    },
  };
}
