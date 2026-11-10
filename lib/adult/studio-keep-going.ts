/**
 * Keep going for the Studio's animations (David, 2026-11-09: "take an existing clip … and continue it with a new prompt
 * … could even take a screenshot of the end of the video and send as context for next call"). The frame one of their
 * Studio animations ends on is cut first (the moments route, the one ffmpeg runs in: lib/adult/moments.ts momentFrame),
 * then animated on through Animate's own path and price (lib/adult/studio.ts animatePicture: Venice's video model, one
 * at a time, the month's clips, `animate_5` or `animate_10`, given back when it doesn't come through), with what happens
 * next in the owner's own words (Animate's guide: it leads the clip), what they say, and how the camera moves. Each link
 * names the one before (`choices.from`, its shoot; `choices.cut.video`, its video), so a chain plays as one film in the
 * Studio (lib/adult/studio-chains.ts), up to CHAIN_MAX links.
 *
 * Like a clip's chain (lib/adult/clips.ts): straight on from the cut frame (seamless) for SEAMLESS_RUN_MAX links in a
 * row at most, then from that very frame with their faces made fresh (Fix faces, lib/adult/fix-faces.ts fixFacePrompt:
 * the frame kept exactly as it is but for each face, made the face that person keeps), so a long chain can't drift from
 * them while the pose, the place and the light carry on. The fresh frame is asked the age question like any keyframe and
 * kept out of the gallery; every video is checked by Hive when it's collected (collectAnimations), like any animation.
 *
 * The owner's words are held, before anything is spent, to everything Animate's guide is (David's lines: the age words
 * and the taboos) and to the rest of what owner words are held to: the character's studio limits (their intensity and
 * hard nos) and, for two, the pair's; no further than the studio limit's level; and somewhere public, the place rules
 * (lib/adult/studio-catalog.ts planShoot, #1407): nude only with the place empty (nobody brought in, the place cleared in
 * the prompt, and the frame checked for anyone else, failing closed), nothing explicit; for two, nothing past kissing.
 * The page asks all that first, before it cuts the frame (keepAnimatingCheck), so a refusal comes at once and costs
 * nothing, not even one of the month's moments.
 */
import type { CameraMoveId } from "./camera-moves";
import { loadCharacter, type Character } from "../character";
import type { Db } from "../db";
import { fitRatio, imageSize } from "../media-tools/image";
import { dataColumn, keepBytes, readBytes } from "../object-store";
import { freshViews, identityPackOf } from "../studio/identity-pack";
import { pickView } from "../studio/identity-views";
import { askRatio, ratiosFor } from "../studio/formats";
import { CHAIN_MAX, NEXT_WORDS_MAX, SEAMLESS_RUN_MAX } from "./clip-chains";
import { shownStage } from "./clips";
import { fixFacePrompt } from "./fix-faces";
import { hivePausedMessage } from "./hive-limit";
import { hardNoHit, limitsHit } from "./limits";
import { signedMediaUrl } from "./media";
import { levelForStage } from "./media-tags";
import { aloneInPicture, checkMedia, mediaGate } from "./moderation";
import { busyMessage, busyReel, drawKeyframe, KEYFRAME_MODEL, queueVideo, reelCast } from "./reels";
import { requestJson, withRequestLog, type LoggedRequest } from "./request-log";
import { eligiblePair } from "./scenes";
import { adultKeys, getAdultSettings } from "./settings";
import { faceReferenceId } from "./steering";
import {
  ANIMATE_NEGATIVE,
  ANIMATE_NEGATIVE_PAIR,
  animatingNow,
  identityOf,
  nounOf,
  pairLimits,
  placeIsPublic,
  shootLimits,
  shootRow,
  studioAccess,
  subjectOf,
  wordsOk,
  type JobResult,
  type StudioFail,
} from "./studio";
import { animatePrompt, ANIMATE_SECONDS, cleanCustom, DIALOG_MAX, EMPTY_PLACE_NEGATIVE, LEVEL_LABEL, type AnimateSeconds, type Level } from "./studio-catalog";
import type { StudioConfig } from "./studio-config";
import { refundAdTokens, spendAdTokens } from "./tokens";
import { overCap } from "./usage";

const fail = (status: number, error: string, message: string): StudioFail => ({ ok: false, status, error, message });

