/**
 * Clips on demand (David, 2026-10-22, from the competitor analysis): one 5–10 s shot of the two of them, made when it's
 * asked for, three ways:
 *  - "Clip from here": the scene's latest moment. The director (After Dark's text model) writes the still and the motion
 *    from the last few lines, and picks the line said in it, if any.
 *  - An act from the menu (lib/adult/acts.ts): its still and its motion, both of them in frame, posed as it has them.
 *    Nobody speaks.
 *  - "Keep going": a finished clip carried on. There's no ffmpeg on the server any more (#688), so the next keyframe is
 *    the two baselines plus the clip's own keyframe as the picture to carry on from (the place, the light, how they're
 *    posed and dressed), and the motion carries on (the act's next, or the director's).
 *
 * Each is a reel of one shot (lib/adult/reels.ts, kind 'clip'): the same keyframe, the same Hive check before anything is
 * kept, the same video models, the same poll that collects it, one video at a time, and a shot that doesn't come through
 * gives its tokens back. What a clip may show: no further than the night has gone (its stage), nothing past kissing
 * somewhere public, and nothing the pair's limits rule out (mediaLimits). Price: clip_tokens bought tokens (3 by
 * default), admins free.
 */
import { isAdmin } from "../admins";
import { refundBoughtTokens, spendBoughtTokens } from "../allowance";
import { loadCharacter } from "../character";
import type { Db } from "../db";
import { checkAdultText } from "../safety";
import { actById, actFor, actLocked, actMenu, actRuledOut, crossesTaboo, FRAMING_WORDS, NO_MEDIA_LIMITS, type MediaLimits, type MenuAct } from "./acts";
import { CHAIN_MAX } from "./clip-chains";
import { isPublicPlace } from "./continuity";
import { INTENSITY, intensityOf, limitsHit, storedHardNos, type PairLimits } from "./limits";
import { ensureBaseline } from "./media";
import { adultModel } from "./mode";
import {
  baselines,
  busyMessage,
  busyReel,
  continuePrompt,
  keyframePrompt,
  motionOf,
  placesOf,
  placeWords,
  reelCast,
  reelNight,
  settleIfDone,
  spoken,
  startShots,
  stillOf,
  withoutNames,
  type ClipMeta,
  type MakeReelResult,
  type Reel,
  type ReelPerson,
  type ReelShot,
  type ReelWhere,
} from "./reels";
import { eligiblePair, type SceneLine } from "./scenes";
import { adultKeys, getAdultSettings } from "./settings";
import { stageShown } from "./stage-floor";
import { STAGES } from "./stages";

const KISSING = STAGES.indexOf("kissing");
const LAST = STAGES.length - 1;
export { CHAIN_MAX };
/** The lines the director reads for "Clip from here". */
const HERE_LINES = 8;

/**
 * The viewer's limits for a pair (lib/adult/limits.ts: the intensity dial and the hard nos, set per owner and pair) as
 * its pictures and clips hold to them: no further than the intensity goes, explicit only at explicit (spicy and below
 * are sensual, never graphic), and no act, still, motion or line that crosses a hard no.
 */
export function mediaLimitsOf(limits: PairLimits): MediaLimits {
  return {
    maxStage: INTENSITY[limits.intensity].maxStage,
    explicit: limits.intensity === "explicit",
    hardNos: limits.hard_nos.chips,
    hit: (text) => limitsHit(text, limits),
  };
}

/** The pair's limits as the viewer set them on their scene (adult_scenes.intensity, .hard_nos); none set, none here. */
export async function mediaLimits(db: Db, ownerId: string, a: string, b: string): Promise<MediaLimits> {
  const row = (await db.query<{ intensity: string | null; hard_nos: unknown }>(`select intensity, hard_nos from adult_scenes where owner_id = $1 and character_a = $2 and character_b = $3`, [ownerId, a, b])).rows[0];
  if (!row) return NO_MEDIA_LIMITS;
  return mediaLimitsOf({ intensity: intensityOf(row.intensity), hard_nos: storedHardNos(row.hard_nos) });
}

