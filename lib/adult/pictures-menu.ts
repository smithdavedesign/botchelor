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
import { isAdmin } from "../admins";
import { refundBoughtTokens, spendBoughtTokens } from "../allowance";
import { loadCharacter } from "../character";
import type { Db } from "../db";
import { keepBytes } from "../object-store";
import { checkAdultText } from "../safety";
import { actById, actFor, actLocked, actMenu, actRuledOut, crossesTaboo, FRAMING_WORDS, FRAMINGS, type Framing, type MediaLimits, type MenuAct } from "./acts";
import { checkOutput } from "./check";
import { fallbackNote, runMedia } from "./fallback";
import { hiveGate, hivePausedErrorMessage, hivePausedMessage, HivePausedError, underHiveLimit } from "./hive-limit";
import { mediaLimits, nightStands } from "./clips";
import { isPublicPlace } from "./continuity";
import { ensureBaseline, signedMediaUrl, type Media } from "./media";
import { baselines, drawKeyframe, drawReplicateKeyframe, keyframePrompt, placeWords, reelCast, reelNight, replicateSetImage, setPictures, type ReelPerson } from "./reels";
import { eligiblePair } from "./scenes";
import { adultKeys, getAdultSettings, type MediaProvider } from "./settings";
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

const FRAMING_LABEL: Record<Framing, string> = { wide: "Wide: all of them and the room", medium: "Medium: from the thighs up", close: "Close: their faces" };

/** What's asked for: the act (who leads swapped, or not), what they wear, the framing, and the place (one of the menu's). */
export type PictureChoice = { act: string; swap?: boolean; outfit: string; framing: Framing; place: string };

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
    acts: actMenu({ stage: stands.stage, publicPlace: false }, cast, [ca.name, cb.name], limits).map((a) => ({ ...a, outfits: actById(a.id)!.outfits.filter((id) => OUTFITS.some((o) => o.id === id && !outfitRuledOut(o, limits))) })),
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

/** A picture's plan: its keyframe prompt (with the place's drawn set as Picture 3, or without), the place, how far it goes. */
type PicturePlan = { promptFor: (withSet: boolean) => string; place: string; stage: number };

/**
 * Whether these choices can be a picture of the pair's night as it stands: the act and the outfit reached and inside
 * the limits, the outfit one the act can have, the place one of the night's (and private, past kissing or out of their
 * clothes), every word within David's lines. The plan, or why not.
 */