/** What a link asks for: the video it carries on from, the frame cut from its end, and what happens next. */
export type KeepAnimatingInput = {
  video_id: string;
  frame_id: string;
  /** What happens next, in the owner's own words (NEXT_WORDS_MAX): it leads the clip, as Animate's guide does. */
  prompt?: string;
  dialog?: string;
  camera?: CameraMoveId | null;
  seconds: number;
  /** Straight on from the frame, or from it with their faces made fresh (every third link is, whatever's asked). */
  mode?: "seamless" | "fresh";
};

/** An animate shoot's choices, as far as a chain reads them (animatePicture's, and a link's own). */
type AnimateChoices = {
  source?: string;
  level?: number;
  from?: string;
  cut?: { video: string; frame: string; at: number; seamless: boolean };
  /** A link's own record of what it shows (copied down the chain from the picture it began with). */
  facts?: Facts;
};
/** What a chain shows, from the picture it began with: who's in it (in that picture's order), where, its shape and view. */
type Facts = { people: [string, string | null]; place: string | null; aspect: string | null; pov: string | null };

/** What a link's motion says: carry on from right here (and, with no words of the owner's to lead it, as they were). */
const carryOn = (two: boolean, led: boolean) =>
  `${two ? "carry" : "carries"} on from this very moment, in the same ${led ? "place" : "pose and place, moving on naturally from what they were doing"}`;

/** Their Studio animation of this character (a video an 'animate' shoot of theirs made), with its shoot. */
async function animationOf(db: Db, viewer: string, characterId: string, videoId: string): Promise<{ video: string; shoot: string; choices: AnimateChoices } | null> {
  const r = (
    await db.query<{ id: string; shoot: string; choices: AnimateChoices | null }>(
      `select v.id, s.id as shoot, s.choices from adult_images v join adult_studio_shoots s on s.id = v.shoot_id
        where v.id = $1 and v.owner_id = $2 and v.character_id = $3 and v.kind = 'video' and v.status = 'ready' and s.kind = 'animate' and s.owner_id = $2`,
      [videoId, viewer, characterId],
    )
  ).rows[0];
  return r ? { video: r.id, shoot: r.shoot, choices: r.choices ?? {} } : null;
}

/** A chain's shoots back from one (newest first): the link, the one it was kept going from, … the animation it began with. */
async function chainBack(db: Db, viewer: string, choices: AnimateChoices): Promise<AnimateChoices[]> {
  const out = [choices];
  for (let from = choices.from; from && out.length < CHAIN_MAX; ) {
    const up = (await db.query<{ choices: AnimateChoices | null }>(`select choices from adult_studio_shoots where id = $1 and owner_id = $2 and kind = 'animate'`, [from, viewer])).rows[0];
    if (!up) break;
    out.push(up.choices ?? {});
    from = up.choices?.from;
  }
  return out;
}

/** What the picture an animation began with shows (a link carries these on, so only the first link reads the picture). */
async function factsOf(db: Db, viewer: string, picture: string | undefined): Promise<Facts | null> {
  if (!picture) return null;
  const r = (
    await db.query<{ character_id: string | null; character_b: string | null; scene_place: string | null; aspect: string | null; pov: string | null }>(
      `select i.character_id, i.character_b, i.scene_place, i.aspect,
              (select t.value from adult_media_tags t where t.media_id = i.id and t.kind = 'pov' and not t.removed limit 1) as pov
         from adult_images i where i.id = $1 and (i.owner_id = $2 or exists (select 1 from admins a where a.user_id = $2))`,
      [picture, viewer],
    )
  ).rows[0];
  return r?.character_id ? { people: [r.character_id, r.character_b], place: r.scene_place, aspect: r.aspect, pov: r.pov } : null;
}

/** The face a fresh frame gives them (as Fix faces picks it, lib/adult/fix-faces.ts): the identity pack's view, their face anchor, or the face they keep. */
async function faceOf(db: Db, viewer: string, characterId: string): Promise<string | null> {
  const identity = await identityOf(db, viewer, characterId);
  const view = pickView(freshViews(await identityPackOf(db, viewer, characterId, "after_dark", identity.face)), "");
  return view?.id ?? identity.faceCrop ?? (await faceReferenceId(db, viewer, characterId));
}

