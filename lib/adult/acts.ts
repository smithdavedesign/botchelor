/**
 * The act menu (David, 2026-10-22, from the competitor analysis: Candy, OurDream and Seduced all have one): a curated
 * list of moments of the two of them, from standing close and talking to a handful of explicit positions. A clip
 * (lib/adult/clips.ts) or a picture is made from one: its still becomes the keyframe (both baselines made into one
 * picture of them, lib/adult/reels.ts), its motion what they do over the next few seconds, and `next` what they do when
 * it's kept going. The leaders' rule (docs/after-dark.md, "Videos with both of them in"): the start picture must already
 * show the act, both of them in it, each given a place in the frame. So every still names who is where and how they're
 * posed toward each other, keeps both faces visible, and names them only by how they look (lib/adult/reels.ts reelCast).
 *
 * What the menu offers, for a pair's night as it stands:
 *  - only what the night has reached: each act has a stage it needs (STAGES), and later ones show as locked until then;
 *  - nothing past kissing somewhere public (lib/adult/continuity.ts isPublicPlace), as in the scene itself;
 *  - never what the pair's limits rule out (lib/adult/limits.ts, the intensity and the hard nos): those aren't offered
 *    at all (MediaLimits).
 *
 * Pure: no database, no model. David's lines hold on every word a picture or video model reads (crossesTaboo, on top of
 * checkAdultText): nobody under 18 or suggesting it, no real people, no step-family, teacher and student, school or
 * age-play.
 */
import type { ReelPerson } from "./reels";
import { STAGES } from "./stages";

const KISSING = STAGES.indexOf("kissing");
const LAST = STAGES.length - 1;

/** How a shot is framed: the whole of them and the room, from the thighs up, or their faces and shoulders. */
export const FRAMINGS = ["wide", "medium", "close"] as const;
export type Framing = (typeof FRAMINGS)[number];
export const FRAMING_WORDS: Record<Framing, string> = {
  wide: "A wide shot: the whole of both of them, head to toe, and the room around them.",
  medium: "A medium shot from the side, from their thighs up.",
  close: "A close shot of their faces and shoulders.",
};

/**
 * One moment on the menu. `{X}` and `{Y}` are the two of them as a picture model is told (the woman, the man, or by
 * their hair), X the one who leads (on top, behind, going down); `{X's}` and `{Y's}` the same, possessive; `{Xp}`/`{Yp}`
 * a possessive pronoun (her, his, their) and `{Xo}`/`{Yo}` an object one (her, him, them). No subject pronouns: they'd
 * need the verb to agree.
 */
export type Act = {
  id: string;
  /** The menu's words for it (no names). */
  label: string;
  /** The night has got this far (STAGES index) before it's offered. */
  minStage: number;
  /** How undressed they are in it, as a stage (lib/adult/reels.ts clothesAt): dressed, half undressed, nude. */
  dress: number;
  /** For a man and a woman, which of them is X by default (on top, behind). Otherwise X is the first of the two. */
  lead?: "man" | "woman";
  /** Who's who, for the viewer: "{X} on top of {Y}", with their names. */
  says: string;
  /** The still without their clothes: where each of them is and how they're posed, what touches, faces visible. */
  pose: string;
  /** What they wear in a clip of it ("both fully clothed"); a picture's outfit replaces it (lib/adult/pictures-menu.ts). */
  wear: string;
  /** The outfits a picture of it can have (lib/adult/pictures-menu.ts OUTFITS), as far as the night has gone. */
  outfits: readonly string[];
  /** What they do over the next few seconds, carrying on from the still. */
  motion: string;
  /** What they do when it's kept going (Keep going), carrying on from the motion. */
  next: string;
  /** How a clip of it is framed. */
  framing: Framing;
  /** The pair's hard nos (lib/adult/limits.ts HARD_NOS ids) this act is, whatever its words say. */
  hardNos?: readonly string[];
};