/** Where the pair's night stands, for what a clip or a picture may show: its stage, its place, and whether that's public. */
export type NightStands = { stage: number; place: string | null; publicPlace: boolean; home: "a" | "b" | null };
export function nightStands(where: ReelWhere): NightStands {
  const place = where.set ?? where.place ?? where.date ?? null;
  const home = where.history.at(-1)?.home ?? null;
  return { stage: Math.max(0, Math.min(LAST, where.stage)), place, publicPlace: isPublicPlace(place, home), home };
}

/**
 * How far a still or a motion goes, for a picture: what the stage floor reads in a line (lib/adult/stage-floor.ts), and
 * the words a shot list uses for it that a line rarely does ("nude", "having sex", "astride").
 */
const PICTURE_SIGNS: [number, RegExp][] = [
  [LAST, /\b(having sex|sex\b|astride|riding|rides\b|between (her|his|their) (legs|thighs)|going down on|goes down on)/i],
  [3, /\b(nude|naked|topless|bare[- ]chested|undress\w*|half undressed|clothes half off|underwear|lingerie|bras?\b|unbutton\w*)/i],
];
export function shownStage(text: string): number {
  let at = stageShown(text) ?? 0;
  for (const [stage, sign] of PICTURE_SIGNS) if (stage > at && sign.test(text)) at = stage;
  return at;
}

/** Whether a still, a motion or a line said in a clip can go to a picture or video model: David's lines, the stage and the limits. */
function fitsClip(text: string, cap: number, limits: MediaLimits): boolean {
  if (!text.trim()) return true;
  if (!checkAdultText({ text }).ok || crossesTaboo(text)) return false;
  if (shownStage(text) > cap) return false;
  return limits.hit(text) === null;
}

/** A sentence's first letter capitalised. */
const upperFirst = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** How far a clip of the night as it stands may go: its stage, held to the intensity, and to kissing somewhere public. */
const capFor = (stands: NightStands, limits: MediaLimits) => Math.min(stands.stage, limits.maxStage, stands.publicPlace ? KISSING : LAST);

/** What the director writes for a clip: the still, the motion, and the line said in it (an index into the night), or none. */
export type ClipDirection = { frame: string; motion: string; line: number | null };

/**
 * "Clip from here": the director's shot of the scene's latest moment, from its last few lines, held to the stage it's
 * reached (`cap`) and the pair's limits. Falls back to the plain still for that stage and the last line's action, when
 * what it wrote can't be read or can't be used.
 */