/** Words that bring someone else into a place that has to stay empty: the "being watched" hard no, or anyone the empty place's prompt keeps out. */
const bringsSomeone = (words: string): boolean => hardNoHit(words, { chips: ["watched"], own: EMPTY_PLACE_NEGATIVE.split(/,\s*/) }) !== null;

/** What a link asks for before its frame is cut: everything but the frame (the page asks this first, keepAnimatingCheck). */
export type LinkAsk = Omit<KeepAnimatingInput, "frame_id">;

/** A link once everything it's held to before its frame is read or a token is spent has passed. */
type LinkPlan = {
  ok: true;
  c: Character;
  config: StudioConfig;
  admin: boolean;
  words: string | undefined;
  dialog: string | undefined;
  seconds: AnimateSeconds;
  prev: { video: string; shoot: string; choices: AnimateChoices };
  facts: Facts;
  pair: boolean;
  level: Level;
  /** Nude somewhere public: the place kept empty in the prompt, and the frame checked for anyone else. */
  empty: boolean;
  seamless: boolean;
  forcedFresh: boolean;
  /** From fresh faces: each face in the frame to draw fresh (its tag in the prompt), and the face each gets. */
  targets: { id: string; tag: string }[];
  faces: string[];
  venice: string;
};

/**
 * Everything a link is decided and refused on that doesn't need its frame: the words, the animation and its chain, the
 * level, the limits, the place, their faces when it starts fresh, and whether one can be made now. Nothing is spent.
 */