/** Outfits for a moment that could happen in anything from their clothes to nothing at all. */
const ANY_WEAR = ["tonight", "dressed_up", "casual", "underwear", "half", "nude"] as const;
/** Outfits for sex: nude, or with their clothes pushed aside. */
const SEX_WEAR = ["nude", "half"] as const;

/** The menu, gentlest first. Past kissing, every one is somewhere private only. */
export const ACTS: readonly Act[] = [
  {
    id: "close",
    label: "Close together",
    minStage: 0,
    dress: 0,
    says: "{X} and {Y}, close and talking",
    pose: "{X} and {Y} stand close together, facing each other, {X's} hand resting on {Y's} arm, both smiling, both faces visible.",
    wear: "both fully clothed",
    outfits: ANY_WEAR,
    motion: "{X} leans in to say something; {Y} laughs and moves a little closer.",
    next: "{Y} answers, and they drift closer still, their hands touching.",
    framing: "medium",
  },
  {
    id: "dance",
    label: "A slow dance",
    minStage: 0,
    dress: 0,
    says: "{X} and {Y}, dancing slowly",
    pose: "{X} and {Y} slow dance, {X's} arms around {Y's} waist and {Y's} hands on {X's} shoulders, their faces close and both turned toward the camera.",
    wear: "both fully clothed",
    outfits: ANY_WEAR,
    motion: "They sway together, turning slowly; {Y} rests a cheek against {X's} cheek.",
    next: "They keep dancing; {X} turns {Yo} under one arm and pulls {Yo} back in, both laughing.",
    framing: "medium",
  },
  {
    id: "cuddle",
    label: "Cuddling",
    minStage: 1,
    dress: 1,
    says: "{X} and {Y}, cuddled up",
    pose: "{X} and {Y} sit cuddled up together, {X's} arm around {Y} and {Y's} head on {X's} shoulder, both relaxed, both faces toward the camera.",
    wear: "both fully clothed",
    outfits: [...ANY_WEAR, "sheet"],
    motion: "{Y} nestles in closer; {X} strokes {Yp} hair.",
    next: "They stay wrapped up together; {Y} looks up at {X}, and they share a smile.",
    framing: "medium",
  },
  {
    id: "kiss",
    label: "A slow kiss",
    minStage: KISSING,
    dress: KISSING,
    says: "{X} and {Y}, kissing slowly",
    pose: "{X} and {Y} kiss slowly, faces close, both in profile to the camera, {X's} hand on {Y's} cheek and {Y's} arms around {X's} waist, eyes closed.",
    wear: "both fully clothed",
    outfits: ANY_WEAR,
    motion: "They kiss slowly and deeply; {X's} thumb strokes {Y's} cheek.",
    next: "They part for a breath, foreheads together, then kiss again, deeper.",
    framing: "close",
  },
  {
    id: "wall",
    label: "Against the wall",
    minStage: KISSING,
    dress: KISSING,
    says: "{X} kissing {Y} against the wall",
    pose: "{Y} stands with {Yp} back against a wall and {X} presses close, kissing {Yo}, {Y's} arms around {X's} neck, both faces in profile to the camera.",
    wear: "both fully clothed",
    outfits: ANY_WEAR,
    motion: "{X} kisses {Yo} deeper; {Y} pulls {Xo} closer, fingers in {Xp} hair.",
    next: "They break for a breath, smiling, and kiss again, {X's} hands on {Y's} waist.",
    framing: "medium",
  },
  {
    id: "undress",
    label: "Undressing each other",
    minStage: 3,
    dress: 3,
    says: "{X} and {Y}, undressing each other",
    pose: "{X} and {Y} stand close, undressing each other: {X} slides {Y's} top off {Yp} shoulders while {Y} pushes {X's} shirt down {Xp} arms, both faces visible in profile, about to kiss.",
    wear: "their tops half off and still dressed below the waist",
    outfits: ["half"],
    motion: "{X} lets {Y's} top fall; {Y} pulls {Xo} in, and they kiss as the last buttons come undone.",
    next: "The last of their clothes come off, and they pull each other close, skin to skin.",
    framing: "medium",
  },
  {
    id: "face_to_face",
    label: "Face to face",
    minStage: LAST,
    dress: LAST,
    lead: "man",
    says: "{X} on top of {Y}, face to face",
    pose: "On a bed, having sex face to face: {Y} lies on {Yp} back and {X} lies on top of {Yo}, between {Yp} legs, their bodies pressed together, {Y's} arms around {X's} shoulders, their faces close and both turned toward the camera.",
    wear: "both nude",
    outfits: SEX_WEAR,
    motion: "{X} moves slowly on top of {Yo}; {Y} wraps {Yp} legs around {Xo} and pulls {Xo} closer, both breathing hard.",
    next: "They keep going, faster, {Y} holding on to {X's} back, both lost in it.",
    framing: "medium",
  },
  {
    id: "on_top",
    label: "On top",
    minStage: LAST,
    dress: LAST,
    lead: "woman",
    says: "{X} on top of {Y}",
    // Not "turned three-quarters": the age check reads "turned three" as an age, and it's right to be that strict.
    pose: "On a bed, having sex: {Y} lies on {Yp} back and {X} sits astride {Y's} hips, upright and facing {Yo}, {Y's} hands on {X's} hips, both faces visible, {X} angled toward the camera.",
    wear: "both nude",
    outfits: SEX_WEAR,
    motion: "{X} rides {Yo} slowly, rolling {Xp} hips; {Y} holds {X's} hips and moves with {Xo}.",
    next: "{X} leans forward over {Y}, hands on {Y's} chest, moving faster, both breathing hard.",
    framing: "medium",
  },
  {
    id: "behind",
    label: "From behind",
    minStage: LAST,
    dress: LAST,
    lead: "man",
    says: "{X} behind {Y}",
    pose: "On a bed, having sex from behind: {Y} is on {Yp} hands and knees and {X} kneels behind {Yo}, holding {Y's} hips, {Y} looking back over {Yp} shoulder, both faces visible, seen from the side.",
    wear: "both nude",
    outfits: SEX_WEAR,
    motion: "{X} moves slowly, drawing {Y's} hips back; {Y} arches {Yp} back and pushes back against {Xo}.",
    next: "They keep going, faster and deeper, {X} leaning over {Y's} back, both breathing hard.",
    framing: "medium",
  },
  {
    id: "spooning",
    label: "Spooning",
    minStage: LAST,
    dress: LAST,
    lead: "man",
    says: "{X} spooning {Y}",
    pose: "In bed, lying on their sides, having sex spooning: {X} lies behind {Y} with an arm around {Yo}, {Y's} head back against {X's} shoulder, both faces turned toward the camera.",
    wear: "both nude",
    outfits: [...SEX_WEAR, "sheet"],
    motion: "{X} moves slowly behind {Yo}; {Y} reaches back to hold {X's} thigh, eyes closed.",
    next: "They keep the same slow rhythm, {X} kissing {Y's} neck, both breathing harder.",
    framing: "medium",
  },
  {
    id: "lap",
    label: "In a lap",
    minStage: LAST,
    dress: LAST,
    lead: "woman",
    says: "{X} in {Y's} lap",
    pose: "Having sex sitting up: {Y} sits on the edge of a bed and {X} sits astride {Y's} lap, facing {Yo}, legs around {Yo}, their arms around each other, both faces visible in profile.",
    wear: "both nude",
    outfits: SEX_WEAR,
    motion: "{X} moves up and down in {Y's} lap; {Y} holds {Xo} close and kisses {Xp} chest.",
    next: "They move faster together, foreheads pressed together, both breathing hard.",
    framing: "medium",
  },
  {
    id: "oral",
    label: "Going down",
    minStage: LAST,
    dress: LAST,
    says: "{X} going down on {Y}",
    pose: "On a bed: {Y} lies back against the pillows and {X} kneels between {Y's} thighs, going down on {Yo}, {Y's} hand resting on {X's} head, {Y's} face visible with head tipped back, {X's} face visible in profile.",
    wear: "both nude",
    outfits: SEX_WEAR,
    motion: "{X} goes down on {Yo} slowly; {Y} arches and grips the sheets.",
    next: "{X} keeps going, faster; {Y's} back arches off the bed, both faces flushed.",
    framing: "medium",
    hardNos: ["oral"],
  },
  {
    id: "afterglow",
    label: "Afterglow",
    minStage: LAST,
    dress: LAST,
    says: "{X} and {Y}, after",
    pose: "In bed, {Y} lying with {Yp} head on {X's} chest and {X's} arm around {Yo}, both relaxed and smiling, both faces toward the camera.",
    wear: "both nude under a sheet",
    outfits: ["sheet", "nude"],
    motion: "{X} strokes {Y's} back; {Y} traces slow circles on {X's} chest, smiling.",
    next: "They stay wrapped together; {Y} pulls the sheet up, and they laugh softly.",
    framing: "medium",
  },
];