export async function directHere(db: Db, cast: [ReelPerson, ReelPerson], lines: readonly SceneLine[], places: readonly (string | null)[], cap: number, limits: MediaLimits): Promise<ClipDirection> {
  const from = Math.max(0, lines.length - HERE_LINES);
  const recent = lines.slice(from).map((l, k) => ({ i: from + k, who: l.who, ...spoken(l.text) }));
  const speaker = (i: number) => cast[lines[i].who === "a" ? 0 : 1];
  const sayable = (i: number) => {
    const r = recent.find((x) => x.i === i);
    return Boolean(r && r.speech.split(" ").length >= 3 && fitsClip(r.speech, LAST, limits));
  };
  const plain = (): ClipDirection => {
    const last = recent[recent.length - 1];
    const motion = last ? motionOf(cast, speaker(last.i), last.action) : "";
    const lastSaid = [...recent].reverse().slice(0, 3).find((r) => sayable(r.i));
    return { frame: stillOf(cast, cap), motion: fitsClip(motion, cap, limits) ? motion : "The two of them stay close, moving together.", line: lastSaid?.i ?? null };
  };
  if (!recent.length) return plain();
  try {
    const list = recent
      .map((l) => `${l.i} | ${speaker(l.i).tag} | ${places[l.i] ? placeWords(places[l.i]!, cast) : "?"} | ${STAGES[lines[l.i].stage ?? cap] ?? "?"} | ${l.action ? `(${withoutNames(l.action, cast)}) ` : ""}${withoutNames(l.speech, cast)}`)
      .join("\n");
    const raw = await (await adultModel(db)).complete(
      [
        { role: "system", content: "You direct one short shot cut from a private night between two consenting adults. You never write new dialogue." },
        {
          role: "user",
          content: [
            "The two of them, named only like this, never by name:",
            ...cast.map((p) => `- ${p.tag}: a ${p.noun}${p.look ? `, ${p.look}` : ""}`),
            "",
            `The night's latest lines, one per row as "index | who says it | where | how far it's gone | (what they do) what they say":`,
            list,
            "",
            `Write one shot of the two of them at the very last moment of these lines, doing what the script has them doing right then. It shows no more than ${STAGES[cap]}.`,
            `- "frame": one photograph of that moment, in one or two sentences: where they are in the place, where each of them is (one on the left or in front, the other on the right or behind) and how their bodies are posed toward each other, what's touching, what they're wearing or not by then, and the framing (lying down, a medium shot from the side with both faces toward the camera, never from above). Both faces visible, two people only.`,
            `- "motion": one sentence: what each of them does over the next five seconds, carrying on from that photograph.`,
            `- "line": the index of the one line said during the shot (a short, vivid one from the last few), or null for none.`,
            "Concrete and physical, like a shot list: no feelings, no names.",
            'Reply with a JSON object: {"frame": "...", "motion": "...", "line": 12}',
          ].join("\n"),
        },
      ],
      { temperature: 0.4, maxTokens: 500 },
    );
    const j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { frame?: unknown; motion?: unknown; line?: unknown };
    // Names out ("Rafe pulls her close" is "the man pulls her close"), and a sentence's start capitalised again.
    const said = (v: unknown, max: number) => (typeof v === "string" ? upperFirst(withoutNames(v.trim(), cast).slice(0, max)) : "");
    const fallback = plain();
    const frame = said(j.frame, 600);
    const motion = said(j.motion, 300);
    const line = typeof j.line === "number" && sayable(j.line) ? j.line : null;
    return {
      frame: frame && fitsClip(frame, cap, limits) ? frame : fallback.frame,
      motion: motion && fitsClip(motion, cap, limits) ? motion : fallback.motion,
      line,
    };
  } catch {
    return plain();
  }
}

/** Keep going from a clip from here: what they do next, carrying on from its still and motion; the same again, failing that. */
export async function directNext(db: Db, cast: [ReelPerson, ReelPerson], before: { frame: string; motion: string }, cap: number, limits: MediaLimits): Promise<string> {
  const again = fitsClip(before.motion, cap, limits) && before.motion ? `They carry on: ${before.motion[0].toLowerCase()}${before.motion.slice(1)}` : "The two of them stay close, moving together.";
  try {
    const raw = await (await adultModel(db)).complete(
      [
        { role: "system", content: "You direct one short shot cut from a private night between two consenting adults." },
        {
          role: "user",
          content: [
            `This shot of ${cast[0].tag} and ${cast[1].tag} has just ended.`,
            `How it started: ${before.frame}`,
            `What they did in it: ${before.motion}`,
            "",
            `Write what they do over the next five seconds, carrying on from where that left them, in the same place and pose: one sentence, concrete and physical, both of them in it, no further than ${STAGES[cap]}, no names.`,
            'Reply with a JSON object: {"motion": "..."}',
          ].join("\n"),
        },
      ],
      { temperature: 0.4, maxTokens: 200 },
    );
    const j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { motion?: unknown };
    const motion = typeof j.motion === "string" ? upperFirst(withoutNames(j.motion.trim(), cast).slice(0, 300)) : "";
    return motion && fitsClip(motion, cap, limits) ? motion : again;
  } catch {
    return again;
  }
}

