/**
 * Beat pictures (David, 2026-10-24: "generating a image baseline of the scene and then asking for the video is way more
 * effective… when things get explicit in our theater stop and take a image of the scene at the place"). A chapter's
 * moments that matter are found as its lines are written: undressing, sex, each new position, the climax and the
 * afterglow. Each is offered to the viewer when the theater reaches it ("Picture this?"): yes draws it now; not now
 * leaves it for them to pick their moment (Picture this, on any line); and whatever they never chose is drawn when the
 * chapter closes. At most BEATS_PER_CHAPTER a chapter, found; a moment the viewer picks themselves is always drawn.
 *
 * Each picture is drawn like a menu picture (lib/adult/pictures-menu.ts keepPictureOfBoth): their two baselines and
 * the place's set made into one picture of the act (lib/adult/acts.ts, whose stills already say who is where, both
 * faces visible), with what was actually happening in the lines around it, checked by Hive before it's kept, and stored
 * in their gallery. A video of the night then starts a shot from the beat picture nearest before its line, when the
 * stage and the place still match (lib/adult/reels.ts reuseBeatPictures), instead of drawing a new keyframe: the video
 * looks like the pictures, and costs less.
 *
 * Free, like the chapter's automatic picture (lib/adult/auto-pictures.ts), and counted against the month's pictures.
 * Off when the setting is (beat_pictures), or when pictures can't be made.
 */
import { loadCharacter, type Character } from "../character";
import type { Db } from "../db";
import { checkAdultText } from "../safety";
import { inBackground } from "../sets";
import { siteUrl } from "../site";
import { actById, actFor, actRuledOut, crossesTaboo, FRAMING_WORDS, povFor, type Eyes, type MediaLimits } from "./acts";
import { chooseView, framingScores } from "./framing";
import { mediaLimits } from "./clips";
import { climaxIn } from "./craft";
import { checkReady, mediaGate } from "./moderation";
import { recentActions } from "./media";
import { keepPictureOfBoth } from "./pictures-menu";
import { keyframePrompt, placeWords, povPrompt, reelCast, withoutNames, type ReelPerson } from "./reels";
import { thumbsDown } from "./steering";
import { adultKeys, getAdultSettings } from "./settings";
import { claimChapterPicture } from "./chapter-pictures";
import { aheadBudget, countAhead, settleDrawAhead } from "./draw-ahead";
import { picturesBlocked } from "./readiness";
import { refundBoughtTokens } from "../allowance";
import { pictureBrief, type Brief } from "./picture-brief";
import { roleplayById, rolesLine } from "./roleplays";
import { venueSituation } from "./scene-catalog";
import { ownPlaceSituation, ownRoleplay } from "../studio/library";
import { isPublicPlace } from "./continuity";
import { looksPictureWords } from "../looks";
import { overCap } from "./usage";

const UNDRESSING = 3;
const SEX = 4;

/** Found moments a chapter offers at most (a moment the viewer picks is on top of these). */
export const BEATS_PER_CHAPTER = 6;
/** After a climax, the afterglow's picture is this many lines on. */
const AFTERGLOW_AFTER = 4;
/** The lines a beat picture reads what was happening from: the beat's line and the ones just before it. */
const MOMENT_LINES = 6;

export type BeatKind = "undressing" | "sex" | "position" | "climax" | "afterglow" | "chosen" | "chapter" | "asked";
export type BeatStatus = "offered" | "later" | "drawing" | "drawn" | "failed";

/** A moment found in the lines: its line (in the chapter), the act it's drawn as, what kind of moment, the stage. */
export type FoundBeat = { line: number; act: string; kind: BeatKind; stage: number };

/** A beat as the page gets it. */
export type PublicBeat = { id: string; line: number; kind: BeatKind; act: string; label: string; status: BeatStatus; picture_id: string | null; reason?: string | null };

type BeatRow = {
  id: string;
  owner_id: string;
  scene_id: string;
  character_a: string;
  character_b: string;
  chapter: number;
  line: number;
  act: string;
  kind: BeatKind;
  stage: number;
  place: string | null;
  status: BeatStatus;
  picture_id: string | null;
  night_id: string | null;
  /** The owner's own words for this scene picture: a direction that leads it, and a speech-bubble line (both optional). */
  custom: string | null;
  dialog: string | null;
  /** Seen through one of their eyes (lib/adult/framing.ts), once picked: whose; null, both in frame. */
  eyes?: Eyes | null;
  /** What the owner changed in its context before it was drawn (PictureEdit), and what a redraw cost them. */
  edit: PictureEdit | null;
  paid: number;
  /** Why its picture didn't come, in the owner's words (drawBeat). */
  fail_reason?: string | null;
  /** When it was drawn ahead (lib/adult/draw-ahead.ts), if it was. */
  ahead_at?: Date | string | null;
};

/**
 * What a scene picture is drawn from, as the owner sees it and can change it before it's drawn (David, 2026-10-25: "add
 * the context that will be sent, and allow additional context … what they are wearing and whether they are clothed, or
 * trash talking or flirting … more confidence the better"). Each is a guess from the night until the owner changes it,
 * and a change replaces the guess rather than being added to it.
 */
export type PictureFields = {
  /** What they're doing, from the last lines' actions. */
  happening: string;
  /** What they're wearing, by how far the night has gone. */
  wearing: string;
  /** Where they are, and what the place puts them in. */
  place: string;
  /** The mood: the chapter's roleplay and what the writer says they're doing (lib/adult/doing.ts). */
  mood: string;
};
/** The owner's changes: any of the fields, and anything else (which leads the picture, like their own words did). */
export type PictureEdit = Partial<PictureFields> & { extra?: string };
export const PICTURE_FIELD_MAX = 300;
const FIELDS = ["happening", "wearing", "place", "mood"] as const;

/** An edit as it's kept: each field trimmed and held to PICTURE_FIELD_MAX (anything else to SCENE_CUSTOM_MAX); null when empty. */
export function cleanEdit(e: unknown): PictureEdit | null {
  if (!e || typeof e !== "object") return null;
  const out: PictureEdit = {};
  for (const k of [...FIELDS, "extra"] as const) {
    const v = (e as Record<string, unknown>)[k];
    if (typeof v !== "string") continue;
    const t = v.trim().replace(/\s+/g, " ").slice(0, k === "extra" ? SCENE_CUSTOM_MAX : PICTURE_FIELD_MAX);
    if (t) out[k] = t;
  }
  return Object.keys(out).length ? out : null;
}

/** How the owner sees "what they're wearing", by how far the night has gone (the prompt keeps clothesAt's own words). */
const wearingAt = (stage: number): string =>
  stage >= SEX ? "Both nude" : stage >= UNDRESSING ? "Half undressed" : "Both fully clothed, tops on and done up";

/**
 * The positions, as the lines name them, each the act it's drawn as: most specific first (going down before the rest,
 * a lap before on top). Plain words only, the way lib/adult/stage-floor.ts reads a stage.
 */