export function planPicture(
  choice: PictureChoice,
  ctx: { cast: readonly [ReelPerson, ReelPerson]; stage: number; places: readonly PicturePlace[]; limits: MediaLimits },
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
  const frame = `${filled.pose} ${FRAMING_WORDS[choice.framing]}`;
  const prompt = (withSet: boolean) =>
    keyframePrompt(ctx.cast as [ReelPerson, ReelPerson], frame, placeWords(where.place, ctx.cast), stage, withSet, { explicit: ctx.limits.explicit, clothes: outfit.words });
  // Every word the choices put in front of a picture model, held to David's lines (the menu's words were written to
  // them; this is the backstop). Not the prompt's own fixed words: "Make one photograph" reads to the age check as
  // "make [her] one", and it's right to be that strict.
  const words = `${frame} ${outfit.words} ${placeWords(where.place, ctx.cast)}`;
  if (!checkAdultText({ words }).ok || crossesTaboo(words) || ctx.limits.hit(words)) return no("not_allowed", "That picture crosses one of the lines After Dark never crosses.");
  return { ok: true, plan: { promptFor: prompt, place: where.place, stage } };
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
  const settings = await getAdultSettings(db);
  const keys = await adultKeys(db);
  const onReplicate = settings.media_provider === "replicate";
  if (!(onReplicate ? keys.replicate : keys.venice) || !keys.hive) {
    return { ok: false, status: 409, error: "not_set_up", message: `Pictures need the ${onReplicate ? "Replicate" : "Venice"} and Hive keys in After Dark's settings.` };
  }
  const [ca, cb] = await Promise.all([loadCharacter(db, a), loadCharacter(db, b)]);
  if (!ca || !cb) return { ok: false, status: 404, error: "not_found", message: "Pick two characters who are in after dark." };
  const cast = reelCast(ca, cb, ownerId);
  const limits = await mediaLimits(db, ownerId, a, b);
  const planned = planPicture(choice, { cast, stage: nightStands(night.where).stage, places: picturePlaces(night.where), limits });
  if (!planned.ok) return planned;
  const { plan } = planned;
  const reject = (reason: string) =>
    db.query(`insert into adult_rejections (id, owner_id, kind, reason) values ($1, $2, 'scene', $3)`, [crypto.randomUUID(), ownerId, `menu picture: ${reason}`.slice(0, 300)]).catch(() => {});
  // Hive over its daily limit (lib/adult/hive-limit.ts): refused before anything is drawn or spent.
  const gate = await hiveGate(db, keys.hive);
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
  let file: { bytes: Buffer; mime: string };
  let made: { provider: MediaProvider; fell_back: boolean };
  let prompt = plan.promptFor(false);
  try {
    for (const c of [ca, cb]) await ensureBaseline(db, ownerId, c);
    const bases = await baselines(db, a, b);
    if (!bases) throw new Error("a picture of each of them is needed first");
    const faces = bases.map((id) => signedMediaUrl(id, baseUrl));
    const set = (await setPictures(db, [plan.place])).get(plan.place) ?? null;
    // With the place's drawn set as Picture 3, the prompt says to keep its room and its light.
    prompt = plan.promptFor(Boolean(set));
    // One picture, one job: drawn on the other provider when the configured one is limited (lib/adult/fallback.ts).
    const drawn = await runMedia(db, "keyframe", (p) => {
      if (p === "replicate") {
        const r = { token: keys.replicate!, keyframe: settings.replicate_keyframe_model, video: settings.replicate_video_model, videoLora: settings.replicate_video_lora };
        return drawReplicateKeyframe(r, prompt, set ? [...faces, replicateSetImage(set, plan.place, baseUrl)] : faces);
      }
      return drawKeyframe(keys.venice!, prompt, set ? [...faces, set] : faces);
    });
    file = drawn.value;
    made = { provider: drawn.provider, fell_back: drawn.fell_back };
  } catch (err) {
    await giveBack();
    // A baseline made first found Hive out (lib/adult/hive-limit.ts): the pause's own message.
    if (err instanceof HivePausedError) return { ok: false, status: 503, error: "hive_paused", message: hivePausedErrorMessage(err, pays && price > 0) };
    return { ok: false, status: 502, error: "not_made", message: `The picture couldn't be made (${err instanceof Error ? err.message.slice(0, 160) : "error"}).${tokensBack}` };
  }
  // The output check on the picture itself, before anything is kept, whoever made it: a refusal is discarded, never stored.
  const verdict = await underHiveLimit(db, () => checkOutput(keys.hive, { base64: file.bytes.toString("base64"), mime: file.mime }, "image"));
  if (!verdict.ok) {
    await giveBack();
    // Hive out of its daily allowance: discarded, logged, and the pause says until when.
    if (verdict.paused) {
      await reject(verdict.reason);
      return { ok: false, status: 503, error: "hive_paused", message: `${hivePausedMessage(verdict.paused, { discarded: true })}${tokensBack}` };
    }
    const busy = verdict.reason.startsWith("the check couldn't run");
    if (!busy) await reject(verdict.reason);
    return busy
      ? { ok: false, status: 503, error: "check_busy", message: `The safety check couldn't look at it just now, so it wasn't kept. Try again in a few minutes.${tokensBack}` }
      : { ok: false, status: 422, error: "discarded", message: `The safety check discarded that picture (${verdict.reason}).${tokensBack}` };
  }
  const id = crypto.randomUUID();
  const kept = await keepBytes("after-dark", id, file.bytes, file.mime);
  await db.query(
    `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, object_key, status, provider, fell_back) values ($1, $2, $3, $4, 'scene', $5, $6, $7, $8, 'ready', $9, $10)`,
    [id, ownerId, a, b, prompt.slice(0, 2000), file.mime, kept.data, kept.object_key, made.provider, made.fell_back],
  );
  await countUse(db, ownerId, "pictures");
  return {
    ok: true,
    picture: {
      id, character_id: a, character_b: b, kind: "scene", status: "ready", created_at: new Date().toISOString(), mime: file.mime, clip: false,
      provider: made.provider, fell_back: made.fell_back, note: fallbackNote(made.provider, made.fell_back),
    },
  };
}