async function planLink(db: Db, viewer: string, characterId: string, input: LinkAsk): Promise<LinkPlan | StudioFail> {
  const access = await studioAccess(db, viewer, characterId);
  if (!access.ok) return access;
  const { character: c, config, admin } = access;
  const words = cleanCustom(input.prompt, NEXT_WORDS_MAX);
  const dialog = cleanCustom(input.dialog, DIALOG_MAX);
  // David's lines: the same check as Animate's guide and every owner's words in the Studio (the age words, the taboos).
  if (!wordsOk([words, dialog].filter(Boolean).join(" "))) return fail(422, "not_allowed", "Those words cross one of the lines After Dark never crosses.");
  if (!(ANIMATE_SECONDS as readonly number[]).includes(input.seconds)) return fail(422, "invalid", "5 or 10 seconds.");
  const seconds = input.seconds as AnimateSeconds;

  // The animation it carries on from, and its chain: room for one more, and how many links in a row ran seamless.
  const prev = await animationOf(db, viewer, c.id, input.video_id);
  if (!prev) return fail(404, "not_found", "Keep going carries on from one of your Studio animations of them.");
  const chain = await chainBack(db, viewer, prev.choices);
  if (chain.length >= CHAIN_MAX) return fail(409, "chain_full", `That animation has been kept going ${CHAIN_MAX - 1} times, as far as it goes. Start a new one.`);
  const run = chain.findIndex((x) => !x.cut?.seamless);
  const seamlessRun = run === -1 ? chain.length : run;
  // What it shows (who, where, its shape and view): a link carries it; an animation of a picture reads that picture.
  const facts = prev.choices.cut ? (prev.choices.facts ?? null) : await factsOf(db, viewer, prev.choices.source);
  if (!facts) return fail(409, "not_found", "The picture that animation began with isn't there any more, so it can't be kept going.");
  const partner = facts.people[0] === c.id ? facts.people[1] : facts.people[0];
  const pair = partner ? await eligiblePair(db, viewer, c.id, partner) : null;
  if (partner && !pair) return fail(404, "not_found", "The one they're with in it isn't in your After Dark any more.");

  // How far it goes: as far as the one before, or further when the words go further; never past their studio limit.
  const identity = await identityOf(db, viewer, c.id);
  const { maxLevel } = shootLimits(identity, config);
  const before = (typeof prev.choices.level === "number" && prev.choices.level >= 0 && prev.choices.level <= 3 ? prev.choices.level : 2) as Level;
  const stage = words ? shownStage(words) : 0;
  const level = Math.max(before, levelForStage(stage)) as Level;
  if (before > maxLevel) return fail(422, "locked", `That animation is past ${LEVEL_LABEL[maxLevel].toLowerCase()}: their studio limit.`);
  if (level > maxLevel) return fail(422, "locked", `Those words go past ${LEVEL_LABEL[maxLevel].toLowerCase()}: their studio limit.`);
  if (words) {
    // Their studio limits (the intensity and hard nos set for them here), and the pair's own for two.
    const hit = limitsHit(words, { intensity: identity.intensity, hard_nos: { chips: identity.hard_nos, own: [] } }) ?? (pair ? (await pairLimits(db, viewer, pair, config)).hit(words) : null);
    if (hit) return fail(422, "not_allowed", `That's past the limits you've set: ${hit}.`);
  }
  // Somewhere public (#1407): for one, nude only with the place empty, nothing explicit; for two, nothing past kissing.
  const inPublic = placeIsPublic(facts.place);
  if (inPublic && pair && level >= 2) return fail(422, "public", "Nothing past kissing somewhere public: that waits until they're somewhere private.");
  if (inPublic && level > 2) return fail(422, "public", "Nothing explicit somewhere public: that stays private.");
  const empty = inPublic && !pair && level >= 2;
  if (empty && words && bringsSomeone(words)) return fail(422, "public", "Nude somewhere public stays with the place empty: nobody else in it, and nobody watching.");

  const seamless = input.mode !== "fresh" && seamlessRun < SEAMLESS_RUN_MAX;
  const forcedFresh = input.mode !== "fresh" && !seamless;
  // From fresh faces: each face in the frame (seen through someone's eyes, only the other's), and the face each gets.
  const ids = facts.people.filter((x): x is string => Boolean(x));
  const people = seamless ? [] : (await Promise.all(ids.map((id) => loadCharacter(db, id)))).filter((x): x is Character => Boolean(x));
  if (!seamless && people.length !== ids.length) return fail(404, "not_found", "Their characters in it aren't there any more.");
  const shown = (i: number) => (facts.pov === "a" ? i === 1 : facts.pov === "b" ? i === 0 : true);
  const tags = people.length === 2 ? reelCast(people[0], people[1], viewer).map((p) => p.tag) : people.map((p) => `the ${nounOf(p)}`);
  const targets = people.map((p, i) => ({ id: p.id, tag: tags[i], i })).filter((t) => shown(t.i));
  const faces = await Promise.all(targets.map((t) => faceOf(db, viewer, t.id)));
  if (!seamless && (!targets.length || faces.some((f) => !f))) return fail(409, "no_face", "Each of them needs a face first: pick one in the Studio.");

  // Whether one can be made now: the key, Hive, one at a time, and the month's clips.
  const keys = await adultKeys(db);
  if (!keys.venice) return fail(409, "not_set_up", "Animating needs the Venice key in After Dark's settings.");
  const gate = await mediaGate(db, { video: true });
  if (!gate.ok) return fail(503, "hive_paused", gate.message);
  if (await animatingNow(db, viewer)) return fail(409, "busy", "One is already being animated: it takes a few minutes.");
  const busy = await busyReel(db, viewer);
  if (busy) return fail(409, "busy", busyMessage(busy));
  const capped = await overCap(db, viewer, "clips");
  if (capped) return fail(429, "over_cap", capped);
  return {
    ok: true, c, config, admin, words, dialog, seconds, prev, facts, pair: Boolean(pair), level, empty, seamless, forcedFresh,
    targets: targets.map(({ id, tag }) => ({ id, tag })), faces: faces.filter((f): f is string => Boolean(f)), venice: keys.venice,
  };
}

/**
 * Whether a link can be kept going, asked before its frame is cut (the page asks first): a refusal then costs nothing,
 * not even one of the month's moments, and comes at once. `fresh`: it'll start from their faces drawn fresh.
 */
export async function keepAnimatingCheck(db: Db, viewer: string, characterId: string, input: LinkAsk): Promise<{ ok: true; fresh: boolean } | StudioFail> {
  const plan = await planLink(db, viewer, characterId, input);
  return plan.ok ? { ok: true, fresh: !plan.seamless } : plan;
}

/**
 * Keep going from one of their Studio animations: everything decided and refused before a token is spent (planLink,
 * then the frame: cut from this very video and not used yet, and somewhere public, them alone in it), then the price,
 * then (every third link, or when asked) the fresh frame drawn and checked, then the video queued from the frame.
 * Collected as the page polls (collectAnimations).
 */