export const actById = (id: string): Act | null => ACTS.find((a) => a.id === id) ?? null;

/**
 * The pair's limits as media reads them (lib/adult/limits.ts, the intensity dial and the hard nos, set per owner and
 * pair; lib/adult/clips.ts mediaLimits reads them). None: explicit, nothing ruled out.
 */
export type MediaLimits = {
  /** The furthest stage the intensity lets anything go (STAGES index). */
  maxStage: number;
  /** Explicit pictures and clips (the explicit intensity, the default); below it they're sensual, never graphic. */
  explicit: boolean;
  /** The hard nos by id (lib/adult/limits.ts HARD_NOS). */
  hardNos: readonly string[];
  /** Why a text crosses the limits (a hard no, one of the viewer's own, or more than the intensity allows), or null. */
  hit: (text: string) => string | null;
};
export const NO_MEDIA_LIMITS: MediaLimits = { maxStage: LAST, explicit: true, hardNos: [], hit: () => null };

const PRONOUNS = { woman: ["her", "her"], man: ["his", "him"], person: ["their", "them"] } as const;
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Who's X (leads) and who's Y: the act's lead noun when one of them has it and the other doesn't, else the first; swapped on request. */
export function rolesFor(act: Pick<Act, "lead">, cast: readonly [ReelPerson, ReelPerson], swap = false): { x: 0 | 1; y: 0 | 1 } {
  const [a, b] = cast;
  let lead: 0 | 1 = 0;
  if (act.lead && a.noun !== b.noun && b.noun === act.lead) lead = 1;
  const x: 0 | 1 = swap ? (lead === 0 ? 1 : 0) : lead;
  return { x, y: x === 0 ? 1 : 0 };
}