/** The menu for a pair's night (the API's GET): the price, whether "Clip from here" can run, and the acts. */
export type ClipOffer = { price: number; here: { available: boolean; why: string | null }; acts: MenuAct[] };

export async function clipOffer(db: Db, ownerId: string, x: string, y: string): Promise<ClipOffer | null> {
  const night = await reelNight(db, ownerId, x, y);
  const pair = await eligiblePair(db, ownerId, x, y);
  if (!night || !pair) return null;
  const [ca, cb] = await Promise.all([loadCharacter(db, pair[0]), loadCharacter(db, pair[1])]);
  if (!ca || !cb) return null;
  const cast = reelCast(ca, cb, ownerId);
  const limits = await mediaLimits(db, ownerId, ...pair);
  const price = (await isAdmin(db, ownerId)) ? 0 : (await getAdultSettings(db)).clip_tokens;
  const here = night.lines.length >= 2 ? { available: true, why: null } : { available: false, why: "Write a few lines first" };
  return { price, here, acts: actMenu(nightStands(night.where), cast, [ca.name, cb.name], limits) };
}

/** What's asked for: the latest moment, an act (with who leads swapped, or not), or to keep going from a clip. */
export type ClipAsk = { a: string; b: string; here: true } | { a: string; b: string; act: string; swap?: boolean } | { continue: string };

/** A shot planned, before anything is spent: what it shows and says, how far it goes, where, and its keyframe. */
type Plan = {
  shot: Pick<ReelShot, "line" | "who" | "text" | "frame" | "motion">;
  stage: number;
  place: string | null;
  meta: ClipMeta;
  keyframe: (set: string | null, place: string | null) => { prompt: string; continueFrom: string | null; withSet: boolean };
};
type Refusal = { ok: false; status: number; error: string; message: string };
const refuse = (status: number, error: string, message: string): Refusal => ({ ok: false, status, error, message });

/** One of this person's clips, by id. */
async function ownClip(db: Db, ownerId: string, id: string): Promise<(Reel & { a: string; b: string }) | null> {
  const r = (
    await db.query<{ id: string; status: Reel["status"]; tokens: number; shots: ReelShot[]; created_at: string | Date; clip: ClipMeta | null; character_a: string; character_b: string }>(
      `select id, status, tokens, shots, created_at, clip, character_a, character_b from adult_reels where id = $1 and owner_id = $2 and kind = 'clip'`,
      [id, ownerId],
    )
  ).rows[0];
  return r ? { id: r.id, status: r.status, tokens: r.tokens, shots: r.shots, created_at: new Date(r.created_at).toISOString(), kind: "clip", clip: r.clip, a: r.character_a, b: r.character_b } : null;
}

/** How many shots a chain of clips has, back to its first (CHAIN_MAX at most is counted). */
async function chainLength(db: Db, ownerId: string, clip: ClipMeta | null | undefined): Promise<number> {
  let n = 1;
  let from = clip?.from ?? null;
  while (from && n < CHAIN_MAX) {
    const up = await ownClip(db, ownerId, from);
    if (!up) break;
    n++;
    from = up.clip?.from ?? null;
  }
  return n;
}

/**
 * Makes a clip: plans the shot (the director's moment, an act, or the clip it keeps going from), spends clip_tokens
 * (admins free), then draws, checks and queues its keyframe like a reel's shot. The page's poll collects it
 * (advanceReel); it lists with the pair's videos.
 */
