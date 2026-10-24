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
import { actById, actFor, actRuledOut, crossesTaboo, FRAMING_WORDS, type MediaLimits } from "./acts";
import { mediaLimits } from "./clips";
import { climaxIn } from "./craft";
import { hiveGate } from "./hive-limit";
import { recentActions } from "./media";
import { keepPictureOfBoth } from "./pictures-menu";
import { keyframePrompt, placeWords, reelCast, withoutNames, type ReelPerson } from "./reels";
import { adultKeys, getAdultSettings } from "./settings";
import { overCap } from "./usage";

const UNDRESSING = 3;
const SEX = 4;

/** Found moments a chapter offers at most (a moment the viewer picks is on top of these). */
export const BEATS_PER_CHAPTER = 6;
/** After a climax, the afterglow's picture is this many lines on. */
const AFTERGLOW_AFTER = 4;
/** The lines a beat picture reads what was happening from: the beat's line and the ones just before it. */
const MOMENT_LINES = 6;

export type BeatKind = "undressing" | "sex" | "position" | "climax" | "afterglow" | "chosen";
export type BeatStatus = "offered" | "later" | "drawing" | "drawn" | "failed";

/** A moment found in the lines: its line (in the chapter), the act it's drawn as, what kind of moment, the stage. */
export type FoundBeat = { line: number; act: string; kind: BeatKind; stage: number };

/** A beat as the page gets it. */
export type PublicBeat = { id: string; line: number; kind: BeatKind; act: string; label: string; status: BeatStatus; picture_id: string | null };

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
};

/**
 * The positions, as the lines name them, each the act it's drawn as: most specific first (going down before the rest,
 * a lap before on top). Plain words only, the way lib/adult/stage-floor.ts reads a stage.
 */
const POSITIONS: readonly (readonly [string, RegExp])[] = [
  ["oral", /\b(go(?:es|ing)? down on|eat(?:s|ing)? (?:her|him) out|(?:his|her) (?:mouth|tongue) (?:on|between|finds?)|takes? (?:him|her) in (?:his|her) mouth|lick(?:s|ing)? (?:her|him)\b|suck(?:s|ing)? (?:him|his)\b)/],
  ["behind", /\b(from behind|bends? (?:her|him) over|bent over|on (?:her|his|their) (?:hands and )?knees|doggy)/],
  ["spooning", /\b(spoon(?:s|ing|ed)?|on (?:their|her|his) sides?)\b/],
  ["lap", /\b(in(?:to)? (?:his|her) lap|on (?:his|her) lap)\b/],
  ["on_top", /\b(on top of (?:him|her)|rid(?:es|ing) (?:him|her)\b|straddl\w*|sinks? (?:down )?onto (?:him|her)|climbs? (?:on top|onto (?:him|her)))/],
  ["face_to_face", /\b(missionary|on (?:her|his) back\b|pins? (?:her|him) (?:to|against|into) the (?:bed|mattress|sheets)|wraps? (?:her|his) legs around)/],
];

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
  return name;
}

/**
 * The moments in a chapter's new lines (from `from` on), given those it already has: undressing when they get to it,
 * sex when it starts (in the position its first lines name, else face to face), each position it moves to, the climax,
 * and the afterglow a few lines after it. `before` is the stage the scene stood at before line `from` when that line has
 * none before it. `allowed` leaves out an act the pair's limits rule out. Pure.
 */
export function findBeats(
  lines: readonly { text: string; stage?: number }[],
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
      const named = positionIn(text);
      if (named && named !== position && allowed(named) && !all().some((b) => (b.kind === "sex" || b.kind === "position") && b.act === named)) {
        position = named;
        add({ line: i, act: named, kind: "position", stage });
      }
    }
    if (stage >= UNDRESSING && climaxIn(text) && !has("climax")) {
      add({ line: i, act: position ?? "face_to_face", kind: "climax", stage: Math.max(stage, SEX) });
      climaxAt = i;
    }
    if (climaxAt !== null && i >= climaxAt + AFTERGLOW_AFTER && !has("afterglow")) add({ line: i, act: "afterglow", kind: "afterglow", stage: Math.max(stage, SEX) });
    prev = stage;
  }
  return found;
}