/** An act's words with the two of them in: their tags (how a picture model is told who's who), or their names for the viewer. */
export function fillAct(text: string, x: { tag: string; noun: ReelPerson["noun"] }, y: { tag: string; noun: ReelPerson["noun"] }): string {
  const [xp, xo] = PRONOUNS[x.noun];
  const [yp, yo] = PRONOUNS[y.noun];
  const filled = text
    .replace(/\{X's\}/g, `${x.tag}'s`)
    .replace(/\{Y's\}/g, `${y.tag}'s`)
    .replace(/\{Xp\}/g, xp)
    .replace(/\{Yp\}/g, yp)
    .replace(/\{Xo\}/g, xo)
    .replace(/\{Yo\}/g, yo)
    .replace(/\{X\}/g, x.tag)
    .replace(/\{Y\}/g, y.tag);
  // A tag starts a sentence as "The woman…".
  return filled.replace(/(^|[.!?]\s+)([a-z])/g, (_, p: string, c: string) => `${p}${c.toUpperCase()}`);
}

/**
 * An act as a picture model reads it, for these two, with the two of them in by how they look: its pose, its still (the
 * pose and what they wear in a clip of it), its motion and its next.
 */
export function actFor(act: Act, cast: readonly [ReelPerson, ReelPerson], swap = false): { pose: string; frame: string; motion: string; next: string; lead: 0 | 1 } {
  const { x, y } = rolesFor(act, cast, swap);
  const [px, py] = [cast[x], cast[y]];
  const pose = fillAct(act.pose, px, py);
  return { pose, frame: `${pose} ${cap(act.wear)}.`, motion: fillAct(act.motion, px, py), next: fillAct(act.next, px, py), lead: x };
}

/** Who's who in an act for the viewer, with their first names ("Juniper on top of Rafe"). */
export function actSays(act: Act, cast: readonly [ReelPerson, ReelPerson], names: readonly [string, string], swap = false): string {
  const { x, y } = rolesFor(act, cast, swap);
  const first = (n: string) => n.split(/\s+/)[0];
  return cap(fillAct(act.says, { tag: first(names[x]), noun: cast[x].noun }, { tag: first(names[y]), noun: cast[y].noun }));
}

/**
 * David's lines, for anything a picture or video model reads, on top of checkAdultText (lib/safety.ts: nobody under 18,
 * no real people): no step-family, no teacher and student, no school, no age-play. A still or a motion that names one is
 * never used (the plain still for the stage is, instead).
 */
const TABOO =
  /\b(step[- ]?(mom|moms|mother|mothers|dad|dads|father|fathers|sister|sisters|brother|brothers|son|sons|daughter|daughters|sibling|siblings|family|parent|parents|kid|kids)|students?|(teacher|professor|tutor|coach)s? and|(her|his|their|my|your) (teacher|professor|tutor|coach)|class ?rooms?|school\w*|dorm(itory|itories|s)?|age[- ]?play|daddy'?s little|little (girl|boy|one)|babysit\w*|pigtails?|sweet sixteen)\b/i;
export const crossesTaboo = (text: string): boolean => TABOO.test(text.replace(/’/g, "'"));

/** One act as the menu shows it: offered now, or locked and why. */
export type MenuAct = { id: string; label: string; says: string; available: boolean; why: string | null; stage: number };

/** Why an act can't be made now (the night hasn't got there, or it's somewhere public), or null when it can. */
export function actLocked(act: Pick<Act, "minStage">, where: { stage: number; publicPlace: boolean }): string | null {
  if (act.minStage > where.stage) return `Once they've got to ${STAGES[act.minStage]}`;
  if (where.publicPlace && act.minStage > KISSING) return "Somewhere private first";
  return null;
}

/** Whether the pair's limits rule an act out altogether: past the intensity, one of their hard nos, or its words cross one. */
export function actRuledOut(act: Act, cast: readonly [ReelPerson, ReelPerson], limits: MediaLimits): boolean {
  if (act.minStage > limits.maxStage) return true;
  if (act.hardNos?.some((h) => limits.hardNos.includes(h))) return true;
  // Both ways round: whoever leads, the words are the same act.
  return [false, true].some((swap) => {
    const a = actFor(act, cast, swap);
    return limits.hit(`${a.frame} ${a.motion} ${a.next}`) !== null;
  });
}

/**
 * The menu for a pair's night: every act their limits allow, in order, each offered now or locked with why. An act
 * their limits rule out isn't on it at all.
 */
export function actMenu(where: { stage: number; publicPlace: boolean }, cast: readonly [ReelPerson, ReelPerson], names: readonly [string, string], limits: MediaLimits = NO_MEDIA_LIMITS): MenuAct[] {
  return ACTS.filter((act) => !actRuledOut(act, cast, limits)).map((act) => {
    const why = actLocked(act, where);
    return { id: act.id, label: act.label, says: actSays(act, cast, names), available: why === null, why, stage: act.minStage };
  });
}