export async function makeClip(db: Db, ownerId: string, ask: ClipAsk, baseUrl: string): Promise<MakeReelResult> {
  const parent = "continue" in ask ? await ownClip(db, ownerId, ask.continue) : null;
  if ("continue" in ask && !parent) return refuse(404, "not_found", "There's no clip of yours with that id.");
  const [x, y] = parent ? [parent.a, parent.b] : "continue" in ask ? ["", ""] : [ask.a, ask.b];
  const pair = await eligiblePair(db, ownerId, x, y);
  if (!pair) return refuse(404, "not_found", "Pick two characters who are in after dark.");
  const [a, b] = pair;
  const settings = await getAdultSettings(db);
  const keys = await adultKeys(db);
  const onReplicate = settings.media_provider === "replicate";
  if (!(onReplicate ? keys.replicate : keys.venice) || !keys.hive) {
    return refuse(409, "not_set_up", `Clips need the ${onReplicate ? "Replicate" : "Venice"} and Hive keys in After Dark's settings.`);
  }
  const night = await reelNight(db, ownerId, a, b);
  const [ca, cb] = await Promise.all([loadCharacter(db, a), loadCharacter(db, b)]);
  if (!night || !ca || !cb) return refuse(404, "not_found", "Pick two characters who are in after dark.");
  const cast = reelCast(ca, cb, ownerId);
  const limits = await mediaLimits(db, ownerId, a, b);
  const stands = nightStands(night.where);
  const places = placesOf(night.lines, night.where);

  // What the shot is, before anything is spent: a refusal here costs nothing.
  let plan: Plan;
  if (parent) {
    if (parent.status !== "ready") return refuse(409, "not_ready", "Keep going carries on from a clip that came through.");
    const before = [...parent.shots].reverse().find((s) => s.status === "ready" && s.frame_id);
    if (!before?.frame_id) return refuse(409, "not_ready", "That clip has no picture to carry on from.");
    if ((await chainLength(db, ownerId, parent.clip)) >= CHAIN_MAX) return refuse(409, "chain_full", `That clip has been kept going ${CHAIN_MAX - 1} times, as far as it goes. Start a new one.`);
    const meta = parent.clip ?? { act: null, swap: false, from: null, stage: stands.stage, place: stands.place, label: "A clip" };
    const act = meta.act ? actById(meta.act) : null;
    if (meta.stage > limits.maxStage || (act && actRuledOut(act, cast, limits))) return refuse(422, "not_allowed", "That's past the limits you've set for these two.");
    const motion = act ? actFor(act, cast, meta.swap).next : await directNext(db, cast, { frame: before.frame ?? "", motion: before.motion }, meta.stage, limits);
    if (!fitsClip(motion, meta.stage, limits)) return refuse(422, "not_allowed", "That's past the limits you've set for these two.");
    const after = before.motion || "they stay close";
    plan = {
      shot: { line: before.line, who: before.who, text: "", frame: `Carrying on from the shot before, after this: ${after}`, motion },
      stage: meta.stage,
      place: meta.place,
      meta: { ...meta, from: parent.id },
      keyframe: () => ({ prompt: continuePrompt(cast, after, meta.stage, { explicit: limits.explicit }), continueFrom: before.frame_id!, withSet: false }),
    };
  } else if ("act" in ask) {
    const act = actById(ask.act);
    if (!act) return refuse(422, "unknown_act", "That isn't on the menu.");
    if (actRuledOut(act, cast, limits)) return refuse(422, "not_allowed", "That's past the limits you've set for these two.");
    const locked = actLocked(act, stands);
    if (locked) return refuse(422, "not_yet", `${act.label}: ${locked[0].toLowerCase()}${locked.slice(1)}.`);
    const filled = actFor(act, cast, ask.swap === true);
    // The menu's words were written to the lines, but they're held to them like anything else a model reads.
    if (![filled.frame, filled.motion].every((t) => fitsClip(t, act.dress, limits))) return refuse(422, "not_allowed", "That's past the limits you've set for these two.");
    const at = Math.max(0, night.lines.length - 1);
    const frame = `${filled.frame} ${FRAMING_WORDS[act.framing]}`;
    plan = {
      shot: { line: at, who: filled.lead === 0 ? "a" : "b", text: "", frame, motion: filled.motion },
      stage: act.dress,
      place: places[at] ?? stands.place,
      meta: { act: act.id, swap: ask.swap === true, from: null, stage: act.dress, place: places[at] ?? stands.place, label: act.label },
      keyframe: (set, place) => ({ prompt: keyframePrompt(cast, frame, place ? placeWords(place, cast) : null, act.dress, Boolean(set), { explicit: limits.explicit }), continueFrom: null, withSet: true }),
    };
  } else {
    if (night.lines.length < 2) return refuse(409, "too_short", "Write a few lines first: a clip from here films the scene's latest moment.");
    const cap = capFor(stands, limits);
    const d = await directHere(db, cast, night.lines, places, cap, limits);
    const at = night.lines.length - 1;
    const line = d.line ?? at;
    plan = {
      shot: { line, who: night.lines[line].who, text: d.line !== null ? spoken(night.lines[line].text).speech : "", frame: d.frame, motion: d.motion },
      stage: cap,
      place: places[at] ?? stands.place,
      meta: { act: null, swap: false, from: null, stage: cap, place: places[at] ?? stands.place, label: "From here" },
      keyframe: (set, place) => ({ prompt: keyframePrompt(cast, d.frame, place ? placeWords(place, cast) : null, cap, Boolean(set), { explicit: limits.explicit }), continueFrom: null, withSet: true }),
    };
  }
  if (![plan.shot.text, plan.shot.frame ?? "", plan.shot.motion].every((t) => checkAdultText({ t }).ok && !crossesTaboo(t))) {
    return refuse(422, "not_allowed", "That clip crosses one of the lines After Dark never crosses.");
  }

  const busy = await busyReel(db, ownerId);
  if (busy) return { ok: false, status: 409, error: "busy", message: busyMessage(busy), busy };
  const pays = !(await isAdmin(db, ownerId));
  const price = settings.clip_tokens;
  if (pays && price > 0 && !(await spendBoughtTokens(db, ownerId, price))) {
    return refuse(402, "needs_tokens", `A clip costs ${price} token${price === 1 ? "" : "s"}. Get more on the shop page.`);
  }
  const id = crypto.randomUUID();
  try {
    // Each one's baseline, the faces every keyframe keeps; made now for one who has none.
    for (const c of [ca, cb]) await ensureBaseline(db, ownerId, c);
    const bases = await baselines(db, a, b);
    if (!bases) throw new Error("a picture of each of them is needed first");
    const shots: ReelShot[] = [{ ...plan.shot, status: "queued", ...(onReplicate ? { provider: "replicate" as const } : {}) }];
    await db.query(`insert into adult_reels (id, owner_id, character_a, character_b, status, tokens, shots, kind, clip) values ($1, $2, $3, $4, 'making', $5, $6::jsonb, 'clip', $7::jsonb)`, [
      id,
      ownerId,
      a,
      b,
      pays ? price : 0,
      JSON.stringify(shots),
      JSON.stringify(plan.meta),
    ]);
    const where: (string | null)[] = [];
    const stages: number[] = [];
    where[plan.shot.line] = plan.place;
    stages[plan.shot.line] = plan.stage;
    const replicate = onReplicate
      ? { token: keys.replicate!, keyframe: settings.replicate_keyframe_model, video: settings.replicate_video_model, videoLora: settings.replicate_video_lora }
      : null;
    await startShots(db, ownerId, shots, {
      pair: [a, b],
      cast,
      places: where,
      stages,
      bases,
      venice: keys.venice ?? "",
      hive: keys.hive,
      model: settings.reel_model,
      baseUrl,
      replicate,
      keyframeFor: (_s, set, place) => plan.keyframe(set, place),
    });
    await db.query(`update adult_reels set shots = $2::jsonb where id = $1`, [id, JSON.stringify(shots)]);
    return { ok: true, reel: await settleIfDone(db, id) };
  } catch (err) {
    if (pays && price > 0) await refundBoughtTokens(db, ownerId, price);
    await db.query(`delete from adult_reels where id = $1`, [id]).catch(() => {});
    return refuse(502, "not_started", `The clip couldn't start (${err instanceof Error ? err.message : "error"}). Your tokens are back.`);
  }
}