/** A still's bed, where the place isn't one: "On a bed, having sex…" in a kitchen becomes "Having sex…". */
export function poseHere(pose: string, place: string | null): string {
  if (!place || /\b(bed|bedroom|bunk|hotel|room)\b/i.test(place)) return pose;
  const cut = pose.replace(/^(?:On a bed|In bed)[,:]\s*/i, "");
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
): string | null {
  const act = actById(beat.act);
  if (!act) return null;
  const pose = poseHere(actFor(act, cast).pose, place);
  const peak = beat.kind === "climax" ? " Both of them at the peak, faces flushed, eyes closed." : "";
  const base = `${pose}${peak} ${FRAMING_WORDS[act.framing]}`;
  const ok = (words: string) => checkAdultText({ words }).ok && !crossesTaboo(words) && !limits.hit(words);
  if (!ok(base)) return null;
  const happening = withoutNames(recentActions([...moment], 3).join("; "), cast);
  return happening && ok(happening) ? `${base} What is happening: ${happening}.` : base;
}

const publicBeat = (r: BeatRow): PublicBeat => ({ id: r.id, line: r.line, kind: r.kind, act: r.act, label: beatLabel(r.kind, r.act), status: r.status, picture_id: r.picture_id });

/** Whether beat pictures can be made: the setting on, and the provider's and Hive's keys saved. */
export async function beatPicturesReady(db: Db): Promise<boolean> {
  const settings = await getAdultSettings(db);
  if (!settings.beat_pictures) return false;
  const keys = await adultKeys(db);
  return Boolean((settings.media_provider === "replicate" ? keys.replicate : keys.venice) && keys.hive);
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
    for (const f of found) {
      const place = movedAt >= 0 && f.line > movedAt ? scene.placeNow : movedAt >= 0 ? scene.placeBefore : scene.placeNow;
      await db.query(
        `insert into adult_beats (id, owner_id, scene_id, character_a, character_b, chapter, line, act, kind, stage, place) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [crypto.randomUUID(), scene.owner, scene.id, scene.a, scene.b, scene.chapter, f.line, f.act, f.kind, f.stage, place],
      );
    }
  } catch (err) {
    console.warn(`[after-dark] the chapter's moments couldn't be read: ${err instanceof Error ? err.message.slice(0, 160) : "error"}`);
  }
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

/** Draws one beat's picture and keeps it, or marks it failed with why. */
async function drawBeat(db: Db, beat: BeatRow, baseUrl: string): Promise<boolean> {
  const fail = async (why: string) => {
    console.warn(`[after-dark] a beat picture didn't come (${beat.kind}, chapter ${beat.chapter}): ${why.slice(0, 160)}`);
    await db.query(`update adult_beats set status = 'failed' where id = $1`, [beat.id]);
    return false;
  };
  try {
    const settings = await getAdultSettings(db);
    const keys = await adultKeys(db);
    const gate = await hiveGate(db, keys.hive);
    if (!gate.ok) return fail(gate.reason);
    const capped = await overCap(db, beat.owner_id, "pictures");
    if (capped) return fail(capped);
    const [ca, cb] = await Promise.all([loadCharacter(db, beat.character_a), loadCharacter(db, beat.character_b)]);
    if (!ca || !cb) return fail("one of them is missing");
    const cast = reelCast(ca, cb, beat.owner_id);
    const limits = await mediaLimits(db, beat.owner_id, beat.character_a, beat.character_b);
    const lines = await beatLines(db, beat);
    const moment = lines.slice(Math.max(0, beat.line - MOMENT_LINES + 1), beat.line + 1);
    const frame = beatFrame(beat, cast, moment, beat.place, limits);
    if (!frame) return fail("that moment crosses one of the lines");
    const act = actById(beat.act);
    const stage = Math.max(beat.stage, act?.dress ?? 0);
    const place = beat.place ? placeWords(beat.place, cast) : null;
    const reject = (reason: string) =>
      db.query(`insert into adult_rejections (id, owner_id, kind, reason) values ($1, $2, 'scene', $3)`, [crypto.randomUUID(), beat.owner_id, `beat picture: ${reason}`.slice(0, 300)]).catch(() => {});
    const kept = await keepPictureOfBoth(
      db,
      beat.owner_id,
      [ca, cb],
      { place: beat.place, promptFor: (withSet) => keyframePrompt(cast, frame, place, stage, withSet, { explicit: limits.explicit }) },
      { keys, settings, baseUrl, reject, scene: { chapter: beat.chapter, place: beat.place } },
    );
    if (!kept.ok) return fail(kept.message);
    await db.query(`update adult_beats set status = 'drawn', picture_id = $2 where id = $1`, [beat.id, kept.picture.id]);
    return true;
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
export async function answerBeat(db: Db, ownerId: string, beatId: string, answer: "now" | "later", baseUrl: string): Promise<BeatAnswer> {
  const row = (await db.query<BeatRow>(`select * from adult_beats where id = $1 and owner_id = $2`, [beatId, ownerId])).rows[0];
  if (!row) return { ok: false, status: 404, message: "That moment isn't there any more." };
  if (answer === "later") {
    const { rows } = await db.query<BeatRow>(`update adult_beats set status = 'later' where id = $1 and status = 'offered' returning *`, [row.id]);
    return { ok: true, beat: publicBeat(rows[0] ?? row) };
  }
  if (!(await beatPicturesReady(db))) return { ok: false, status: 409, message: "Beat pictures are off, or the picture keys aren't saved, in After Dark's settings." };
  const claimed = await claim(db, "id = $1", [row.id]);
  drawLater(db, claimed, baseUrl);
  return { ok: true, beat: publicBeat(claimed[0] ?? row) };
}

/**
 * Picture this: the viewer picks the moment, at a line of the running chapter. The latest beat at or before it that's
 * still waiting is drawn; with none, the moment itself is, as the act its position or stage says.
 */
export async function pictureNow(
  db: Db,
  ownerId: string,
  scene: { id: string; a: string; b: string; chapter: number; lines: readonly { text: string; stage?: number }[]; stage: number; place: string | null },
  line: number,
  baseUrl: string,
): Promise<BeatAnswer> {
  if (!(await beatPicturesReady(db))) return { ok: false, status: 409, message: "Beat pictures are off, or the picture keys aren't saved, in After Dark's settings." };
  const at = Math.max(0, Math.min(line, scene.lines.length - 1));
  if (!scene.lines.length) return { ok: false, status: 409, message: "Let the night start first." };
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
  const stage = scene.lines[at].stage ?? scene.stage;
  const position = scene.lines.slice(0, at + 1).map((l) => positionIn(l.text)).filter(Boolean).at(-1) ?? null;
  const act = stage >= SEX ? (position ?? "face_to_face") : stage >= UNDRESSING ? "undress" : stage >= 2 ? "kiss" : "close";
  const { rows } = await db.query<BeatRow>(
    `insert into adult_beats (id, owner_id, scene_id, character_a, character_b, chapter, line, act, kind, stage, place, status) values ($1, $2, $3, $4, $5, $6, $7, $8, 'chosen', $9, $10, 'drawing') returning *`,
    [crypto.randomUUID(), ownerId, scene.id, scene.a, scene.b, scene.chapter, at, act, stage, scene.place],
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
  if (!filed.length || !(await beatPicturesReady(db))) return;
  const claimed = await claim(db, "night_id = $1", [nightId]);
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

/** Start over with nothing to file: the running chapter's beats go. */
export async function clearBeats(db: Db, sceneId: string): Promise<void> {
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
): Promise<string | null> {
  if (part.chapter === null) return null;
  const { rows } = await db.query<BeatRow>(
    `select * from adult_beats where owner_id = $1 and character_a = $2 and character_b = $3 and chapter = $4 and night_id is not distinct from $5 and line <= $6 and status = 'drawn' and picture_id is not null
      order by line desc limit 1`,
    [ownerId, pair[0], pair[1], part.chapter, part.night_id, line],
  );
  const b = rows[0];
  if (!b) return null;
  const same = (x: string | null, y: string | null) => (x ?? "").trim().toLowerCase() === (y ?? "").trim().toLowerCase();
  return b.stage === stage && same(b.place, place) ? b.picture_id : null;
}