export async function keepAnimating(db: Db, viewer: string, characterId: string, input: KeepAnimatingInput, baseUrl: string): Promise<JobResult> {
  const plan = await planLink(db, viewer, characterId, input);
  if (!plan.ok) return plan;
  const { c, config, admin, words, dialog, seconds, prev, facts, pair, level, empty, seamless, forcedFresh, targets, faces, venice } = plan;

  // The frame it carries on from: cut from that very video by the moments route (and checked there), not used yet.
  const frame = (
    await db.query<{ id: string; moment_at: number | null; mime: string; data: Buffer | Uint8Array | null; object_key: string | null }>(
      `select f.id, f.moment_at, f.mime, ${dataColumn("f")}, f.object_key from adult_images f
        where f.id = $1 and f.owner_id = $2 and f.kind = 'frame' and f.status = 'ready' and f.source_image = $3
          and not exists (select 1 from adult_images v where v.source_image = f.id)
          and not exists (select 1 from adult_studio_shoots s where s.owner_id = $2 and s.kind = 'animate' and s.choices->'cut'->>'frame' = f.id)`,
      [input.frame_id, viewer, prev.video],
    )
  ).rows[0];
  if (!frame) return fail(404, "not_found", "That frame isn't one cut from this animation's end. Try Keep going again.");
  // Nude somewhere public: the frame it starts from shows them and nobody else (fails closed), checked before a token goes.
  const cutBytes = empty || !seamless ? await readBytes(frame).catch(() => null) : null;
  if ((empty || !seamless) && !cutBytes) return fail(404, "not_found", "That frame's file isn't there any more. Try Keep going again.");
  if (empty && cutBytes) {
    const alone = await aloneInPicture(db, { base64: cutBytes.toString("base64"), mime: frame.mime });
    if (alone !== true) return refusedPublic(db, viewer, alone);
  }

  const tokens = seconds === 10 ? config.prices.animate_10 : config.prices.animate_5;
  const pays = tokens > 0 && !admin;
  if (pays && !(await spendAdTokens(db, viewer, tokens))) return fail(402, "needs_tokens", `That costs ${tokens} token${tokens === 1 ? "" : "s"}. Get more on the tokens page.`);
  // Anything after this that doesn't come through gives the tokens back, and says so.
  const back = async (r: StudioFail): Promise<StudioFail> => {
    if (!pays) return r;
    await refundAdTokens(db, viewer, tokens);
    return /token/i.test(r.message) ? r : { ...r, message: `${r.message} Your tokens are back.` };
  };
  const model = config.animate.model ?? (await getAdultSettings(db)).reel_model;
  const sent: LoggedRequest[] = [];
  let start = frame.id;
  if (!seamless) {
    // The frame kept exactly as it is but for the faces, one face at a time (an edit model holds one far better than two).
    let file: { bytes: Buffer; mime: string };
    try {
      const size = await imageSize(cutBytes!);
      const ratio = size ? `${size.w}:${size.h}` : (facts.aspect ?? "3:4");
      const drawn = await withRequestLog(async () => {
        let current: { bytes: Buffer; mime: string } | null = null;
        for (const [k, t] of targets.entries()) {
          const from = current ? `data:${current.mime};base64,${current.bytes.toString("base64")}` : signedMediaUrl(frame.id, baseUrl);
          current = await drawKeyframe(venice, fixFacePrompt(t.tag, [], level), [from, signedMediaUrl(faces[k], baseUrl)], KEYFRAME_MODEL, askRatio(ratio, ratiosFor("venice", KEYFRAME_MODEL)));
        }
        return current!;
      });
      sent.push(...drawn.requests);
      file = await fitRatio(drawn.value, ratio);
    } catch (err) {
      return back(fail(502, "not_made", `Their faces couldn't be drawn fresh (${err instanceof Error ? err.message.slice(0, 160) : "error"}).`));
    }
    // The age question, like any keyframe (its video is checked in full when it's collected).
    const verdict = await checkMedia(db, { base64: file.bytes.toString("base64"), mime: file.mime }, "keyframe", { owner: viewer });
    if (!verdict.ok) {
      if (verdict.paused) return back(fail(503, "hive_paused", hivePausedMessage(verdict.paused, { tokens: pays ? "back" : "none" })));
      if (verdict.reason.startsWith("the check couldn't run")) return back(fail(503, "check_busy", "The safety check couldn't look at the fresh frame just now. Try again in a few minutes."));
      await db.query(`insert into adult_rejections (id, owner_id, kind, reason) values ($1, $2, 'studio', $3)`, [crypto.randomUUID(), viewer, `studio keep going: ${verdict.reason}`.slice(0, 300)]).catch(() => {});
      return back(fail(422, "discarded", `The safety check discarded the fresh frame (${verdict.reason}).`));
    }
    if (empty) {
      const alone = await aloneInPicture(db, { base64: file.bytes.toString("base64"), mime: file.mime });
      if (alone !== true) return back(await refusedPublic(db, viewer, alone));
    }
    start = crypto.randomUUID();
    const kept = await keepBytes("after-dark", start, file.bytes, file.mime);
    await db.query(
      `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, object_key, status, source_image, moment_at, model, request)
       values ($1, $2, $3, $4, 'frame', $5, $6, $7, $8, 'ready', $9, $10, $11, $12::jsonb)`,
      [start, viewer, facts.people[0], facts.people[1], "Kept going from an animation, their faces made fresh", file.mime, kept.data, kept.object_key, prev.video, frame.moment_at, KEYFRAME_MODEL, requestJson(sent)],
    );
  }

  let queueId: string;
  try {
    const prompt = animatePrompt(subjectOf(c, viewer, level >= 2), level, carryOn(pair, Boolean(words)), { guide: words, dialog }, { pair, camera: input.camera, emptyPlace: empty });
    const negative = [pair ? ANIMATE_NEGATIVE_PAIR : ANIMATE_NEGATIVE, ...(empty ? [EMPTY_PLACE_NEGATIVE] : [])].join(", ");
    const queued = await withRequestLog(() => queueVideo(venice, { model, seconds, image_url: signedMediaUrl(start, baseUrl), prompt, negative }));
    queueId = queued.value;
    sent.push(...queued.requests);
  } catch (err) {
    // The fresh frame drawn for it goes too: nothing will start from it.
    if (start !== frame.id) await db.query(`delete from adult_images where id = $1`, [start]).catch(() => {});
    return back(fail(502, "not_made", `It couldn't be kept going (${err instanceof Error ? err.message.slice(0, 160) : "error"}).`));
  }
  const choices = {
    source: start,
    motion: null,
    seconds,
    queue_id: queueId,
    level,
    from: prev.shoot,
    cut: { video: prev.video, frame: frame.id, at: frame.moment_at ?? 0, seamless },
    facts,
    ...(input.camera && input.camera !== "steady" ? { camera: input.camera } : {}),
    ...(words ? { guide: words } : {}),
    ...(dialog ? { dialog } : {}),
    request: sent,
  };
  const row = (
    await db.query<Parameters<typeof shootRow>[0]>(
      `insert into adult_studio_shoots (id, owner_id, character_id, kind, choices, model, provider, tokens, asked, status)
       values ($1, $2, $3, 'animate', $4::jsonb, $5, 'venice', $6, 1, 'making')
       returning id, kind, status, model, provider, tokens, asked, made, pictures, redo_of, error, created_at`,
      [crypto.randomUUID(), viewer, c.id, JSON.stringify(choices), model, pays ? tokens : 0],
    )
  ).rows[0];
  const how = seamless
    ? "Keeping it going from where it ended"
    : forcedFresh
      ? "Keeping it going from where it ended, with their faces drawn fresh (every third link is, so they keep looking like themselves)"
      : "Keeping it going from where it ended, with their faces drawn fresh";
  return { ok: true, shoot: shootRow(row), pictures: [], refunded: false, message: `${how}: it takes a few minutes, and lands in the gallery.` };
}

/** Somewhere public, someone else is in the frame (or the check for that couldn't run): logged, and refused. */
async function refusedPublic(db: Db, viewer: string, alone: boolean | null): Promise<StudioFail> {
  const why = alone === null ? "the check for anyone else in the frame couldn't run" : "someone else was in the frame, somewhere public";
  await db.query(`insert into adult_rejections (id, owner_id, kind, reason) values ($1, $2, 'studio', $3)`, [crypto.randomUUID(), viewer, `studio keep going: ${why}`.slice(0, 300)]).catch(() => {});
  return alone === null
    ? fail(503, "check_busy", "The check for anyone else in the frame couldn't run just now. Try again in a few minutes.")
    : fail(422, "public", "Someone else is in that frame, somewhere public: nude there stays with the place empty.");
}