const POSITIONS: readonly (readonly [string, RegExp])[] = [
  ["oral", /\b(go(?:es|ing)? down on|eat(?:s|ing)? (?:her|him) out|(?:his|her) (?:mouth|tongue) (?:on|between|finds?)|takes? (?:him|her) in (?:his|her) mouth|lick(?:s|ing)? (?:her|him)\b|suck(?:s|ing)? (?:him|his)\b)/],
  ["behind", /\b(from behind|bends? (?:her|him) over|bent over|on (?:her|his|their) (?:hands and )?knees|doggy)/],
  ["spooning", /\b(spoon(?:s|ing|ed)?|on (?:their|her|his) sides?)\b/],
  ["lap", /\b(in(?:to)? (?:his|her) lap|on (?:his|her) lap)\b/],
  // 2026-10-26, Chud × Sweet: "slides her leg over his hips, settling against him" and "rises up slightly, then sinks
  // down, taking him inside her" were both drawn with him on top.
  [
    "on_top",
    /\b(on top of (?:him|her)|rid(?:es|ing) (?:him|her)\b|straddl\w*|astride|sinks? (?:down )?onto (?:him|her)|sinks? down,? taking (?:him|her)|climbs? (?:on top|onto (?:him|her))|(?:slides?|swings?|throws?) (?:her|his|a) leg over (?:his|her) (?:hips|waist)|settles? (?:on top|astride))/,
  ],
  ["face_to_face", /\b(missionary|on (?:her|his) back\b|pins? (?:her|him) (?:to|against|into) the (?:bed|mattress|sheets)|pin(?:s|ning|ned)? [\w'-]+ (?:beneath|under(?:neath)?) (?:him|her)|wraps? (?:her|his) legs around)/],
];

/**
 * A line that's after it, not a new position (2026-10-26, Coco × Sweet: "pulling Sweet into her lap on the floor,
 * wrapping an arm around her waist", once it was over, was drawn as sex in a lap on the edge of a bed).
 */
const AFTERGLOW =
  /\b(collaps(?:es|ed|ing)|afterglow|catch(?:es|ing)? (?:her|his|their) breath|breathing (?:slowly )?even(?:s|ing)? out|lying together|lie together|rests? (?:her|his) head on|head on (?:her|his) chest|curls? (?:up )?against|nuzzl(?:es|ing) (?:into|closer)|go(?:es)? limp|went limp|sweat cooling)\b/;
export const afterglowIn = (text: string): boolean => AFTERGLOW.test(text.toLowerCase().replace(/’/g, "'"));

/** The position a line plainly shows (an act id), or null. */
export function positionIn(text: string): string | null {
  const t = text.toLowerCase().replace(/’/g, "'");
  for (const [act, re] of POSITIONS) if (re.test(t)) return act;
  return null;
}

/** What the page calls a beat. */
export function beatLabel(kind: BeatKind, act: string): string {
  const name = actById(act)?.label ?? "This moment";
  if (kind === "undressing") return "Undressing";
  if (kind === "sex") return `Sex: ${name.toLowerCase()}`;
  if (kind === "position") return `A new position: ${name.toLowerCase()}`;
  if (kind === "climax") return "The climax";
  if (kind === "afterglow") return "The afterglow";
  if (kind === "chapter") return "This chapter";
  if (kind === "asked") return "The picture they asked for";
  return name;
}

/**
 * The moments in a chapter's new lines (from `from` on), given those it already has: undressing when they get to it,
 * sex when it starts (in the position its first lines name, else face to face), each position it moves to, the climax,
 * and the afterglow a few lines after it. `before` is the stage the scene stood at before line `from` when that line has
 * none before it. `allowed` leaves out an act the pair's limits rule out. Pure.
 */
export function findBeats(
  lines: readonly { text: string; stage?: number; doing?: string }[],
  from: number,
  before: number,
  existing: readonly Pick<FoundBeat, "act" | "kind" | "line">[],
  allowed: (act: string) => boolean = () => true,
): FoundBeat[] {
  const found: FoundBeat[] = [];
  const all = () => [...existing, ...found];
  const has = (kind: BeatKind) => all().some((b) => b.kind === kind);
  const room = () => all().filter((b) => b.kind !== "chosen").length < BEATS_PER_CHAPTER;
  const add = (b: FoundBeat) => {
    if (room() && allowed(b.act)) found.push(b);
  };
  let position = [...existing].reverse().find((b) => b.kind === "sex" || b.kind === "position")?.act ?? null;
  let climaxAt = existing.find((b) => b.kind === "climax")?.line ?? null;
  let prev = from > 0 ? (lines[from - 1].stage ?? before) : before;
  for (let i = Math.max(0, from); i < lines.length; i++) {
    const stage = lines[i].stage ?? prev;
    const text = lines[i].text;
    if (prev < UNDRESSING && stage === UNDRESSING && !has("undressing")) add({ line: i, act: "undress", kind: "undressing", stage });
    if (prev < SEX && stage >= SEX && !has("sex")) {
      // The position its first lines name, else face to face.
      const named = lines.slice(i, i + 3).map((l) => positionIn(l.text)).find(Boolean) ?? null;
      position = named && allowed(named) ? named : "face_to_face";
      add({ line: i, act: position, kind: "sex", stage });
    } else if (stage >= SEX) {
      const named = afterglowIn(text) ? null : positionIn(text);
      if (named && named !== position && allowed(named) && !all().some((b) => (b.kind === "sex" || b.kind === "position") && b.act === named)) {
        position = named;
        add({ line: i, act: named, kind: "position", stage });
      }
    }
    if (stage >= UNDRESSING && climaxIn(text, lines[i].doing) && !has("climax")) {
      add({ line: i, act: position ?? "face_to_face", kind: "climax", stage: Math.max(stage, SEX) });
      climaxAt = i;
    }
    if (climaxAt !== null && i >= climaxAt + AFTERGLOW_AFTER && !has("afterglow")) add({ line: i, act: "afterglow", kind: "afterglow", stage: Math.max(stage, SEX) });
    prev = stage;
  }
  return found;
}

/**
 * A still's bed, where the place isn't one: "On a bed, having sex…" in a kitchen becomes "Having sex…", and "sits on the
 * edge of a bed" in a ballroom just sits.
 */
export function poseHere(pose: string, place: string | null): string {
  // A bed's there in a bedroom, a hotel, a room of one's own; not in a living room (2026-10-26: "On a bed" in Sweet's).
  if (!place || (/\b(bed|bedroom|bunk|hotel|motel|suite|room)\b/i.test(place) && !/\b(living|dining|sitting|drawing|waiting|throne|ball|board|class|changing|green|reading|music|games?|tea|bath|laundry)\s*room\b/i.test(place))) return pose;
  const cut = pose.replace(/^(?:On a bed|In bed)[,:]\s*/i, "").replace(/ on the edge of a bed\b/gi, "");
  return cut === pose ? pose : `${cut.charAt(0).toUpperCase()}${cut.slice(1)}`;
}

/**
 * A beat's still: the act's (who is where, both faces visible), where they are, and what was happening in the lines
 * just before it, their names taken out. A moment that wouldn't pass David's lines or the pair's limits is left out,
 * and the act's own words are kept. Null when even the act's words wouldn't. Pure.
 */
export function beatFrame(
  beat: Pick<FoundBeat, "act" | "kind">,
  cast: readonly [ReelPerson, ReelPerson],
  moment: readonly { text: string }[],
  place: string | null,
  limits: Pick<MediaLimits, "hit">,
  /** The owner's own "what's happening" (PictureEdit), in place of the lines'. */
  happeningOwn?: string,
  /**
   * The mood (the roleplay, what they're doing), before what's happening: a prompt cut short loses the end, and the
   * lines' actions are the least of it (2026-10-26: "The mood: The vampire's invitation - the The place:").
   */
  mood?: string,
  /** Seen through one of their eyes: the act's first-person still (it frames itself). */
  eyes?: Eyes | null,
): string | null {
  const act = actById(beat.act);
  if (!act) return null;
  const pov = eyes ? povFor(act, cast, eyes) : null;
  const pose = poseHere(pov?.still ?? actFor(act, cast).pose, place);
  const peak = beat.kind === "climax" ? (pov ? " At the peak, face flushed, eyes closed." : " Both of them at the peak, faces flushed, eyes closed.") : "";
  const ok = (words: string) => checkAdultText({ words }).ok && !crossesTaboo(words) && !limits.hit(words);
  const felt = mood ? withoutNames(mood, cast).replace(/[.\s]+$/, "") : "";
  const base = `${pose}${peak}${pov ? "" : ` ${FRAMING_WORDS[act.framing]}`}${felt && ok(felt) ? ` The mood: ${felt}.` : ""}`;
  if (!ok(base)) return null;
  const happening = withoutNames(happeningOwn ?? recentActions([...moment], 3).join("; "), cast).replace(/[.\s]+$/, "");
  return happening && ok(happening) ? `${base} What is happening: ${happening}.` : base;
}

const publicBeat = (r: BeatRow): PublicBeat => ({ id: r.id, line: r.line, kind: r.kind, act: r.act, label: beatLabel(r.kind, r.act), status: r.status, picture_id: r.picture_id, ...(r.status === "failed" && r.fail_reason ? { reason: r.fail_reason } : {}) });

/** Whether beat pictures can be made: the setting on, and the provider's and Hive's keys saved. */
export async function beatPicturesReady(db: Db): Promise<boolean> {
  const settings = await getAdultSettings(db);
  if (!settings.beat_pictures) return false;
  const keys = await adultKeys(db);
  return Boolean(settings.media_provider === "replicate" ? keys.replicate : keys.venice) && (await checkReady(db));
}

/** The running chapter's beats, for the page (filed chapters' beats have their night). */
export async function chapterBeats(db: Db, sceneId: string, chapter: number): Promise<PublicBeat[]> {
  const { rows } = await db.query<BeatRow>(`select * from adult_beats where scene_id = $1 and chapter = $2 and night_id is null order by line, created_at`, [sceneId, chapter]);
  return rows.map(publicBeat);
}

/** What a step's new lines need to be read for beats: the scene, its pair, the chapter's lines and where they stood. */
export type BeatScene = {
  id: string;
  owner: string;
  a: string;
  b: string;
  chapter: number;
  lines: readonly { text: string; stage?: number; moved_to?: string }[];
  /** The first new line, the stage before it, and where they were before it and are now. */
  from: number;
  before: number;
  placeBefore: string | null;
  placeNow: string | null;
};

/**
 * Finds the new lines' beats and keeps them (offered). Never fails the step: a problem is logged and nothing is offered.
 * Nothing is found while beat pictures are off.
 */
export async function recordBeats(db: Db, scene: BeatScene, cast?: [Character | null, Character | null]): Promise<void> {
  try {
    if (!(await beatPicturesReady(db))) return;
    const { rows } = await db.query<BeatRow>(`select * from adult_beats where scene_id = $1 and chapter = $2 and night_id is null`, [scene.id, scene.chapter]);
    const limits = await mediaLimits(db, scene.owner, scene.a, scene.b);
    const [ca, cb] = cast ?? [await loadCharacter(db, scene.a), await loadCharacter(db, scene.b)];
    const people = ca && cb ? reelCast(ca, cb, scene.owner) : null;
    const allowed = (id: string) => {
      const act = actById(id);
      return Boolean(act && act.minStage <= limits.maxStage && (!people || !actRuledOut(act, people, limits)));
    };
    const found = findBeats(scene.lines, scene.from, scene.before, rows, allowed);
    // Where each was: before a line that agreed to go somewhere, where they were; after it, where they are now.
    const movedAt = scene.lines.findIndex((l, i) => i >= scene.from && l.moved_to);
    const added: { id: string; line: number }[] = [];
    for (const f of found) {
      const place = movedAt >= 0 && f.line > movedAt ? scene.placeNow : movedAt >= 0 ? scene.placeBefore : scene.placeNow;
      const id = crypto.randomUUID();
      await db.query(
        `insert into adult_beats (id, owner_id, scene_id, character_a, character_b, chapter, line, act, kind, stage, place) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [id, scene.owner, scene.id, scene.a, scene.b, scene.chapter, f.line, f.act, f.kind, f.stage, place],
      );
      added.push({ id, line: f.line });
    }
    // Drawn ahead, when the viewer chose it for this pair (lib/adult/draw-ahead.ts): each new moment starts drawing now,
    // while the lines before it play, so it's on the stage when its line comes.
    if (added.length) await drawAheadNow(db, scene, added.map((b) => b.id), siteUrl());
  } catch (err) {
    console.warn(`[after-dark] the chapter's moments couldn't be read: ${err instanceof Error ? err.message.slice(0, 160) : "error"}`);
  }
}

/**
 * Draw ahead (lib/adult/draw-ahead.ts): these moments of the running chapter start drawing now, earliest first, within
 * the chapter's budget while it's drawn ahead (its price taken first, once a chapter). Never paid for when its pictures
 * can't come: beat pictures off, the pair not set up, or the month's pictures had. How many started.
 */
export async function drawAheadNow(db: Db, scene: Pick<BeatScene, "id" | "owner" | "a" | "b" | "chapter">, ids: readonly string[], baseUrl: string): Promise<number> {
  if (!ids.length || !(await beatPicturesReady(db))) return 0;
  if ((await picturesBlocked(db, scene.owner, scene.a, scene.b)) || (await overCap(db, scene.owner, "pictures"))) return 0;
  const budget = await aheadBudget(db, scene.id, scene.chapter);
  if (budget === null) return 0;
  const waiting = (await db.query<{ id: string }>(`select id from adult_beats where id = any($1) and night_id is null and status in ('offered', 'later') order by line`, [ids])).rows;
  const fits: string[] = [];
  for (const b of waiting) {
    if (!(await claimChapterPicture(db, scene.id, scene.chapter, `${scene.chapter}#beat:${b.id}`, budget))) break;
    fits.push(b.id);
  }
  if (!fits.length) return 0;
  const { rows } = await db.query<BeatRow>(`update adult_beats set status = 'drawing', ahead_at = now() where id = any($1) and status in ('offered', 'later') returning *`, [fits]);
  await countAhead(db, scene.id, rows.length);
  drawLater(db, rows.sort((x, y) => x.line - y.line), baseUrl);
  return rows.length;
}

/** The running chapter's moments still waiting from line `from` on (Draw ahead turned on: lib/adult/draw-ahead.ts). */
export async function waitingBeats(db: Db, sceneId: string, chapter: number, from: number): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(`select id from adult_beats where scene_id = $1 and chapter = $2 and night_id is null and line >= $3 and status in ('offered', 'later')`, [sceneId, chapter, from]);
  return rows.map((r) => r.id);
}

/** The lines a beat was found in: the running scene's, or the saved night's its chapter was filed as. */
async function beatLines(db: Db, beat: BeatRow): Promise<{ text: string }[]> {
  const row = beat.night_id
    ? (await db.query<{ lines: { text: string }[] }>(`select lines from adult_nights where id = $1 and owner_id = $2`, [beat.night_id, beat.owner_id])).rows[0]
    : (await db.query<{ lines: { text: string }[] }>(`select lines from adult_scenes where id = $1 and owner_id = $2`, [beat.scene_id, beat.owner_id])).rows[0];
  return row?.lines ?? [];
}

const pending = new Set<Promise<unknown>>();
/** Waits for the beat pictures still drawing (tests). */
export async function beatPicturesSettled(): Promise<void> {
  while (pending.size) await Promise.allSettled([...pending]);
}

/** A scene picture planned: the fields the owner sees, and the prompt they make (with the place's set as Picture 3, or not). */
export type PicturePlan =
  | { ok: true; fields: PictureFields; edit: PictureEdit | null; prompt: string; promptFor: (withSet: boolean, older?: boolean) => string; characters: [Character, Character]; stage: number; act: string; eyes: Eyes | null }
  | { ok: false; status: number; message: string };

/**
 * Plans a beat's picture: what the night says (the fields) and, with the owner's changes over it, the prompt. Shared by
 * the drawing, the preview (nothing drawn) and a redraw, so what the owner sees is what's sent. Pure apart from reads.
 */
export async function planBeat(
  db: Db,
  beat: Pick<BeatRow, "owner_id" | "scene_id" | "character_a" | "character_b" | "chapter" | "line" | "act" | "kind" | "stage" | "place" | "night_id" | "custom" | "dialog" | "eyes">,
  edit: PictureEdit | null,
): Promise<PicturePlan> {
  const [ca, cb] = await Promise.all([loadCharacter(db, beat.character_a), loadCharacter(db, beat.character_b)]);
  if (!ca || !cb) return { ok: false, status: 404, message: "One of them is missing." };
  // Never a picture of a character nobody has set up: it would only be a guess (lib/adult/readiness.ts).
  const blocked = await picturesBlocked(db, beat.owner_id, beat.character_a, beat.character_b);
  if (blocked) return { ok: false, status: 409, message: blocked };
  const cast = reelCast(ca, cb, beat.owner_id);
  const limits = await mediaLimits(db, beat.owner_id, beat.character_a, beat.character_b);
  const lines = (await beatLines(db, beat as BeatRow)) as { who: "a" | "b"; text: string; doing?: string }[];
  const moment = lines.slice(Math.max(0, beat.line - MOMENT_LINES + 1), beat.line + 1);
  const act = actById(beat.act);
  const stage = Math.max(beat.stage, act?.dress ?? 0);
  // What the night says, field by field.
  const roleplay = await chapterRoleplay(db, beat, { a: ca.name, b: cb.name });
  // What each of them wears, from their own looks, until they undress (one context for every picture).
  const situation = await situationOf(db, beat.owner_id, beat.place);
  const publicPlace = isPublicPlace(beat.place) || Boolean(situation);
  const worn = wornOf([ca, cb], beat.owner_id, stage, publicPlace);
  const outfits = stage >= UNDRESSING || !worn ? null : cast.map((who, i) => `${i === 0 ? who.tag.charAt(0).toUpperCase() + who.tag.slice(1) : who.tag} in ${worn[i] ?? "everyday clothes"}`).join("; ");
  const fields: PictureFields = {
    happening: recentActions([...moment], 3).join("; "),
    wearing: outfits ?? wearingAt(stage),
    place: withSituation(beat.place, situation),
    mood: [roleplay?.title, moment.at(-1)?.doing].filter(Boolean).join(" · "),
  };
  // What the chapter says at the moment, read once (lib/adult/picture-brief.ts; David, 2026-10-29): where they are, what
  // each has on (a costume, what's come off), what's happening and the mood, over the guess from the last lines' actions
  // and their looks. A field it couldn't say within the lines and the pair's limits keeps the guess.
  const brief = await pictureBrief(
    db,
    {
      owner: beat.owner_id,
      scene: beat.scene_id,
      night: beat.night_id,
      chapter: beat.chapter,
      lines: lines.slice(0, beat.line + 1).map((l) => ({ who: l.who, text: l.text })),
      names: { a: ca.name, b: cb.name },
      pronouns: { a: ca.pronouns ?? null, b: cb.pronouns ?? null },
      usual: worn ? `${ca.name}: ${worn[0] ?? "everyday clothes"}; ${cb.name}: ${worn[1] ?? "everyday clothes"}` : null,
      place: fields.place,
      roleplay: roleplay?.words ?? null,
      dressed: wearingAt(stage),
      shows: beatLabel(beat.kind, beat.act),
    },
    (w) => checkAdultText({ words: w }).ok && !crossesTaboo(w) && !limits.hit(w),
  );
  if (brief) {
    if (brief.happening) fields.happening = brief.happening;
    if (brief.wearing) fields.wearing = brief.wearing;
    if (brief.place) fields.place = brief.place;
    if (brief.mood) fields.mood = [roleplay?.title, brief.mood].filter(Boolean).join(" · ");
  }
  // The owner's changes, held to the lines and the pair's limits like everything drawn.
  const own = cleanEdit(edit);
  const words = own ? Object.values(own).join(" ") : "";
  if (words && !(guideSafe([words]) && !limits.hit(words))) return { ok: false, status: 422, message: "That crosses one of the lines After Dark never crosses, or one of your limits." };
  // Whose eyes it's seen through: kept once picked; else picked now, where the act has a view and it does clearly better
  // that way for this viewer (lib/adult/framing.ts), from their own character's eyes when that's one of the views.
  const eyes = beat.eyes !== undefined && beat.eyes !== null ? beat.eyes : act ? await pickEyes(db, beat.owner_id, act, cast, [ca, cb]) : null;
  const framed = beatFrame(beat, cast, moment, beat.place, limits, own?.happening ?? (brief?.happening || undefined), own?.mood ?? fields.mood, eyes);
  if (!framed) return { ok: false, status: 422, message: "That moment crosses one of the lines." };
  const place = own?.place ?? fields.place;
  const where = place ? placeWords(place, cast) : null;
  // What they wear: the owner's own words, else the brief's, else their own outfits (stage clothes words past them, clothesAt).
  const clothes = own?.wearing ?? briefClothes(brief, stage) ?? (outfits ? `${outfits}, both fully clothed` : undefined);
  const custom = [own?.extra, beat.custom].filter(Boolean).join(". ") || undefined;
  const opts = { explicit: limits.explicit, custom, dialog: beat.dialog ?? undefined, ...(clothes ? { clothes: withoutNames(clothes, cast) } : {}) };
  // `older`: the second try after an age check read one of them as young (drawBeat).
  const promptFor = (withSet: boolean, older = false) => {
    const o = older ? { ...opts, older: OLDER_WORDS } : opts;
    return eyes ? povPrompt(cast, eyes, framed, where, stage, withSet, o) : keyframePrompt(cast, framed, where, stage, withSet, o);
  };
  return { ok: true, fields, edit: own, prompt: promptFor(false), promptFor, characters: [ca, cb], stage, act: beat.act, eyes };
}

/**
 * Whose eyes a beat picture is seen through, if anyone's: where the act has a first-person view and it does clearly
 * better than both in frame for this viewer (lib/adult/framing.ts chooseView), the view from their own character's
 * eyes when there is one, else the other's; null, both in frame.
 */
async function pickEyes(db: Db, owner: string, act: NonNullable<ReturnType<typeof actById>>, cast: readonly [ReelPerson, ReelPerson], people: readonly [Character, Character]): Promise<Eyes | null> {
  const seats = (["a", "b"] as const).filter((e) => povFor(act, cast, e));
  if (!seats.length) return null;
  const scores = await framingScores(db, owner).catch(() => null);
  if (!scores || chooseView(scores, act.id, true) !== "pov") return null;
  const mine = seats.find((e) => people[e === "a" ? 0 : 1].ownerId === owner);
  return mine ?? seats[0];
}

/** What a place puts them in: a library venue's own words, or one of the owner's own places' (lib/studio/library.ts). */
async function situationOf(db: Db, owner: string, place: string | null): Promise<string | null> {
  return venueSituation(place) ?? (await ownPlaceSituation(db, owner, place).catch(() => null));
}
/** The place, and what it puts them in, said once ("an awkward double date with a smug couple…", not the name twice). */
function withSituation(place: string | null, situation: string | null): string {
  if (!place) return "";
  if (!situation) return place;
  return situation.toLowerCase().startsWith(place.toLowerCase()) ? situation : `${place}: ${situation}`;
}

/**
 * What each of them wears, from their own looks (lib/looks.ts looksPictureWords), by common sense: what they wear out in
 * public or before it's gone past flirting, After Dark's outfit (the owner's own pick) somewhere private from kissing
 * on: "a fitted white t-shirt and blue jeans". Null when neither has an outfit picked (then the stage's words: wearingAt).
 */
function wornOf(people: readonly [Character, Character], owner: string, stage: number, publicPlace: boolean): [string | null, string | null] | null {
  const worn = people.map((c) => {
    const p = looksPictureWords(c.extras?.looks, c.ownerId === owner);
    return publicPlace || stage < 2 ? p.everyday : (p.outfit ?? p.everyday);
  }) as [string | null, string | null];
  return worn.some(Boolean) ? worn : null;
}

/**
 * What the brief says they wear, as a picture's clothes words: dressed as it says before they undress (still dressed),
 * as it says while they undress, and once they're naked only what it says is still on (else the stage's own words,
 * which spell out that nothing from their pictures stays on: clothesAt).
 */
export function briefClothes(b: Pick<Brief, "wearing" | "kept_on"> | null, stage: number): string | undefined {
  if (!b) return undefined;
  if (stage >= SEX) return b.kept_on ? `both completely naked apart from ${b.kept_on.replace(/[.\s]+$/, "")}, none of the other clothes from their pictures` : undefined;
  if (!b.wearing) return undefined;
  return stage >= UNDRESSING ? b.wearing : `${b.wearing.replace(/[.\s]+$/, "")}, both still dressed`;
}

/**
 * The chapter's roleplay: its title, for the mood, and its premise with who plays whom, for the brief (the running
 * chapter's only: a filed night doesn't keep it).
 */
async function chapterRoleplay(db: Db, beat: Pick<BeatRow, "scene_id" | "owner_id" | "chapter" | "night_id">, names: { a: string; b: string }): Promise<{ title: string; words: string } | null> {
  if (beat.night_id) return null;
  const row = (await db.query<{ roleplay: { id?: string; chapter?: number; swap?: boolean } | null; chapter: number }>(`select roleplay, chapter from adult_scenes where id = $1 and owner_id = $2`, [beat.scene_id, beat.owner_id])).rows[0];
  const id = row?.roleplay?.id;
  if (!id || row.roleplay?.chapter !== beat.chapter) return null;
  const rp = roleplayById(id) ?? (await ownRoleplay(db, beat.owner_id, id).catch(() => null));
  if (!rp) return null;
  const first = (n: string) => n.split(/\s+/)[0];
  const swap = Boolean(row.roleplay?.swap);
  const [x, y] = (swap ? [names.b, names.a] : [names.a, names.b]).map(first);
  const roles = rolesLine(rp, { a: first(names.a), b: first(names.b) }, swap);
  return { title: rp.title, words: `${rp.title}. ${rp.premise.replaceAll("{a}", x).replaceAll("{b}", y)}${roles ? ` ${roles}.` : ""}` };
}

/** An age check's refusal: someone in the picture could be under 18, or it couldn't tell. */
export const ageRefused = (why: string): boolean => /age check[^)]*\b(?:MINOR|UNSURE|minor)\b|under 18/i.test(why);

/**
 * What a picture's prompt adds on its second try after an age check refused it (David, 2026-10-26: "proper error handling
 * if they flag as too young"): both drawn plainly as the adults they are. The same check runs on the new picture, and
 * only ADULTS passes; this never lowers the bar, it only asks the picture model not to draw them young.
 */
export const OLDER_WORDS =
  "Both are grown adults, clearly in their late twenties or older: mature adult faces and bodies, adult proportions, nothing youthful or childlike about either of them.";

/**
 * Which of them an age check most likely read as young, to name in the note: the younger, else one drawn in an anime
 * style (it reads young), else the owner's own (the house cast is reviewed). Null when nothing points either way.
 */
export function youngerLooking(people: readonly [Character, Character], owner: string): Character | null {
  const [a, b] = people;
  if (a.age !== b.age) return a.age < b.age ? a : b;
  const anime = people.filter((c) => (c.extras?.looks as { style?: string } | undefined)?.style === "anime");
  if (anime.length === 1) return anime[0];
  const own = people.filter((c) => c.ownerId === owner);
  return own.length === 1 ? own[0] : null;
}

/** The owner's note when the age check refused both tries: who, what was given back, and what fixes it. */
export function ageRefusalNote(people: readonly [Character, Character], owner: string, refunded: number, retried: boolean): string {
  const who = youngerLooking(people, owner);
  const back = refunded > 0 ? ` The ${refunded === 1 ? "token is" : "tokens are"} back.` : "";
  const again = retried ? ", even drawn again older" : "";
  if (!who) return `The age check couldn't tell that both of them are adults, so the picture wasn't kept${again}.${back} A more mature face in the Studio for either of them fixes it.`;
  const studio = who.ownerId === owner ? ` Open ${who.name}'s Studio: Identity → Older-looking faces, then Use this face (or give ${who.name} an older age). Every picture is drawn from it.` : "";
  return `The age check read ${who.name} as possibly under 18, so the picture wasn't kept${again}.${back}${studio}`;
}

/** Draws one beat's picture and keeps it, or marks it failed with why (and gives back what a redraw cost). */
async function drawBeat(db: Db, beat: BeatRow, baseUrl: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  let people: [Character, Character] | null = null;
  // Whether a second picture, drawn older, was actually made (a refused face picture makes none: the note says so).
  let retried = false;
  const fail = async (why: string) => {
    console.warn(`[after-dark] a beat picture didn't come (${beat.kind}, chapter ${beat.chapter}): ${why.slice(0, 160)}`);
    const refunded = beat.paid;
    // One drawn ahead that didn't come doesn't count as drawn ahead: a chapter with none gives its tokens back.
    if (beat.ahead_at) await countAhead(db, beat.scene_id, -1, beat.ahead_at).catch(() => {});
    if (beat.paid > 0) {
      await refundBoughtTokens(db, beat.owner_id, beat.paid).catch(() => {});
      await db.query(`update adult_beats set paid = 0 where id = $1`, [beat.id]);
    }
    // The page says why (PublicBeat.reason); an age refusal also says it on the scene, where the theater shows its problems.
    const said = ageRefused(why) && people ? ageRefusalNote(people, beat.owner_id, refunded, retried) : why;
    await db.query(`update adult_beats set status = 'failed', fail_reason = $2 where id = $1`, [beat.id, said.slice(0, 400)]);
    if (ageRefused(why) && people && !beat.night_id) await db.query(`update adult_scenes set picture_note = $2 where id = $1`, [beat.scene_id, said]).catch(() => {});
    return { ok: false as const, reason: why };
  };
  try {
    const settings = await getAdultSettings(db);
    const keys = await adultKeys(db);
    const gate = await mediaGate(db, { owner: beat.owner_id });
    if (!gate.ok) return fail(gate.reason);
    const capped = await overCap(db, beat.owner_id, "pictures");
    if (capped) return fail(capped);
    const plan = await planBeat(db, beat, beat.edit);
    if (!plan.ok) return fail(plan.message);
    const [ca, cb] = plan.characters;
    people = [ca, cb];
    const stage = plan.stage;
    const reject = (reason: string) =>
      db.query(`insert into adult_rejections (id, owner_id, kind, reason) values ($1, $2, 'scene', $3)`, [crypto.randomUUID(), beat.owner_id, `beat picture: ${reason}`.slice(0, 300)]).catch(() => {});
    const draw = (promptFor: (withSet: boolean) => string) =>
      keepPictureOfBoth(
        db,
        beat.owner_id,
        [ca, cb],
        { place: beat.place, stage, promptFor, act: plan.act, ...(plan.eyes ? { eyes: plan.eyes } : {}) },
        { keys, settings, baseUrl, reject, scene: { chapter: beat.chapter, place: beat.place } },
      );
    let kept = await draw(plan.promptFor);
    // An age check read one of them as young: once more, drawn plainly older, through the same check (OLDER_WORDS).
    if (!kept.ok && kept.error === "discarded" && ageRefused(kept.message)) {
      kept = await draw((withSet) => {
        retried = true;
        return plan.promptFor(withSet, true);
      });
    }
    if (!kept.ok) return fail(kept.message);
    await db.query(`update adult_beats set status = 'drawn', picture_id = $2, eyes = $3 where id = $1`, [beat.id, kept.picture.id, plan.eyes]);
    return { ok: true as const };
  } catch (err) {
    return fail(err instanceof Error ? err.message : "error");
  }
}

/** Starts drawing beats one after another after the response (Hive rate-limits a burst). */
function drawLater(db: Db, beats: readonly BeatRow[], baseUrl: string): void {
  if (!beats.length) return;
  inBackground(() => {
    const work = (async () => {
      for (const b of beats) await drawBeat(db, b, baseUrl);
    })();
    pending.add(work);
    void work.finally(() => pending.delete(work));
    return work;
  });
}

/** Claims beats for drawing (offered or later → drawing), returning those this call claimed. */
async function claim(db: Db, where: string, params: unknown[]): Promise<BeatRow[]> {
  const { rows } = await db.query<BeatRow>(`update adult_beats set status = 'drawing' where ${where} and status in ('offered', 'later') returning *`, params);
  return rows;
}

export type BeatAnswer = { ok: true; beat: PublicBeat } | { ok: false; status: number; message: string };

/**
 * The viewer's answer to an offered beat: "now" draws it (after the response; it lands in the gallery), "later" leaves it
 * for them to pick their moment, or for the chapter's close.
 */
export async function answerBeat(db: Db, ownerId: string, beatId: string, answer: "now" | "later", baseUrl: string, guide: { custom?: string; dialog?: string; edit?: unknown } = {}): Promise<BeatAnswer> {
  const row = (await db.query<BeatRow>(`select * from adult_beats where id = $1 and owner_id = $2`, [beatId, ownerId])).rows[0];
  if (!row) return { ok: false, status: 404, message: "That moment isn't there any more." };
  if (answer === "later") {
    const { rows } = await db.query<BeatRow>(`update adult_beats set status = 'later' where id = $1 and status = 'offered' returning *`, [row.id]);
    return { ok: true, beat: publicBeat(rows[0] ?? row) };
  }
  if (!(await beatPicturesReady(db))) return { ok: false, status: 409, message: "Beat pictures are off, or the picture keys aren't saved, in After Dark's settings." };
  const notReady = await picturesBlocked(db, ownerId, row.character_a, row.character_b);
  if (notReady) return { ok: false, status: 409, message: notReady };
  // The owner's own words for this moment, if they gave any, lead the picture (held to the lines first).
  const custom = cleanWords(guide.custom, SCENE_CUSTOM_MAX);
  const dialog = cleanWords(guide.dialog, SCENE_DIALOG_MAX);
  if (!guideSafe([custom, dialog])) return { ok: false, status: 422, message: "That crosses one of the lines After Dark never crosses." };
  // The owner's changes to its context (PictureEdit), checked as the picture would use them before anything's drawn.
  const edit = cleanEdit(guide.edit);
  if (edit) {
    const plan = await planBeat(db, { ...row, custom, dialog }, edit);
    if (!plan.ok) return { ok: false, status: plan.status, message: plan.message };
  }
  if (custom || dialog || edit) await db.query(`update adult_beats set custom = $2, dialog = $3, edit = $4::jsonb where id = $1`, [row.id, custom, dialog, edit ? JSON.stringify(edit) : null]);
  const claimed = await claim(db, "id = $1", [row.id]);
  drawLater(db, claimed, baseUrl);
  return { ok: true, beat: publicBeat(claimed[0] ?? row) };
}

/**
 * Picture this: the viewer picks the moment, at a line of the running chapter. The latest beat at or before it that's
 * still waiting is drawn; with none, the moment itself is, as the act its position or stage says.
 */
/** The owner's own words for a scene picture (David, 2026-10-24: "we need more specifics"). */
export const SCENE_CUSTOM_MAX = 400;
export const SCENE_DIALOG_MAX = 200;
const cleanWords = (s: string | undefined, max: number): string | null => {
  const t = (s ?? "").trim().replace(/\s+/g, " ").slice(0, max);
  return t || null;
};
/** The owner's own words are held to David's lines, like everything else drawn. */
const guideSafe = (words: (string | null)[]): boolean => {
  const text = words.filter(Boolean).join(" ");
  return !text || (checkAdultText({ words: text }).ok && !crossesTaboo(text));
};

export async function pictureNow(
  db: Db,
  ownerId: string,
  scene: { id: string; a: string; b: string; chapter: number; lines: readonly { text: string; stage?: number }[]; stage: number; place: string | null },
  line: number,
  baseUrl: string,
  guide: { custom?: string; dialog?: string; edit?: unknown } = {},
  /** `paid`: what this picture cost (given back if it doesn't come); `fresh`: never reuse a waiting moment (a redraw). */
  opts: { paid?: number; fresh?: boolean } = {},
): Promise<BeatAnswer> {
  if (!(await beatPicturesReady(db))) return { ok: false, status: 409, message: "Beat pictures are off, or the picture keys aren't saved, in After Dark's settings." };
  const notReady = await picturesBlocked(db, ownerId, scene.a, scene.b);
  if (notReady) return { ok: false, status: 409, message: notReady };
  const at = Math.max(0, Math.min(line, scene.lines.length - 1));
  if (!scene.lines.length) return { ok: false, status: 409, message: "Let the night start first." };
  const custom = cleanWords(guide.custom, SCENE_CUSTOM_MAX);
  const dialog = cleanWords(guide.dialog, SCENE_DIALOG_MAX);
  if (!guideSafe([custom, dialog])) return { ok: false, status: 422, message: "That crosses one of the lines After Dark never crosses." };
  const edit = cleanEdit(guide.edit);
  // A moment already offered for this line is reused — unless the owner gave their own words, which get a fresh picture.
  if (!custom && !dialog && !edit && !opts.fresh) {
    const waiting = (
      await db.query<BeatRow>(
        `select * from adult_beats where scene_id = $1 and chapter = $2 and night_id is null and line <= $3 and status in ('offered', 'later') order by line desc limit 1`,
        [scene.id, scene.chapter, at],
      )
    ).rows[0];
    if (waiting) {
      const claimed = await claim(db, "id = $1", [waiting.id]);
      drawLater(db, claimed, baseUrl);
      return { ok: true, beat: publicBeat(claimed[0] ?? waiting) };
    }
  }
  const { act, stage } = chosenAt(scene, at);
  if (edit) {
    const plan = await planBeat(db, { owner_id: ownerId, scene_id: scene.id, character_a: scene.a, character_b: scene.b, chapter: scene.chapter, line: at, act, kind: "chosen", stage, place: scene.place, night_id: null, custom, dialog }, edit);
    if (!plan.ok) return { ok: false, status: plan.status, message: plan.message };
  }
  const { rows } = await db.query<BeatRow>(
    `insert into adult_beats (id, owner_id, scene_id, character_a, character_b, chapter, line, act, kind, stage, place, status, custom, dialog, edit, paid) values ($1, $2, $3, $4, $5, $6, $7, $8, 'chosen', $9, $10, 'drawing', $11, $12, $13::jsonb, $14) returning *`,
    [crypto.randomUUID(), ownerId, scene.id, scene.a, scene.b, scene.chapter, at, act, stage, scene.place, custom, dialog, edit ? JSON.stringify(edit) : null, opts.paid ?? 0],
  );
  drawLater(db, rows, baseUrl);
  return { ok: true, beat: publicBeat(rows[0]) };
}

/**
 * A night's own picture, drawn like every other scene picture (one context, from their faces: planBeat, keepPictureOfBoth)
 * rather than from words alone (David, 2026-10-25: "look at the flow and prompts and data … and tighten it up"): the
 * chapter's and a new place's (lib/adult/auto-pictures.ts, kind "chapter"), and one the lines asked for ("asked", its
 * description leading it). Kept as a beat at the scene's latest line, so it can be redrawn with its moment. Drawn now;
 * the reason when it doesn't come.
 */
export async function drawNightMoment(
  db: Db,
  ownerId: string,
  scene: { id: string; a: string; b: string; chapter: number; place: string | null; stage: number; lines: readonly { text: string; stage?: number }[]; lineCount: number },
  opts: { kind: "chapter" | "asked"; custom?: string | null; baseUrl?: string },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const at = Math.max(0, scene.lineCount - 1);
  const { act, stage } = chosenAt(scene, scene.lines.length - 1);
  const custom = cleanWords(opts.custom ?? undefined, SCENE_CUSTOM_MAX);
  if (!guideSafe([custom])) return { ok: false, reason: "the picture they asked for crosses one of the lines" };
  const { rows } = await db.query<BeatRow>(
    `insert into adult_beats (id, owner_id, scene_id, character_a, character_b, chapter, line, act, kind, stage, place, status, custom) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'drawing', $12) returning *`,
    [crypto.randomUUID(), ownerId, scene.id, scene.a, scene.b, scene.chapter, at, act, opts.kind, Math.max(stage, scene.stage), scene.place, custom],
  );
  return drawBeat(db, rows[0], opts.baseUrl ?? siteUrl());
}

/** The moment a line is, for a picture the owner picks there: the act its position or stage says, and its stage. */
function chosenAt(scene: { lines: readonly { text: string; stage?: number }[]; stage: number }, at: number): { act: string; stage: number } {
  const stage = scene.lines[at]?.stage ?? scene.stage;
  const position = scene.lines.slice(0, at + 1).map((l) => (afterglowIn(l.text) ? null : positionIn(l.text))).filter(Boolean).at(-1) ?? null;
  // Lying together after it, with no new position named since: the afterglow, not sex.
  const recent = scene.lines.slice(Math.max(0, at - 1), at + 1);
  const after = stage >= SEX && recent.some((l) => afterglowIn(l.text)) && !recent.some((l) => positionIn(l.text) && !afterglowIn(l.text));
  return { act: after ? "afterglow" : stage >= SEX ? (position ?? "face_to_face") : stage >= UNDRESSING ? "undress" : stage >= 2 ? "kiss" : "close", stage };
}

/**
 * What a scene picture would be drawn from, nothing drawn or spent (the theater's form before Picture it, and Redraw's):
 * an offered beat's, or the moment at a line of the running chapter, with the owner's changes over it.
 */
export async function previewPicture(
  db: Db,
  ownerId: string,
  scene: { id: string; a: string; b: string; chapter: number; lines: readonly { text: string; stage?: number }[]; stage: number; place: string | null },
  target: { beat?: string; line?: number; picture?: string },
  edit: unknown,
): Promise<PicturePlan> {
  // A picture already drawn (Redraw's form): the moment its beat was, the owner's changes then as the starting point.
  if (target.picture) {
    const row = (await db.query<BeatRow>(`select * from adult_beats where picture_id = $1 and owner_id = $2 order by created_at desc limit 1`, [target.picture, ownerId])).rows[0];
    if (row) return planBeat(db, row, cleanEdit(edit) ?? row.edit);
  }
  if (target.beat) {
    const row = (await db.query<BeatRow>(`select * from adult_beats where id = $1 and owner_id = $2`, [target.beat, ownerId])).rows[0];
    if (!row) return { ok: false, status: 404, message: "That moment isn't there any more." };
    return planBeat(db, row, cleanEdit(edit));
  }
  if (!scene.lines.length) return { ok: false, status: 409, message: "Let the night start first." };
  const at = Math.max(0, Math.min(target.line ?? scene.lines.length - 1, scene.lines.length - 1));
  const { act, stage } = chosenAt(scene, at);
  return planBeat(db, { owner_id: ownerId, scene_id: scene.id, character_a: scene.a, character_b: scene.b, chapter: scene.chapter, line: at, act, kind: "chosen", stage, place: scene.place, night_id: null, custom: null, dialog: null }, cleanEdit(edit));
}

/**
 * Redraw (David, 2026-10-25: "a button to regenerate an image for a scene in case it's wrong"): a scene picture drawn
 * again for the same moment, with the owner's changes to its context. A beat's picture keeps its moment (its line, act
 * and place, in its chapter or the saved night it went with); a chapter's own picture is drawn again at the running
 * chapter's latest line. The old picture stays in the gallery (👎 or Archive it). `price` is in bought tokens (0: free),
 * taken by the caller and given back if the picture doesn't come.
 */
export async function redrawPicture(
  db: Db,
  ownerId: string,
  pictureId: string,
  edit: unknown,
  baseUrl: string,
  scene: { id: string; a: string; b: string; chapter: number; lines: readonly { text: string; stage?: number }[]; stage: number; place: string | null },
  price = 0,
): Promise<BeatAnswer> {
  if (!(await beatPicturesReady(db))) return { ok: false, status: 409, message: "Beat pictures are off, or the picture keys aren't saved, in After Dark's settings." };
  const notReady = await picturesBlocked(db, ownerId, scene.a, scene.b);
  if (notReady) return { ok: false, status: 409, message: notReady };
  const pic = (await db.query<{ id: string; scene_chapter: number | null }>(`select id, scene_chapter from adult_images where id = $1 and owner_id = $2 and kind = 'scene' and status = 'ready'`, [pictureId, ownerId])).rows[0];
  if (!pic) return { ok: false, status: 404, message: "That picture isn't one of this night's." };
  const clean = cleanEdit(edit);
  const beat = (await db.query<BeatRow>(`select * from adult_beats where picture_id = $1 and owner_id = $2 order by created_at desc limit 1`, [pictureId, ownerId])).rows[0];
  if (!beat) {
    if (pic.scene_chapter !== scene.chapter) return { ok: false, status: 409, message: "That chapter has closed: pick its moment again with 📸 Picture this in a replay." };
    return pictureNow(db, ownerId, scene, scene.lines.length - 1, baseUrl, { edit: clean ?? {} }, { paid: price, fresh: true });
  }
  const plan = await planBeat(db, beat, clean ?? beat.edit);
  if (!plan.ok) return { ok: false, status: plan.status, message: plan.message };
  const { rows } = await db.query<BeatRow>(
    `insert into adult_beats (id, owner_id, scene_id, character_a, character_b, chapter, line, act, kind, stage, place, status, custom, dialog, night_id, edit, paid)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'chosen', $9, $10, 'drawing', $11, $12, $13, $14::jsonb, $15) returning *`,
    [crypto.randomUUID(), ownerId, beat.scene_id, beat.character_a, beat.character_b, beat.chapter, beat.line, beat.act, beat.stage, beat.place, beat.custom, beat.dialog, beat.night_id, JSON.stringify(clean ?? beat.edit ?? {}), price],
  );
  drawLater(db, rows, baseUrl);
  return { ok: true, beat: publicBeat(rows[0]) };
}

/**
 * A chapter filed as a saved night (its close, or Start over): its beats go with it, and every one the viewer never
 * chose is drawn now, after the response, from the lines as filed.
 */
export async function fileBeats(db: Db, sceneId: string, chapter: number, nightId: string): Promise<void> {
  const filed = (await db.query<BeatRow>(`update adult_beats set night_id = $3 where scene_id = $1 and chapter = $2 and night_id is null returning *`, [sceneId, chapter, nightId])).rows;
  // A chapter drawn ahead is settled (its tokens back when it drew nothing ahead); one that did keeps its extra pictures
  // for what's left.
  const ahead = (await db.query<{ draw_ahead_chapter: number | null }>(`select draw_ahead_chapter from adult_scenes where id = $1`, [sceneId])).rows[0]?.draw_ahead_chapter === chapter;
  const refunded = await settleDrawAhead(db, sceneId, chapter, { closing: true }).catch(() => 0);
  if (!filed.length || !(await beatPicturesReady(db))) return;
  // Only what's left of the chapter's unasked pictures (lib/adult/chapter-pictures.ts), the earliest moments first; the
  // rest stay filed with the night, not drawn.
  const settings = await getAdultSettings(db);
  const budget = settings.pictures_per_chapter + (ahead && !refunded ? settings.draw_ahead_pictures : 0);
  const fits: string[] = [];
  for (const b of filed.filter((x) => x.status === "offered" || x.status === "later").sort((x, y) => x.line - y.line)) {
    if (!(await claimChapterPicture(db, sceneId, chapter, `${chapter}#beat:${b.id}`, budget))) break;
    fits.push(b.id);
  }
  if (!fits.length) return;
  const claimed = await claim(db, "night_id = $1 and id = any($2)", [nightId, fits]);
  drawLater(db, claimed.sort((x, y) => x.line - y.line), siteUrl());
}

/**
 * A rewind: the running chapter's beats past the lines it kept are gone (written again, they're found again); taking
 * back a chapter's close brings its beats home first.
 */
export async function rewindBeats(db: Db, sceneId: string, chapter: number, lineCount: number, unfiledNight: string | null): Promise<void> {
  if (unfiledNight) await db.query(`update adult_beats set night_id = null where night_id = $1`, [unfiledNight]);
  await db.query(`delete from adult_beats where scene_id = $1 and chapter = $2 and night_id is null and line >= $3`, [sceneId, chapter, lineCount]);
}

/** Start over with nothing to file: the running chapter's beats go (and its draw ahead is settled). */
export async function clearBeats(db: Db, sceneId: string): Promise<void> {
  const chapter = (await db.query<{ chapter: number }>(`select chapter from adult_scenes where id = $1`, [sceneId])).rows[0]?.chapter;
  if (chapter !== undefined) await settleDrawAhead(db, sceneId, chapter, { closing: true }).catch(() => 0);
  await db.query(`delete from adult_beats where scene_id = $1 and night_id is null`, [sceneId]);
}

/**
 * The beat picture a shot of a video can start from: the latest drawn beat at or before its line in its chapter (the
 * running chapter's, or the saved night's), still at the same stage and in the same place. Null when there's none.
 */
export async function beatPictureFor(
  db: Db,
  ownerId: string,
  pair: readonly [string, string],
  part: { chapter: number | null; night_id: string | null },
  line: number,
  stage: number,
  place: string | null,
): Promise<{ id: string; eyes: Eyes | null } | null> {
  if (part.chapter === null) return null;
  const { rows } = await db.query<BeatRow>(
    `select * from adult_beats where owner_id = $1 and character_a = $2 and character_b = $3 and chapter = $4 and night_id is not distinct from $5 and line <= $6 and status = 'drawn' and picture_id is not null
      order by line desc limit 1`,
    [ownerId, pair[0], pair[1], part.chapter, part.night_id, line],
  );
  const b = rows[0];
  if (!b) return null;
  const same = (x: string | null, y: string | null) => (x ?? "").trim().toLowerCase() === (y ?? "").trim().toLowerCase();
  if (b.stage !== stage || !same(b.place, place)) return null;
  // One the viewer 👎'd isn't started from: the shot draws a keyframe of its own, steered by what they said
  // (lib/adult/steering.ts). A shot costs far more than a keyframe, so it isn't spent on a picture they said was wrong.
  return (await thumbsDown(db, ownerId, b.picture_id!)) ? null : { id: b.picture_id!, eyes: b.eyes ?? null };
}
