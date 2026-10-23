/**
 * After dark's scenes (lib/adult/mode.ts; David, 2026-10-18): the adult season, played by this season's house cast
 * (lib/season-cast.ts), never anyone's own characters. The admin picks two of them and a private scene runs on the
 * local open-weight model, picking up from their latest date when they've had one. A few lines at a time, optionally
 * steered ("they go back to hers"). Every line is held to the two lines that never move (no minors, no real people,
 * lib/safety.ts checkAdultText); anything else between the two fictional adults is allowed.
 */
import { loadCharacter, type Character } from "../character";
import type { Db } from "../db";
import { moveLineFeedback } from "../line-feedback";
import type { ChatMessage, Model, ModelOptions, Usage } from "../model";
import { pairKey } from "../relationships";
import { checkAdultText, type SafetyResult } from "../safety";
import { eligibleIds } from "./characters";
import { pictureKeyReady, ensureBaseline, makePicture, outputCheckReady, PICTURES_OFF_NOTE, recentActions, scenePrompt, type Media } from "./media";
import { countUse, overCap } from "./usage";
import { adultModel } from "./mode";
import { drawLabel, ensureSet, resolveSet } from "../sets";
import { pairMemory } from "../memory";
import { contentWords, lineIssues } from "../quality";
import type { Turn } from "../conversation";
import { afterDarkNote, notesBetween, ownNotes, rememberAfterDark, restoreNotes, setOwnNote, type NoteRow } from "./memory";
import {
  afterWhisperStep,
  cleanWhisper,
  stageAsked,
  storedSuggestions,
  storedWhispers,
  suggestionsFor,
  suggestionsIn,
  SUGGESTION_MAX,
  whisperLines,
  WHISPER_STEPS,
  type Suggestion,
  type Whispers,
} from "./director";
import { agreedMove, historyPhrase, isPublicPlace, MAX_SCENE_MOVES, repeatOf, saysCatchphrase, settlePlace, shownMove, withoutOpening, withoutPart, withoutPhrase, type MoveLog, type PlaceStop } from "./continuity";
import { activeLimit, linesAtPlace, objectOf, possessiveNames, possessiveOf, pronounKind, recentClimax, repairPlacePronouns, THRESHOLD_LINES, thresholdOf } from "./craft";
import { stageShown, stagesFor, withoutSteerCopy } from "./stage-floor";
import { fileSteps, logStep, markRewound, stepIndexOf, stepsOf, unfileSteps, type StepRow } from "./steps";
import { hardNoHit, hardNoLines, hasHardNos, INTENSITY, intensityLine, intensityOf, limitsHit, NO_LIMITS, OWN_LEN, OWN_MAX, storedHardNos, type HardNos, type Intensity, type PairLimits } from "./limits";
import { framingOf, mayEditProfile, profileLines, turnOnsFor, turnOnsOf, type FramingId, type TurnOnId } from "./profile";
import { scenarioById, type Scenario } from "./scenarios";
import { MIN_LINES_PER_STAGE, STAGES } from "./stages";
import {
  bumpFacts,
  citeMemory,
  editOwnFact,
  factLine,
  jsonOf,
  loadPairFacts,
  memoryLabels,
  RECENT_LINES,
  rememberFacts,
  rememberFactsChange,
  restoreFactUses,
  retrieveFacts,
  undoFacts,
  sheetFacets,
  sheetMemories,
  type AdultFact,
  type Citation,
  type FactsChange,
  type FactUse,
  type SheetFacet,
  type SheetItem,
  type ShownFact,
} from "./facts";
import { guardAlternation, guardNames } from "./guards";
import {
  ACTION_WINDOW,
  actionOf,
  actionRepeatOf,
  bannedPhrases,
  BUILD_UP_WINDOW,
  buildUpIn,
  copiedRun,
  countPhrases,
  flaggedHooks,
  HOOK_EVERY,
  hookAllowance,
  hooksOf,
  OPENING_WINDOW,
  openingRepeatOf,
  phraseNames,
  phrasesIn,
  questionHabit,
  refusalIn,
  sheetText,
  showsTell,
  sideOfCharacter,
  TELL_CAP,
  topPhrases,
  touchesHook,
  WORN_AT,
  wornIn,
} from "./quality";
import { DEFAULT_PROMPT_VERSION, getAdultSettings, type AdultSettings, type PromptVersion } from "./settings";
import { castNames, sceneCharacter, styleExamples, voiceKitLines } from "./voice";
export { SOFT_CHAPTERS } from "./stages";

/**
 * One line of a scene. `why` and `memory` are the writer's private notes (David, 2026-10-21: "a private why on every
 * line"), written in the same model call: why this character says or does this now, and the memory it draws on. They're
 * stored with the line, read only by an admin (sceneNotes, /api/admin/after-dark/why) and the observer, and never sent
 * to the theater or the player (publicLines). `moved_to` marks the line that agreed to go somewhere (lib/adult/continuity.ts).
 * `stage` is how far it had gone when the line was written (STAGES index), so the theater's label follows the line on
 * screen, not the night's latest (David, 2026-10-21: it "starts with 'sex' and that is definitely not happening").
 * `fact_ids` are the remembered facts (lib/adult/facts.ts) its memory cited, private like the notes.
 * Lines written before 2026-10-21 have none.
 */
export type SceneLine = { who: "a" | "b"; text: string; why?: string; memory?: string | null; moved_to?: string; stage?: number; fact_ids?: string[] };

/** The lines as the page and the player get them: who and what, never the private notes. */
export const publicLines = (lines: readonly SceneLine[]): SceneLine[] =>
  lines.map((l) => ({ who: l.who, text: l.text, ...(typeof l.stage === "number" ? { stage: l.stage } : {}) }));
export type AdultScene = {
  id: string;
  lines: SceneLine[];
  a: { id: string; name: string };
  b: { id: string; name: string };
  /** Their latest date, the scene's starting point when they've had one. */
  date: { setting: string | null; ending: string | null; venue: string | null } | null;
  /** Where they are now (the model keeps it), how far it's gone (STAGES), and why the last picture didn't come. */
  place: string | null;
  stage: number;
  /** The line the current stage began at: unsteered, a stage lasts MIN_LINES_PER_STAGE lines first. */
  stage_from: number;
  picture_note: string | null;
  /** The set they're on, a short place name ("his bedroom"), drawn once (lib/sets.ts); and a paid cut the next lines react to. */
  set_place: string | null;
  cut_to: string | null;
  /** Which chapter of the night this is, the recap of the chapters before it, and their last lines (carried over). */
  chapter: number;
  recap: string | null;
  prev_tail: SceneLine[];
  /** Where the night has been, in order (the last stop is where they are), and this chapter's reported moves. */
  place_history: PlaceStop[];
  moves: MoveLog[];
  /**
   * The director (lib/adult/director.ts): the last step's three suggested next moves, the whispers still running (the
   * viewer holds both), and how many steps can be rewound, with what the last one was asked (a redo asks it again).
   */
  suggestions: Suggestion[];
  whispers: Whispers;
  rewind: RewindSummary;
  /** The viewer's limits for the pair (lib/adult/limits.ts): how far and how frank it goes, and their hard nos. */
  intensity: Intensity;
  hard_nos: HardNos;
  /** How the viewer frames the two of them (lib/adult/profile.ts), and the scenario tonight started from (lib/adult/scenarios.ts). */
  framing: FramingId | null;
  scenario: string | null;
};

/** What a step was asked: its steer, how strongly, and a whisper sent with it. A redo asks the same again. */
export type Given = { direction: string | null; steer_mode: SteerMode; whisper: { to: "a" | "b"; text: string } | null };
export type RewindSummary = { depth: number; last: Given | null };

/** A chapter close a step caused, for a rewind to take back: the night it was filed as, the PG notes before it, and the facts it changed. */
type ChapterUndo = { night_id: string; notes: NoteRow[]; facts: FactsChange };

/**
 * What a rewind needs to take one step back (rewindScene): the scene as it was before the step (its lines by count:
 * within a chapter they only grow), what the step was asked, the uses of the facts its lines cited, and the chapter close
 * it caused, if it filled the chapter.
 */
export type StepUndo = {
  step_id: string | null;
  given: Given;
  before: Omit<SceneState, "lines"> & { line_count: number; picture_note: string | null; suggestions: Suggestion[]; whispers: Whispers };
  bumped: FactUse[];
  chapter_close?: ChapterUndo;
};
/** Steps a scene can be rewound, one at a time. Start over and Set the scene clear them. */
export const UNDO_DEPTH = 5;

/** The scene with what only the server needs: its rewind stack. */
type LoadedScene = AdultScene & { undo: StepUndo[] };
const rewindSummary = (undo: readonly StepUndo[]): RewindSummary => ({ depth: undo.length, last: undo.at(-1)?.given ?? null });

/**
 * Chapters (David, 2026-10-19: "a limit to how long after hours can go… a long scroll"). A night has no hard end: every
 * CHAPTER_LINES lines the chapter is filed as a saved night, the model writes a running recap of the night so far, and
 * the next chapter starts with that recap and the last PREV_TAIL lines, so the characters remember how it began (the
 * prompt otherwise only holds the last 30 lines). Past SOFT_CHAPTERS the page suggests ending the night.
 */
export const CHAPTER_LINES = 120;
const PREV_TAIL = 12;
const RECAP_MAX = 1200;

/** What someone can type to set the scene: a place, at most this long. */
export const SET_SCENE_MAX = 60;

export { STAGES } from "./stages";

/** Lines written per call, and the scene kept in the prompt (a night has no length cap: it runs in chapters). */
export const LINES_PER_TURN = 6;
const SCENE_IN_PROMPT = 30;
const DIRECTION_MAX = 300;
/** Six lines with their private notes, and the picture note, fit well inside this; it's also what the provider reserves credit for. */
export const SCENE_REPLY_TOKENS = 1600;
/** A line's private "why" or "memory", at most this long. */
const NOTE_MAX = 240;

export type LatestDate = { setting: string | null; ending: string | null; venue: string | null; character_a: string; transcript: { side: "a" | "b"; dialogue: string; action?: string }[] | null };

/** The pair, lower id first, when both may be in this person's after dark (lib/adult/characters.ts); null otherwise. */
export async function eligiblePair(db: Db, ownerId: string, x: string, y: string): Promise<[string, string] | null> {
  if (x === y) return null;
  const ok = await eligibleIds(db, ownerId);
  return ok.has(x) && ok.has(y) ? pairKey(x, y) : null;
}

/** Every pair of the characters who can be in after dark, with how far each pair's scene has gone for this admin. */
export async function listCastPairs(db: Db, adminId: string) {
  const cast = [...(await eligibleIds(db, adminId))];
  const names = new Map(
    (await db.query<{ id: string; name: string }>(`select id, name from characters where id = any($1)`, [cast])).rows.map((r) => [r.id, r.name]),
  );
  const scenes = new Map(
    (
      await db.query<{ character_a: string; character_b: string; n: number }>(
        `select character_a, character_b, jsonb_array_length(lines) as n from adult_scenes where owner_id = $1`,
        [adminId],
      )
    ).rows.map((r) => [`${r.character_a}/${r.character_b}`, r.n]),
  );
  const pairs: { a: { id: string; name: string }; b: { id: string; name: string }; lines: number; path: string }[] = [];
  const sorted = [...cast].sort();
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const [a, b] = [sorted[i], sorted[j]];
      pairs.push({ a: { id: a, name: names.get(a) ?? a }, b: { id: b, name: names.get(b) ?? b }, lines: scenes.get(`${a}/${b}`) ?? 0, path: `/after-dark/${a}/${b}` });
    }
  }
  return pairs;
}

async function latestDate(db: Db, a: string, b: string): Promise<LatestDate | null> {
  const { rows } = await db.query<LatestDate>(
    `select setting, ending, setup->>'venue' as venue, character_a, transcript from episodes
      where status = 'ready' and varies_episode_id is null and ((character_a = $1 and character_b = $2) or (character_a = $2 and character_b = $1))
      order by created_at desc limit 1`,
    [a, b],
  );
  return rows[0] ?? null;
}

/** The admin's scene for a pair of this season's cast, made on first open, as the page gets it (no private notes). */
export async function openScene(db: Db, adminId: string, x: string, y: string): Promise<AdultScene | null> {
  const scene = await loadScene(db, adminId, x, y);
  return scene && publicScene(scene);
}

/** A scene without its lines' private notes, and without its rewind stack (only how deep it is). */
export const publicScene = (scene: AdultScene & { undo?: readonly StepUndo[] }): AdultScene => {
  const { undo, ...rest } = scene;
  return { ...rest, lines: publicLines(rest.lines), prev_tail: publicLines(rest.prev_tail), rewind: undo ? rewindSummary(undo) : rest.rewind };
};

/** The scene with everything stored on its lines, for writing more. Null for any pair outside this person's after dark. */
async function loadScene(db: Db, adminId: string, x: string, y: string): Promise<LoadedScene | null> {
  const pair = await eligiblePair(db, adminId, x, y);
  if (!pair) return null;
  const [a, b] = pair;
  await db.query(`insert into adult_scenes (id, owner_id, character_a, character_b) values ($1, $2, $3, $4) on conflict do nothing`, [
    crypto.randomUUID(),
    adminId,
    a,
    b,
  ]);
  const row = (
    await db.query<{
      id: string; lines: SceneLine[]; place: string | null; stage: number; stage_from: number; picture_note: string | null; set_place: string | null; cut_to: string | null;
      chapter: number; recap: string | null; prev_tail: SceneLine[] | null; place_history: PlaceStop[] | null; moves: MoveLog[] | null; suggestions: unknown; whispers: unknown; undo: StepUndo[] | null;
      intensity: string | null; hard_nos: unknown; framing: string | null; scenario: string | null;
    }>(
      `select id, lines, place, stage, stage_from, picture_note, set_place, cut_to, chapter, recap, prev_tail, place_history, moves, suggestions, whispers, undo, intensity, hard_nos,
              framing, scenario
         from adult_scenes where owner_id = $1 and character_a = $2 and character_b = $3`,
      [adminId, a, b],
    )
  ).rows[0];
  const [ca, cb, date] = await Promise.all([loadCharacter(db, a), loadCharacter(db, b), latestDate(db, a, b)]);
  return {
    id: row.id,
    lines: (row.lines ?? []).map((l) => ({ ...l, text: dropForeignActions(l.text) })),
    a: { id: a, name: ca?.name ?? a },
    b: { id: b, name: cb?.name ?? b },
    date: date ? { setting: date.setting, ending: date.ending, venue: date.venue } : null,
    place: row.place ?? null,
    stage: row.stage ?? 0,
    stage_from: row.stage_from ?? 0,
    picture_note: row.picture_note ?? null,
    set_place: row.set_place ?? null,
    cut_to: row.cut_to ?? null,
    chapter: row.chapter ?? 1,
    recap: row.recap ?? null,
    prev_tail: row.prev_tail ?? [],
    place_history: row.place_history ?? [],
    moves: row.moves ?? [],
    suggestions: storedSuggestions(row.suggestions),
    whispers: storedWhispers(row.whispers),
    rewind: rewindSummary(Array.isArray(row.undo) ? row.undo : []),
    undo: Array.isArray(row.undo) ? row.undo : [],
    intensity: intensityOf(row.intensity),
    hard_nos: storedHardNos(row.hard_nos),
    framing: framingOf(row.framing),
    scenario: row.scenario && scenarioById(row.scenario) ? row.scenario : null,
  };
}

/** The scene's limits as a step holds them. */
export const limitsOf = (scene: Pick<AdultScene, "intensity" | "hard_nos">): PairLimits => ({ intensity: scene.intensity, hard_nos: scene.hard_nos });

/**
 * What each side can remember tonight, for the prompt and for "memory" (lib/adult/memory.ts's PG note of their earlier
 * nights, the pair memory from their dates, their latest date's ending). Each one a short sentence; [] when none.
 */
export async function sceneMemories(db: Db, ownerId: string, a: Character | null, b: Character | null, date: LatestDate | null): Promise<string[]> {
  if (!a || !b) return [];
  const first = (c: Character) => c.name.split(/\s+/)[0];
  const out: string[] = [];
  if (date?.ending) out.push(`Their latest date${date.setting ? `, ${date.setting},` : ""} ended: ${date.ending}`);
  for (const [self, other] of [
    [a, b],
    [b, a],
  ] as const) {
    const note = await afterDarkNote(db, self.id, other.id);
    if (note) out.push(`${first(self)} remembers from before: ${note}`);
    const pm = await pairMemory(db, self.id, other.id, ownerId).catch(() => null);
    if (pm?.they_said) out.push(`${first(self)} remembers ${first(other)} saying: "${pm.they_said}"`);
  }
  return out.slice(0, 8);
}

/** Where the scene is: the place the model last reported, else where their latest date was. */
export const placeOf = (scene: Pick<AdultScene, "place">, date: { setting: string | null } | null) =>
  scene.place || (date?.setting ? `${date.setting}, where their date was` : "wherever they've just met");

/** Their tells (lib/extras.ts), so they still sound like themselves after dark. */
const tellsOf = (c: Character): string[] => Object.values(c.extras.tells ?? {}).filter((t): t is string => typeof t === "string" && Boolean(t)).slice(0, 3);

/** All four of their tells, as v2's sheet lists them: what v2.2 holds to TELL_CAP lines a chapter. */
const sheetTells = (c: Character | null): string[] => Object.values(c?.extras.tells ?? {}).filter((t): t is string => typeof t === "string" && Boolean(t.trim()));

/** Their tells already shown in TELL_CAP of their lines this chapter (lib/adult/quality.ts showsTell). */
const tellsAtCap = (chapter: readonly SceneLine[], who: "a" | "b", c: Character | null): string[] =>
  sheetTells(c).filter((t) => chapter.filter((l) => l.who === who && showsTell(l.text, t)).length >= TELL_CAP);

/** Once a chapter at most (Star said "That's a problem for future me" again and again). */
const catchphraseLine = (c: Character, used: boolean) =>
  c.extras.catchphrase
    ? used
      ? `Catchphrase: ${c.extras.catchphrase} (already said this chapter: don't say it again)`
      : `Catchphrase (at most once a chapter): ${c.extras.catchphrase}`
    : "";

const sheetOf = (c: Character | null, side: "a" | "b", catchphraseUsed = false) =>
  c
    ? [
        `${side.toUpperCase()}: ${c.name}, ${c.age}${c.pronouns ? `, ${c.pronouns}` : ""}.`,
        `Bio: ${c.bio}`,
        `Traits: ${c.persona.traits.join(", ")}. Wants: ${c.persona.want}.`,
        c.voice ? `Voice: ${c.voice}` : "",
        tellsOf(c).length ? `Tells: ${tellsOf(c).join("; ")}` : "",
        catchphraseLine(c, catchphraseUsed),
        c.look.appearance ? `Looks: ${c.look.appearance}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : `${side.toUpperCase()}: unknown`;

/**
 * Prompt v2's sheet (David, 2026-10-21: "characters lose their sheet in After Dark"): v1's, with the voice kit the show's
 * dates use (lib/adult/voice.ts voiceKitLines: details, public facts, all four tells by name, never-says, sample lines)
 * and up to five of their own best lines from their show dates, as "how {name} talks", when they have any.
 */
const sheetV2 = (c: Character | null, side: "a" | "b", catchphraseUsed = false, styles: readonly string[] = []) =>
  c
    ? [
        `${side.toUpperCase()}: ${c.name}, ${c.age}${c.pronouns ? `, ${c.pronouns}` : ""}.`,
        `Bio: ${c.bio}`,
        `Traits: ${c.persona.traits.join(", ")}. Wants: ${c.persona.want}.`,
        c.voice ? `Voice: ${c.voice}` : "",
        ...voiceKitLines(c),
        catchphraseLine(c, catchphraseUsed),
        // v2.1: Dolphin copied these word for word (the A/B of 2026-10-21 dropped three): they show the voice, nothing more.
        styles.length
          ? `How ${c.name.split(/\s+/)[0]} talks (their own lines from their show dates, only to show the voice: never reuse one, or any part of one):\n${styles.map((s) => `- "${s}"`).join("\n")}`
          : "",
        c.look.appearance ? `Looks: ${c.look.appearance}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : `${side.toUpperCase()}: unknown`;

/**
 * Prompt v2's rules for staying themselves: only the two of them, their sheets when it heats up, no stock phrasing, and
 * (v2.1: a v2 night put two women in "his apartment entrance") their pronouns, from their sheets only. v2.2 (Lexi × Dex
 * on prod, 2026-10-22: her bakery in 137 of 298 lines, his pottery in 73, her pencil spun 31 times, during sex too): their
 * job and hobbies come up now and then, not in every line, and their tells are left to the craft rules.
 */
function voiceRules(a: Character | null, b: Character | null, names: { a: string; b: string }): string[] {
  const banned = bannedPhrases([a, b].filter((c): c is Character => Boolean(c)).map((c) => sheetText(sideOfCharacter(c))));
  const pronouns = (c: Character | null, name: string) => `${name.split(/\s+/)[0]}: ${c?.pronouns?.trim() || "none given, so use their name"}`;
  return [
    `Only the two of them are in this scene: ${names.a} and ${names.b}. Nobody else speaks, arrives or is named, and each calls the other by their own name.`,
    "Stay this person when it gets intimate: their humour and the way they talk still show, and their job or a hobby comes up now and then, not in every line; no generic romance-novel phrasing. They sound like their sheets, not like a paperback.",
    `Never write these stock phrases, or anything in their register: ${banned.join(", ")}.`,
    `Their pronouns, from their sheets: ${pronouns(a, names.a)}; ${pronouns(b, names.b)}. Use only these, for them, their bodies and their places.`,
  ];
}

/** The worn phrases the prompt lists per character, at most (the most worn first). */
const WORN_SHOWN = 8;
/** What a threshold looks like, for the lines to show it when they stay there. */
const THRESHOLD_DETAIL: Record<string, string> = {
  "the car": "the seatbelt, the fogged windscreen, the engine ticking as it cools",
  "the elevator": "the hum of the cables, the floor numbers, the doors",
  "the lobby": "the doorman's desk, the marble, the lift chiming",
  "the porch": "the porch light, the night air, the boards creaking",
};
const facetPhrase = (poss: string, f: SheetFacet) => `${poss} ${f.name} (${f.text.length > 90 ? `${f.text.slice(0, 89).replace(/\s+\S*$/, "")}…` : f.text})`;

/** "undressing" (STAGES): from here on a tell is out of place and how they're positioned matters (v2.2). */
const UNDRESSING = STAGES.indexOf("undressing");

/**
 * Prompt v2.1's craft (David's review of a v2 night, Star Dust × Sable Quist, 2026-10-21: a limit overridden, the place
 * stuck in a doorway, tics, no arc). The rules that always hold: limits, a detail of the place, the rhythm, answering each
 * other, a repeat with a new action is still a repeat, and the last stage's arc. Then tonight's notes, from the lines so
 * far (lib/adult/craft.ts, lib/adult/quality.ts): a limit still standing, each one's worn phrases, question endings and
 * hook (with the other sides of them their sheet shows), and a threshold they've stood at too long.
 *
 * v2.2 (Lexi × Dex on prod, 2026-10-22): once they're undressing, tells are for the talking and their positions hold
 * ("eyes locked on hers" from behind); at the last stage the build-up is said once, and after an afterglow or aftercare
 * it only picks up again when one of them starts it in a line (it resumed with no transition after lines 28–33). The
 * notes name a tell already shown TELL_CAP times this chapter, and that a hook past its share is cut.
 */
function craftLines(
  a: Character | null,
  b: Character | null,
  lines: readonly SceneLine[],
  now: { place: string; set?: string | null; stage: number; movesLeft?: number; linesHere?: number; publicPlace?: boolean; tellsUsed?: { a: readonly string[]; b: readonly string[] } },
): string[] {
  const nameOf = (who: "a" | "b") => (who === "a" ? a?.name : b?.name) ?? who;
  const first = (who: "a" | "b") => nameOf(who).split(/\s+/)[0];
  const kind = (who: "a" | "b") => pronounKind((who === "a" ? a : b)?.pronouns);
  const poss = (who: "a" | "b") => possessiveOf(kind(who));
  const other = (who: "a" | "b") => (who === "a" ? "b" : "a");
  const rules = [
    "Craft:",
    "- Limits hold. When one of them says slow down, wait, stop, not yet or anything like it, the next lines honour it: they slow down, stop going further, and ask. It goes further only once the one who asked says yes, on the page.",
    "- Ground the place: every few lines, one concrete detail of where they are (the light, a sound, a texture, the temperature), a new one each time.",
    "- Vary the rhythm: some lines are a few words, some run to two or three sentences, and now and then a line is only an action.",
    "- Each line answers what the other just said or did; nobody reacts to something that wasn't said.",
    "- A new action in front of a line already said doesn't make it new: what's been said tonight isn't said again, in any words close to it.",
    '- When these lines take them somewhere (one suggests it, the other says yes, they go), "place" and "set" in your reply are where they are by the end of them.',
  ];
  if (now.stage >= UNDRESSING) {
    rules.push(
      "- Their tells (the habits on their sheets) are for the talking: now it's gone this far they don't show, unless one truly fits the moment.",
      "- Keep track of how they're positioned: once a line sets it (on top, from behind, against the wall), the lines only show what each of them could see, reach or do from there (from behind, their eyes don't meet), until a line changes it.",
    );
  }
  if (now.stage >= STAGES.length - 1) {
    const climax = recentClimax(lines);
    const again = "one of them starts it in a line (asks, or reaches for the other) and the other answers";
    rules.push(
      climax
        ? `- They've reached a climax (${first(climax.who)}: "${climax.text.replace(/\*[^*]*\*/g, "").trim().slice(0, 60)}"): now the afterglow, a resolution. They check in with each other, stay warm, make each other laugh; it doesn't start over unless ${again}.`
        : `- This is the last stage: write toward a climax, then a resolution or an afterglow beat (checking in, warmth, a joke), instead of looping. The build-up ("almost there", "so close") is said once, not again and again: then the climax comes. After an afterglow or aftercare it only picks up again when ${again}; it never just resumes.`,
    );
  }
  const notes: string[] = [];
  const names = [nameOf("a"), nameOf("b")];
  const limit = activeLimit(lines, names);
  if (limit) notes.push(`- ${first(limit.who)} asked to slow down ("${limit.said}"): honour it, or have ${first(other(limit.who))} ask and get a yes, before going further.`);
  const named = phraseNames(...names);
  const worn = (["a", "b"] as const)
    .map((who) => ({ who, list: topPhrases(countPhrases(lines.filter((l) => l.who === who), named), WORN_SHOWN, WORN_AT) }))
    .filter((x) => x.list.length);
  if (worn.length) {
    notes.push(
      `- Worn phrases (each already in ${WORN_AT} or more of their lines tonight; don't use them again, or anything close): ${worn.map((x) => `${first(x.who)}: ${x.list.map((p) => `"${p.phrase}"`).join(", ")}`).join("; ")}.`,
    );
  }
  for (const who of ["a", "b"] as const) {
    const q = questionHabit(lines, who);
    if (q) notes.push(`- ${first(who)} has ended ${q.questions} of ${poss(who)} last ${q.of} lines on a question: vary it, with a statement, an action or a silence.`);
  }
  for (const who of ["a", "b"] as const) {
    const c = who === "a" ? a : b;
    const [hook] = hooksOf(lines, who, names, 1);
    if (!hook || !c) continue;
    const kinds = new Set<string>();
    // v2.2: never a tell that's had its TELL_CAP this chapter, as another side to show.
    const spent = new Set(now.tellsUsed?.[who] ?? []);
    const sides = sheetFacets(c).filter((f) => !touchesHook(f.text, hook) && !(f.kind === "tell" && spent.has(f.text)) && !kinds.has(f.kind) && kinds.add(f.kind)).slice(0, 3);
    notes.push(
      `- ${first(who)} keeps coming back to "${hook.word}" (${hook.lines} of ${poss(who)} last ${hook.of} lines). Show other sides of ${objectOf(kind(who))}, from ${poss(who)} sheet, and name the one a line uses in its "why": ${sides.length ? sides.map((f) => facetPhrase(poss(who), f)).join("; ") : `${poss(who)} work, hobbies, humour and tells`}. "${hook.word}" now gets one of ${poss(who)} lines in ${HOOK_EVERY} at most; a line past that loses it.`,
    );
  }
  // v2.2: a tell is TELL_CAP lines a chapter, like a catchphrase's once.
  const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);
  for (const who of ["a", "b"] as const) {
    for (const tell of now.tellsUsed?.[who] ?? []) notes.push(`- ${first(who)} has shown ${poss(who)} tell (${tell}) ${times(TELL_CAP)} this chapter: not again.`);
  }
  if (now.publicPlace && now.stage >= 1) {
    notes.push(
      `- They're somewhere public (${now.set ?? now.place}): it goes no further than kissing here. Going further means one of them suggests somewhere private, the other says yes, and they go.`,
    );
  }
  const threshold = thresholdOf(now.place, now.set ?? null);
  const here = now.linesHere ?? 0;
  if (threshold && here > THRESHOLD_LINES) {
    const goIn = threshold === "the car" ? "getting out and going inside" : "going inside";
    notes.push(
      `- They've been at ${threshold} for ${here} lines. ${now.movesLeft === 0 ? "They can't move again in this part of the night, so" : `In these lines, either one of them suggests ${goIn} and the other says yes (then they're in), or`} the lines show where they are: ${THRESHOLD_DETAIL[threshold] ?? "the door at someone's back, the light from the hall, a neighbour's footsteps"}.`,
    );
  }
  return [...rules, ...(notes.length ? ["Tonight so far (notes from the lines already written; follow them in these lines):", ...notes] : [])];
}

const COMMON = new Set(
  "about after again also always another their there these those though through would could should every other where while which with without your yours yourself just like know right really think going gonna wanna want need make made take back over into onto then than them they this that what when here have been being does doing done more most much very even still only says said tell told look looks looking feel feels felt good come came come'on".split(" "),
);

/**
 * Words the scene keeps leaning on (a pet name said a dozen times, a stock line), to steer away from (David,
 * 2026-10-18: "captain" ten times in one scene). Not the characters' names.
 */
export function overusedWords(lines: SceneLine[], names: string[], min = 4, max = 6): string[] {
  const skip = new Set([...COMMON, ...names.flatMap((n) => n.toLowerCase().split(/\s+/))]);
  const counts = new Map<string, number>();
  for (const l of lines) for (const w of l.text.toLowerCase().match(/[a-z']{4,}/g) ?? []) if (!skip.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts.entries()].filter(([, n]) => n >= min).sort((x, y) => y[1] - x[1]).slice(0, max).map(([w]) => w);
}

/** The prompt for the next lines: who they are, their latest date, the scene so far, and the admin's steer. */
export function sceneMessages(
  a: Character | null,
  b: Character | null,
  date: LatestDate | null,
  lines: SceneLine[],
  direction: string | null,
  aId?: string,
  now: {
    place: string;
    stage: number;
    linesAtStage?: number;
    cutTo?: string | null;
    recap?: string | null;
    opening?: boolean;
    steerMode?: SteerMode;
    /** The set they're on ("Chud's living room"), where the night has been, whose home they're in, and moves left. */
    set?: string | null;
    history?: PlaceStop[];
    homeNow?: "a" | "b" | null;
    movesLeft?: number;
    /** What they can remember (sceneMemories), and whose catchphrase has had its once this chapter. */
    memories?: string[];
    catchphraseUsed?: { a: boolean; b: boolean };
    /** Which prompt: v2 (the default) anchors each voice and numbers what they remember; v1 is the prompt before it. */
    promptVersion?: PromptVersion;
    /** v2: the facts this step brings back (lib/adult/facts.ts retrieveFacts), and each one's best show lines. */
    facts?: readonly ShownFact[];
    styles?: { a?: readonly string[]; b?: readonly string[] };
    /** v2.1: a new pair's own sheet details ([S1]…, lib/adult/facts.ts sheetMemories), and the lines they've been where they are. */
    sheetItems?: readonly SheetItem[];
    linesHere?: number;
    /** v2.2: each one's tells already shown TELL_CAP times this chapter. */
    tellsUsed?: { a: readonly string[]; b: readonly string[] };
    /** The director (lib/adult/director.ts): the whispers running this step, one each at most. */
    whispers?: Whispers;
    /** The viewer's limits (lib/adult/limits.ts): the intensity and the hard nos. None: the prompt as it was. */
    limits?: PairLimits;
    /** Their profiles (lib/adult/profile.ts): each one's turn-ons, the pair's framing, and tonight's scenario. */
    profile?: SceneProfile;
  } = { place: "wherever they've just met", stage: 0 },
): ChatMessage[] {
  const v2 = (now.promptVersion ?? DEFAULT_PROMPT_VERSION) === "v2";
  const nameOf = (who: "a" | "b") => (who === "a" ? a?.name : b?.name) ?? who;
  const first = (who: "a" | "b") => nameOf(who).split(/\s+/)[0];
  // v2.1: where they are, with a possessive neither of them goes by put right ("his apartment entrance", two women);
  // v2.2: and a name that lost its apostrophe ("Lexis bedroom").
  const names = { a: nameOf("a"), b: nameOf("b") };
  const fixPlace = (label: string) => repairPlacePronouns(possessiveNames(label, names), { a: a?.pronouns, b: b?.pronouns }, names, now.homeNow ?? null).text ?? label;
  const where = v2 ? { place: fixPlace(now.place), set: now.set ? fixPlace(now.set) : now.set } : { place: now.place, set: now.set };
  const sheetItems = v2 ? (now.sheetItems ?? []) : [];
  // A date's sides are its own a and b; map them onto the scene's (the pair is stored lower id first).
  const flip = date && aId ? date.character_a !== aId : false;
  const dateTail = (date?.transcript ?? []).slice(-10).map((t) => {
    const who: "a" | "b" = flip ? (t.side === "a" ? "b" : "a") : t.side;
    return `${nameOf(who)}: ${t.dialogue}${t.action ? ` (${t.action})` : ""}`;
  });
  const sceneTail = lines.slice(-SCENE_IN_PROMPT).map((l) => `${nameOf(l.who)}: ${l.text}`);
  // v2 numbers what they remember, so a line's "memory" can cite it: the facts as F…, their other memories as M….
  const remembered = v2 ? [...(now.facts ?? []).map(factLine), ...memoryLabels(now.memories ?? []).map((m) => `[${m.label}] ${m.text}`)] : [];
  // The viewer's limits (lib/adult/limits.ts): explicit with no hard nos leaves the prompt as it was, word for word.
  const limits = now.limits ?? NO_LIMITS;
  const register = intensityLine(limits.intensity);
  const cap = INTENSITY[limits.intensity].maxStage;
  const capped = cap < STAGES.length - 1;
  const system = [
    "You write a private, adults-only scene for one reader: two characters from a dating show, alone together.",
    register
      ? `Both characters are adults (18 or older) and both are willing. ${register}`
      : "Both characters are adults (18 or older) and both are willing. Explicit sexual content is allowed and expected when the scene goes there; write it frankly, in each character's own voice.",
    "Two rules never move: nobody in the scene is under 18 or described as a child, and no real, identifiable person appears or is named.",
    ...hardNoLines(limits.hard_nos),
    ...(v2 ? voiceRules(a, b, { a: nameOf("a"), b: nameOf("b") }) : []),
    "",
    v2 ? sheetV2(a, "a", now.catchphraseUsed?.a, now.styles?.a) : sheetOf(a, "a", now.catchphraseUsed?.a),
    "",
    v2 ? sheetV2(b, "b", now.catchphraseUsed?.b, now.styles?.b) : sheetOf(b, "b", now.catchphraseUsed?.b),
    "",
    // What they're into and how the viewer frames them (lib/adult/profile.ts), and tonight's scenario: only when set.
    ...profileLines(names, now.profile?.turnOns ?? { a: [], b: [] }, now.profile?.framing ?? null),
    now.profile?.scenario ? `Tonight's scenario: ${now.profile.scenario.title}. ${now.profile.scenario.premise} Both of them chose to be here, and either can stop at any time.` : "",
    date ? `Their latest date: ${date.setting ?? "a date"}. It ended: ${date.ending ?? "unknown"}.` : "They haven't been on a date yet: they've just met.",
    dateTail.length ? `The end of that date:\n${dateTail.join("\n")}` : "",
    v2
      ? remembered.length
        ? `What they can remember (draw on these when it fits; a line that uses one puts its id in "memory"):\n${remembered.join("\n")}`
        : sheetItems.length
          ? `Nothing shared to remember yet (no facts, no memories between them). What each of them brings of their own life, to draw on (a line that uses one puts its id in "memory"):\n${sheetItems.map((s) => `[${s.label}] ${s.text}`).join("\n")}`
          : ""
      : now.memories?.length
        ? `What they can remember (draw on these; name the one a line uses in its "memory"):\n${now.memories.map((m, i) => `${i + 1}. ${m}`).join("\n")}`
        : "",
    now.recap ? `Earlier tonight (what's happened so far, keep it in mind and don't repeat it):\n${now.recap}` : "",
    sceneTail.length ? `The scene so far:\n${sceneTail.join("\n")}` : "The scene starts now, picking up where their date ended.",
    "",
    `Where they are now: ${where.place}${where.set && where.set.toLowerCase() !== where.place.toLowerCase() ? ` (the set: ${where.set})` : ""}. How far it's gone: ${STAGES[now.stage]} (stage ${now.stage + 1} of ${STAGES.length}: ${STAGES.join(" → ")}).${capped ? ` Tonight it goes no further than ${STAGES[cap]}.` : ""}`,
    // The night's places, so nobody asks "my place?" once they're there (Star × Chud, 2026-10-21, asked it at his place).
    (now.history?.length ?? 0) > 1 ? `Where they've been tonight, in order: ${historyPhrase(now.history!)}. They're at the last one now.` : "",
    now.homeNow ? `They're in ${nameOf(now.homeNow)}'s home now: nobody asks "my place?" or "your place?" again.` : "",
    "Pace and place, unless the steer says otherwise:",
    // The intensity is the viewer's ceiling: no steer lifts it (lib/adult/limits.ts).
    capped && now.stage > cap
      ? `- The viewer has turned it down to ${INTENSITY[limits.intensity].label.toLowerCase()}: from here it goes no further than ${STAGES[cap]}. Ease back to that gently (they slow down, talk, stay close) and stay there, whatever the steer says.`
      : capped && now.stage === cap && (now.linesAtStage ?? 0) >= MIN_LINES_PER_STAGE
        ? `- It's gone as far as tonight goes (${STAGES[cap]}): these lines stay there, with talk, looks and reactions, and go no further, whatever the steer says.`
        : (now.linesAtStage ?? 0) < MIN_LINES_PER_STAGE
          ? `- Tease it out. These lines stay at ${STAGES[now.stage]}: linger in it, with talk, looks, hesitation and anticipation. Don't move on to the next stage yet.`
          : now.stage < STAGES.length - 1
            ? `- Move it on. It has lingered long enough: in these lines it goes one stage further, to ${STAGES[now.stage + 1]}, and no further.`
            : "- Take your time: let it unfold, with talk and reactions between the actions.",
    now.cutTo
      ? `- The scene has just cut to ${now.cutTo}: they're there now. Open these lines on arriving there (how they got there, what they make of it) and carry on from there.`
      : (now.opening ?? lines.length === 0)
        ? `- The scene opens exactly where the date ended, still at ${now.place}. They don't leave in these first lines.`
        : "",
    "- They stay where they are. Going somewhere else takes one of them suggesting it in a line and the other agreeing in a later line; nobody steps onto a balcony, into a car or another room without that.",
    now.movesLeft === 0
      ? `- They've already moved ${MAX_SCENE_MOVES} times in this part of the night: these lines stay where they are.`
      : "- Once they've agreed to go somewhere, getting there takes a line or two at most; then the scene picks up at the new place. Don't keep saying \"let's go\".",
    "- Never say a line that's already been said tonight, word for word or nearly: every line is new.",
    "- Respect where they are. In a public place (a cafe, a bar, a restaurant, a street, a park, a venue) they can flirt, touch discreetly and, at most, kiss; other people are around and they act like it. Going further means one suggests leaving, the other agrees, and the lines show them going somewhere private (one of their places, a hotel). Only then does it go past kissing.",
    ...(v2
      ? craftLines(a, b, lines, {
          place: where.place,
          set: where.set,
          stage: now.stage,
          movesLeft: now.movesLeft,
          linesHere: now.linesHere,
          publicPlace: !(direction && now.steerMode === "direct") && isPublicPlace(where.set ?? where.place, now.homeNow ?? null),
          tellsUsed: now.tellsUsed,
        })
      : []),
  ]
    .filter((x) => x !== "")
    .join("\n");
  // The model client asks for a JSON object (response_format json_object), so the lines come inside one.
  const avoid = overusedWords(lines, [nameOf("a"), nameOf("b")]);
  // v2 says who speaks first (whoever didn't speak last), so a reply doesn't open on the same speaker twice.
  const next: "a" | "b" = lines.at(-1)?.who === "a" ? "b" : "a";
  const cite = now.facts?.[0]?.label ?? (now.memories?.length ? "M1" : (sheetItems[0]?.label ?? null));
  // v2.1's why: a specific memory or sheet detail, never a trait word on its own ("Sable is warm" said nothing, 2026-10-21).
  const trait = (b?.persona.traits[0] ?? "warm").toLowerCase();
  const whispered = whisperLines(now.whispers ?? {}, names);
  // v2's suggested next moves (lib/adult/director.ts), held to the pace and the place like a line.
  const publicNow = isPublicPlace(where.set ?? where.place, now.homeNow ?? null);
  const suggestionRule =
    ` "suggestions" are three short director's notes for what could happen next, one per heat: "mild" (gentle, warm), "flirty" (playful, teasing) and "spicy" (bolder: it moves things on).` +
    ` Each is under ${SUGGESTION_MAX} characters, in the third person about these two (like "She pulls him in to dance"), never a line of dialogue, and each keeps to the pace and the place:` +
    ` at most one stage further than these lines end on${capped ? `, and never past ${STAGES[cap]}` : ""}${publicNow ? "; while they're somewhere public, nothing past kissing, so the spicy one has them leave for somewhere private" : ""}.` +
    (hasHardNos(limits.hard_nos) ? " None of them goes near the hard limits." : "");
  const user =
    `Write the next ${LINES_PER_TURN} lines of the scene, alternating between ${first("a")} and ${first("b")}${v2 ? `, starting with ${first(next)}` : ""}. ` +
    `Each line is ${v2 ? "a few words to 3 sentences (now and then only an action)" : "1 to 3 sentences"} in that character's own voice, vivid and specific, never a stock line ("you feel amazing"). ` +
    (v2 ? "As it heats up they stay themselves: their humour and their way of talking keep showing, their work or a hobby now and then (not in every line), and nothing reads like a romance novel. " : "") +
    `Put what they do in "action" (a short phrase) and what they say in "text"; keep actions out of the text. Write both in English.` +
    (direction
      ? now.steerMode === "direct"
        ? v2
          ? ` Steer the scene this way, now: ${direction}. Act it out in their own words and actions, as these two characters would; never copy the steer's words into a line or an action.`
          : ` Steer the scene this way: ${direction}`
        : v2
          ? ` Lean the scene gently this way, at its own pace (the pace and place rules above still hold; work toward it, don't jump to it): ${direction}. Act it out in their own words; never copy the steer's words into a line or an action.`
          : ` Lean the scene gently this way, at its own pace (the pace and place rules above still hold; work toward it, don't jump to it): ${direction}`
      : " Move the scene forward: something new happens in these lines, nothing they've already done or said.") +
    // A whisper to one of them (lib/adult/director.ts): that one's own secret intention, never said aloud.
    (whispered.length ? ` ${whispered.join(" ")}` : "") +
    (avoid.length ? ` Don't lean on these words again: ${avoid.join(", ")}.` : "") +
    ` Reply with a JSON object: {"lines": [{"who": "a", "action": "...", "text": "...", "why": "...", "memory": null}, {"who": "b", "action": "", "text": "...", "why": "...", "memory": ${v2 ? (cite ? `"${cite}"` : "null") : '"..."'}}], "place": "where they are at the end of these lines", "set": "the place itself in 2 to 4 words, e.g. ${v2 ? "the bedroom" : "his bedroom"}: the same as now unless they agreed to go somewhere", "stage": 1, "explicit": false, "picture": null${v2 ? ', "suggestions": {"mild": "...", "flirty": "...", "spicy": "..."}' : ""}}, where "a" is ${first("a")} and "b" is ${first("b")}, and "stage" is the stage number (1 to ${STAGES.length}) at the end of these lines.` +
    (v2
      ? ` On every line, "why" is one short private sentence on why this character says or does this now, naming the specific thing behind it: a memory, a detail from their sheet (their job, a hobby, a tell, a line of their bio), what they want, or what just happened; never a trait word on its own ("${first("b")} is ${trait}" says nothing), and each line's why is its own ("the moment" says nothing either).` +
        // v2.2: Lexi × Dex's climax gave whys like "The climax, the shared moment" (2026-10-22).
        ` It's a whole sentence about this character's own reason, with a verb, even at the climax: never a fragment ("the climax, the shared moment").` +
        ` "memory" is the id of the memory it draws on from what they can remember (like "F3" or "M1"), or null, and only one this line uses.${sheetItems.length ? ` One of their own sheet details ("${sheetItems[0].label}"…) counts as a memory too.` : ""} Nobody sees these notes but the writer.`
      : ` On every line, "why" is one short private sentence on why this character says or does this now: the memory it draws on, a trait or tell from their sheet, what they want, or "the moment"; and "memory" is the memory it draws on, quoted or named from what they can remember, or null. Nobody sees these notes but the writer.`) +
    ` Set "explicit" to true once the scene is sexually explicit. Set "picture" only when, in these lines, one of them asks the other for a picture or to be shown something and the other agrees:` +
    ` {"of": "a", "b" or "both", "description": "what the picture shows, in one sentence: the pose, what they're wearing or not, the expression, the framing"}; otherwise null.` +
    (v2 ? suggestionRule : "");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** Letters outside the Latin script: the Venice text model sometimes slips into Russian, mostly in the actions. */
const FOREIGN = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u;

/** Drops *actions* written in another script (lines saved before the model was told to keep to English). */
export function dropForeignActions(text: string): string {
  return text.replace(/\*[^*]+\*\s*/g, (m) => (FOREIGN.test(m) ? "" : m)).trim() || text;
}

/**
 * A reply's JSON without the code fence some models put round it, or the object inside a sentence ("Here are the lines:
 * {…}"); anything else as it came.
 */
function unfence(raw: string): string {
  const t = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t)?.[1];
  if (fenced !== undefined) return fenced;
  if (t.startsWith("{") || t.startsWith("[")) return raw;
  const from = t.indexOf("{");
  const to = t.lastIndexOf("}");
  if (from > 0 && to > from) {
    try {
      const inner = t.slice(from, to + 1);
      const j = JSON.parse(inner) as { lines?: unknown } | null;
      if (j && typeof j === "object" && Array.isArray(j.lines)) return inner;
    } catch {
      /* as it came */
    }
  }
  return raw;
}

/** The lines in a model's reply: {"lines": [...]}, an array, a single line, "Name": "text" pairs, or "Name: text". */
export function parseSceneLines(reply: string, names: { a: string; b: string }): SceneLine[] {
  const raw = unfence(reply);
  const first = (n: string) => n.split(/\s+/)[0].toLowerCase();
  const sideOf = (who: string): "a" | "b" | null =>
    who === "a" || who.startsWith(first(names.a)) ? "a" : who === "b" || who.startsWith(first(names.b)) ? "b" : null;
  const clean = (x: string) => x.trim().slice(0, 1200);
  const trimmed = raw.trim();
  const start = trimmed.startsWith("{") ? 0 : raw.indexOf("[");
  const end = trimmed.startsWith("{") ? trimmed.length - 1 : raw.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(trimmed.startsWith("{") ? trimmed : raw.slice(start, end + 1)) as
        | { who?: string; text?: string; action?: string; why?: unknown; memory?: unknown; lines?: { who?: string; text?: string; action?: string; why?: unknown; memory?: unknown }[] }
        | { who?: string; text?: string; action?: string; why?: unknown; memory?: unknown }[];
      const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed.lines) ? parsed.lines : [parsed];
      // The action leads, in asterisks, so it never lands in the middle of a sentence.
      const withAction = (x: { text?: string; action?: string }) => {
        const raw = typeof x.action === "string" ? x.action.trim().replace(/^\*+|\*+$/g, "") : "";
        const act = FOREIGN.test(raw) ? "" : raw;
        return typeof x.text === "string" && x.text.trim() ? (act ? `*${act}* ${x.text.trim()}` : x.text) : act ? `*${act}*` : x.text;
      };
      // The private notes (why, memory), kept only when they're there: short, and never shown.
      const note = (v: unknown) => (typeof v === "string" && v.trim() && !/^(null|none|n\/a)$/i.test(v.trim()) ? v.trim().replace(/\s+/g, " ").slice(0, NOTE_MAX) : null);
      const out = arr
        .map((x) => ({ side: typeof x.who === "string" ? sideOf(x.who.trim().toLowerCase()) : null, text: withAction(x), why: note(x.why), memory: note(x.memory) }))
        .filter((x): x is { side: "a" | "b"; text: string; why: string | null; memory: string | null } => x.side !== null && typeof x.text === "string" && Boolean(x.text.trim()))
        .map((x) => ({ who: x.side, text: clean(x.text), ...(x.why ? { why: x.why } : {}), ...(x.why || x.memory ? { memory: x.memory } : {}) }));
      if (out.length) return out;
    } catch {
      /* fall through */
    }
  }
  const out: SceneLine[] = [];
  // "Ada": "text" pairs: a JSON object with repeated keys, which a parser would collapse.
  for (const m of raw.matchAll(/"([^"\n]{1,40})"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
    const side = sideOf(m[1].trim().toLowerCase());
    if (side && m[2].trim()) out.push({ who: side, text: clean(m[2].replace(/\\"/g, '"')) });
  }
  if (out.length) return out;
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*\**([^:*]{1,40})\**\s*:\s*(.+)$/);
    const side = m ? sideOf(m[1].trim().toLowerCase()) : null;
    if (m && side && m[2].trim()) out.push({ who: side, text: clean(m[2]) });
  }
  return out;
}

/**
 * What else the model said about these lines: whether the scene is explicit, a picture they agreed on, where they are, and
 * (v2) its suggested next moves, as proposed (lib/adult/director.ts holds them to the rules).
 */
export type SceneMeta = {
  explicit: boolean;
  picture: { of: "a" | "b" | "both"; description: string } | null;
  place: string | null;
  stage: number | null;
  set?: string | null;
  suggestions?: Partial<Record<Suggestion["heat"], unknown>>;
};

export function parseSceneMeta(raw: string): SceneMeta {
  try {
    const j = JSON.parse(unfence(raw).trim()) as { explicit?: unknown; picture?: { of?: unknown; description?: unknown } | null; place?: unknown; stage?: unknown; set?: unknown; suggestions?: unknown };
    const p = j.picture;
    const of = p && (p.of === "a" || p.of === "b" || p.of === "both") ? p.of : null;
    const description = p && typeof p.description === "string" ? p.description.trim().slice(0, 400) : "";
    const place = typeof j.place === "string" && j.place.trim() ? j.place.trim().slice(0, 120) : null;
    const n = Number(j.stage);
    const stage = Number.isFinite(n) ? Math.min(STAGES.length - 1, Math.max(0, Math.round(n) - 1)) : null;
    const set = typeof j.set === "string" && j.set.trim() ? j.set.trim().replace(/[.!]+$/, "").slice(0, 40) : null;
    return { explicit: j.explicit === true, picture: of && description ? { of, description } : null, place, stage, set, suggestions: suggestionsIn(j) };
  } catch {
    return { explicit: false, picture: null, place: null, stage: null, set: null, suggestions: {} };
  }
}

/** A scene line as a date turn, for the dates' critics (lib/quality.ts lineIssues). */
const asTurn = (l: SceneLine): Turn => {
  const m = l.text.match(/^\*([^*]+)\*\s*([\s\S]*)$/);
  return { side: l.who, act: 0, dialogue: (m ? m[2] : l.text).trim(), action: m ? m[1].trim() : "", emotion: "", interest: 0.5 };
};
/** The dates' critics read this many lines back (what the prompt holds), so a long chapter doesn't flag everything. */
const CRITIC_WINDOW = SCENE_IN_PROMPT;

export type DroppedLine = { who: "a" | "b"; text: string; reason: string };

/** What v2.2's craft guards took out on the way in, in lines that lost a part or went (dropRepeats). */
export type CraftCuts = { hooks: number; tells: number; actions: number; openings: number; build_ups: number };

/**
 * The new lines minus repeats (David, 2026-10-21: Star × Chud's lines 102–106 were 84–88 again): a line said before
 * tonight, word for word or nearly (lib/adult/continuity.ts repeatOf), or one the dates' near-duplicate critic flags is
 * dropped; a catchphrase past its once a chapter, or a tic the catchphrase critic flags, loses its sentence (the line
 * goes if nothing's left). `night` is everything said tonight that's at hand; `chapter` is this chapter's lines.
 *
 * `craft` (v2.2, Lexi × Dex on prod, 2026-10-22) adds, each cutting the part that does it and dropping the line when
 * nothing it says is left: a tell past TELL_CAP lines this chapter; an action from the last ACTION_WINDOW lines again
 * (only the action goes); an opening from the last OPENING_WINDOW lines again; the build-up ("almost there") again within
 * BUILD_UP_WINDOW lines; and a flagged hook past its share of the chapter (lib/adult/quality.ts hookAllowance).
 */
export function dropRepeats(
  written: readonly SceneLine[],
  night: readonly SceneLine[],
  chapter: readonly SceneLine[],
  a: Character | null,
  b: Character | null,
  opts: { worn?: boolean; craft?: boolean } = {},
): { kept: SceneLine[]; dropped: DroppedLine[]; worn: number; cuts: CraftCuts } {
  const kept: SceneLine[] = [];
  const dropped: DroppedLine[] = [];
  const drop = (l: SceneLine, reason: string) => dropped.push({ who: l.who, text: l.text, reason });
  // v2.1's worn phrases (lib/adult/quality.ts): each speaker's phrases tonight, so a fourth use loses its sentence.
  const named = phraseNames(a?.name ?? "", b?.name ?? "");
  const counts = opts.worn ? { a: countPhrases(night.filter((l) => l.who === "a"), named), b: countPhrases(night.filter((l) => l.who === "b"), named) } : null;
  let worn = 0;
  // v2.2: the hooks flagged tonight (once flagged, held to their share), and each one's tells.
  const cuts: CraftCuts = { hooks: 0, tells: 0, actions: 0, openings: 0, build_ups: 0 };
  const pair = [a?.name ?? "", b?.name ?? ""];
  const hooks = opts.craft ? { a: flaggedHooks(night, "a", pair), b: flaggedHooks(night, "b", pair) } : { a: [], b: [] };
  const tells = { a: sheetTells(a), b: sheetTells(b) };
  for (const l of written) {
    const before = [...night, ...kept];
    const mine = [...chapter, ...kept].filter((x) => x.who === l.who);
    // The catchphrase first (it would make any short line that says it look like the last one that did).
    let text: string | null = l.text;
    const phrase = (l.who === "a" ? a : b)?.extras.catchphrase;
    if (phrase && saysCatchphrase(text, phrase) && [...chapter, ...kept].some((x) => x.who === l.who && saysCatchphrase(x.text, phrase))) {
      text = withoutPhrase(text, (s) => saysCatchphrase(s, phrase));
      if (!text) {
        drop(l, "the catchphrase again this chapter");
        continue;
      }
    }
    if (opts.craft) {
      // v2.2: a tell already in TELL_CAP of their lines this chapter loses what shows it (Lexi spun her pencil 31 times).
      const tell = tells[l.who].find((t) => showsTell(text!, t) && mine.filter((x) => showsTell(x.text, t)).length >= TELL_CAP);
      if (tell) {
        cuts.tells++;
        text = withoutPart(text, (s) => showsTell(s, tell));
        if (!text) {
          drop(l, `a tell past ${TELL_CAP} lines this chapter ("${tell}")`);
          continue;
        }
      }
      // v2.2: an action from the last ACTION_WINDOW lines again goes; what they say stays (lines 36 and 38, the same action).
      const act = actionOf(text);
      const again = act ? actionRepeatOf(act, before.slice(-ACTION_WINDOW).map((x) => actionOf(x.text)).filter(Boolean)) : null;
      if (again) {
        cuts.actions++;
        text = text.replace(/^\s*\*[^*]+\*\s*/, "");
        if (!text.trim()) {
          drop(l, `the same action again ("${again.slice(0, 80)}")`);
          continue;
        }
      }
    }
    const rep = repeatOf(text, before.map((x) => x.text));
    if (rep) {
      drop(l, `${rep.kind === "verbatim" ? "said word for word" : "nearly said"} before: "${rep.of.slice(0, 80)}"`);
      continue;
    }
    if (a && b) {
      const issues = lineIssues(before.slice(-CRITIC_WINDOW).map(asTurn), asTurn({ ...l, text }), [a, b]);
      if (issues.near_duplicate) {
        drop(l, `nearly a line already said ("${issues.near_duplicate}")`);
        continue;
      }
      if (issues.catchphrase) {
        const tic = issues.catchphrase.split(" ");
        text = withoutPhrase(text, (s) => {
          const ws = new Set(contentWords(s, 4));
          return tic.every((w) => ws.has(w));
        });
        if (!text) {
          drop(l, `a tic ("${issues.catchphrase}")`);
          continue;
        }
      }
    }
    if (opts.craft) {
      // v2.2: a line opening like one of the last OPENING_WINDOW lines can't be rephrased here, only cut (lines 37 and 39).
      const opening = openingRepeatOf(text, before.slice(-OPENING_WINDOW).map((x) => x.text));
      if (opening) {
        cuts.openings++;
        text = withoutOpening(text, opening.split(" ").length);
        if (!text) {
          drop(l, `opens like a line just said ("${opening}")`);
          continue;
        }
      }
    }
    // v2.1: a phrase this speaker has already said in WORN_AT lines tonight ("let's see" in 23 of 59) loses its sentence;
    // the line goes if nothing's left. The v2.1 prompt lists these phrases, so the model was told.
    if (counts) {
      const phrases = counts[l.who];
      const hit = wornIn(text, phrases, named);
      if (hit) {
        worn++;
        text = withoutPhrase(text, (s) => wornIn(s, phrases, named) !== null);
        if (!text) {
          drop(l, `a worn phrase ("${hit.phrase}", already in ${hit.count} of their lines tonight)`);
          continue;
        }
      }
    }
    if (opts.craft) {
      // v2.2: the build-up said again by the same speaker within BUILD_UP_WINDOW lines: worn at its second use ("almost
      // there" three times before the climax).
      const up = buildUpIn(text);
      if (up && before.slice(-BUILD_UP_WINDOW).some((x) => x.who === l.who && buildUpIn(x.text))) {
        cuts.build_ups++;
        text = withoutPhrase(text, (s) => buildUpIn(s) !== null);
        if (!text) {
          drop(l, `the build-up again ("${up}")`);
          continue;
        }
      }
      // v2.2: a hook flagged tonight, past its share of their lines this chapter, loses the part with it (pie in 137 of 298).
      const over = hooks[l.who].filter((h) => touchesHook(text!, h) && mine.filter((x) => touchesHook(x.text, h)).length >= hookAllowance(mine.length));
      if (over.length) {
        cuts.hooks++;
        text = withoutPart(text, (s) => over.some((h) => touchesHook(s, h)));
        if (!text) {
          const used = mine.filter((x) => touchesHook(x.text, over[0])).length;
          drop(l, `a theme past its share this chapter ("${over[0].word}", in ${used} of their ${mine.length} lines)`);
          continue;
        }
      }
    }
    const line = text === l.text ? l : { ...l, text };
    kept.push(line);
    if (counts) for (const p of phrasesIn(line.text, named)) counts[l.who].set(p, (counts[l.who].get(p) ?? 0) + 1);
  }
  return { kept, dropped, worn, cuts };
}

export type ContinueResult =
  | { ok: true; scene: AdultScene; added: number; held: number; repeats: number; dropped: number; pictures: Media[]; picture_note?: string }
  | { ok: false; status: number; message: string };

/**
 * How a steer is taken (David, 2026-10-19: "is it a light suggestion?"): a nudge (the default) is worked toward at the
 * scene's own pace, the pacing rules still hold; direct does it now and can jump stages.
 */
export type SteerMode = "nudge" | "direct";

/**
 * What a scene keeps between steps (adult_scenes' columns): its lines, where it is, how far it's gone, where it's been,
 * and the director's: the last step's suggestions and the whispers still running.
 */
export type SceneState = Pick<AdultScene, "lines" | "prev_tail" | "place" | "stage" | "stage_from" | "set_place" | "cut_to" | "chapter" | "recap" | "place_history" | "moves"> & {
  suggestions?: Suggestion[];
  whispers?: Whispers;
};

/** A scene before its first line, picking up where the pair's latest date ended (as loadScene makes one). */
export const emptyScene = (): SceneState => ({
  lines: [], prev_tail: [], place: null, stage: 0, stage_from: 0, set_place: null, cut_to: null, chapter: 1, recap: null, place_history: [], moves: [], suggestions: [], whispers: {},
});

/** The scene writer's sampling (lib/adult/settings.ts); a null penalty isn't sent. */
export type Sampling = { temperature: number; frequency_penalty: number | null; presence_penalty: number | null; repetition_penalty: number | null };
export const samplingOf = (s: Pick<AdultSettings, "text_temperature" | "frequency_penalty" | "presence_penalty" | "repetition_penalty">): Sampling => ({
  temperature: s.text_temperature,
  frequency_penalty: s.frequency_penalty,
  presence_penalty: s.presence_penalty,
  repetition_penalty: s.repetition_penalty,
});

/**
 * One step of a scene, with everything it needs already loaded (stepContext), so the step itself reads and writes
 * nothing: only the model is called, and `resolveSet` when they move. continueScene runs it and saves the result; the
 * eval route (lib/adult/eval.ts) runs exactly the same step and saves nothing.
 */
export type StepInput = {
  model: Model;
  a: Character | null;
  b: Character | null;
  /** The pair as stored (lower id first), with their names. */
  pair: { a: { id: string; name: string }; b: { id: string; name: string } };
  date: LatestDate | null;
  scene: SceneState;
  /** The steer, trimmed and already held to the two lines; null for none. */
  steer: string | null;
  steerMode: SteerMode;
  promptVersion: PromptVersion;
  sampling: Sampling;
  /** sceneMemories: their latest date's ending, the PG notes, what each remembers the other saying. */
  memories: readonly string[];
  /** The pair's remembered facts, both ways (lib/adult/facts.ts); v2 picks the few that fit. */
  facts: readonly AdultFact[];
  /** Each one's best lines from their show dates (lib/adult/voice.ts styleExamples), for v2. */
  styles: { a: readonly string[]; b: readonly string[] };
  /** Every other character's given name, lower-cased (lib/adult/voice.ts castNames): who a line mustn't bring in. */
  cast: ReadonlySet<string>;
  /** The set a move lands on: production reuses a drawn one or draws it (lib/sets.ts resolveSet); default, its canonical name. */
  resolveSet?: (label: string) => Promise<string> | string;
  /** For retrieval's recency (tests). */
  now?: Date;
  /** The whispers this step plays (lib/adult/director.ts), already held to the two lines; else the scene's own. */
  whispers?: Whispers;
  /** The viewer's limits for the pair (lib/adult/limits.ts); none (explicit, no hard nos) when left out. */
  limits?: PairLimits;
  /** Their profiles (lib/adult/profile.ts) and tonight's scenario; none when left out. */
  profile?: SceneProfile;
};

/** What the prompt knows of their profiles: each one's turn-ons (those the hard nos allow), the framing, tonight's scenario. */
export type SceneProfile = { turnOns: { a: string[]; b: string[] }; framing: FramingId | null; scenario: Scenario | null };

/** What happened to a step's lines on the way in, summed over its calls. */
export type StepFlags = {
  calls: number;
  /** All the safe lines of the first reply were dropped, so it was asked once more. */
  retried: boolean;
  /** Lines that crossed one of the two lines (withheld from every response). */
  held: number;
  /** Lines dropped as repeats of tonight's or of their show lines (dropRepeats). */
  repeats: number;
  names_repaired: number;
  names_dropped: number;
  alternation_merged: number;
  alternation_dropped: number;
  /** A reply's first line by whoever spoke last: kept (dropping it would drop its proposal), counted. */
  alternation_boundary: number;
  /** Lines where the model stepped out of the scene to refuse (dropped), or to lecture (kept, counted). */
  refused: number;
  moralising: number;
  /** The reply had no lines, only a refusal. */
  refusal_reply: boolean;
  /** Per kept line, in order: what its private "memory" cited (lib/adult/facts.ts citeMemory). */
  citations: Citation[];
  /** v2.1: lines that lost a sentence, or went, for reusing a worn phrase (dropRepeats), or part of a show or sample line. */
  worn_phrases: number;
  show_copies_cut: number;
  /** v2.1: lines dropped for going past kissing in a public place. */
  public_dropped: number;
  /**
   * v2.2: lines that lost a part, or went, to dropRepeats' craft guards: a hook past its share, a tell past TELL_CAP, an
   * action or an opening said again, the build-up again.
   */
  hooks_cut: number;
  tells_cut: number;
  actions_cut: number;
  openings_cut: number;
  build_ups_cut: number;
  /** The director: lines dropped for saying a whisper out loud; suggestions replaced by a plain one, or left out. */
  whispers_said?: number;
  suggestions_replaced?: number;
  /** The viewer's limits: lines dropped for crossing a hard no (the step is asked once more), or going past the intensity. */
  hard_nos?: number;
  intensity_dropped?: number;
  /** Logged on a redo's step (the step it took back is marked rewound). */
  redo?: boolean;
};

/** "kissing" (STAGES): as far as it goes in a public place (David, 2026-10-18). */
const KISSING = STAGES.indexOf("kissing");

/** A character's own sample lines (lib/extras.ts), raw: v2.1 cuts a sentence that copies part of one. */
const sampleLines = (c: Character | null): string[] => Object.values(c?.extras.lines ?? {}).filter((x): x is string => typeof x === "string" && Boolean(x.trim()));

/** The first few words a line says (its action out), to name it without repeating all of it. */
const openingOf = (text: string): string => {
  const words = text.replace(/\*[^*]*\*/g, " ").trim().split(/\s+/).filter(Boolean);
  return words.length ? `${words.slice(0, 6).join(" ")}${words.length > 6 ? "…" : ""}` : "";
};

/**
 * v2.1's note when a reply only repeated what's been said tonight (the prod repeat lock, 2026-10-21): the lines that can't
 * come back, by how they open, and the worn phrases that cost a line.
 */
function repeatNote(repeated: readonly DroppedLine[]): string {
  const openings = [...new Set(repeated.map((d) => openingOf(d.text)).filter(Boolean))].slice(0, 6);
  const worn = [...new Set(repeated.map((d) => /^a worn phrase \("([^"]+)"/.exec(d.reason)?.[1]).filter((x): x is string => Boolean(x)))];
  return (
    `Your last reply only said again what's been said tonight, and a new action in front doesn't make a line new.` +
    (openings.length ? ` These can't come back, in any form: ${openings.map((o) => `"${o}"`).join(", ")}.` : "") +
    (worn.length ? ` These phrases are worn out: ${worn.map((w) => `"${w}"`).join(", ")}.` : "") +
    ` Write ${LINES_PER_TURN} new lines that move the scene on, with something they haven't said or done yet. Reply with the JSON again.`
  );
}

/** The retry after nothing but repeats runs a little hotter, with stronger penalties (v2.1). */
const hotter = (o: ModelOptions): ModelOptions => ({
  ...o,
  temperature: Math.min(1.2, (o.temperature ?? 0.8) + 0.2),
  frequencyPenalty: Math.min(1.2, (o.frequencyPenalty ?? 0) + 0.4),
  presencePenalty: Math.min(1.2, (o.presencePenalty ?? 0) + 0.4),
});

export type StepResult =
  | { ok: true; lines: SceneLine[]; meta: SceneMeta; dropped: DroppedLine[]; flags: StepFlags; next: SceneState; shown: ShownFact[]; usage: Usage[] }
  | { ok: false; status: 422 | 502; message: string; dropped: DroppedLine[]; flags: StepFlags; shown: ShownFact[]; usage: Usage[]; raw?: string };

/**
 * Writes the next lines of a scene and runs them through every guard, in order: the two lines (lib/safety.ts
 * checkAdultText; withheld), a line that steps out of the scene to refuse, the name guard (a near-miss of their names
 * repaired, a line naming anyone else dropped), repeats (of tonight, or of their show lines), and the turn-taking. When
 * nothing safe survives it asks once more, saying why. Then: what each line's memory cites, where they are now (a move
 * needs a proposal and a yes, lib/adult/continuity.ts), and the stage. Returns the new lines and the scene after them.
 */
export async function writeSceneStep(input: StepInput): Promise<StepResult> {
  const { a, b, pair, scene, date, steer, steerMode } = input;
  const names = { a: pair.a.name, b: pair.b.name };
  const v2 = input.promptVersion === "v2";
  // The viewer's limits (lib/adult/limits.ts): the intensity's ceiling and the hard nos hold over every steer.
  const limits = input.limits ?? NO_LIMITS;
  const cap = INTENSITY[limits.intensity].maxStage;
  // The whispers this step plays (lib/adult/director.ts): one sent with it, and any still running from the step before.
  const whispers = input.whispers ?? storedWhispers(scene.whispers);
  const whispered = [whispers.a?.text, whispers.b?.text].filter((t): t is string => Boolean(t));
  const night = [...scene.prev_tail, ...scene.lines];
  const homeNow = scene.place_history.at(-1)?.home ?? null;
  const movesTaken = scene.moves.filter((m) => m.taken && m.reason === "agreed" && m.chapter === scene.chapter).length;
  const catchphraseUsed = {
    a: Boolean(a?.extras.catchphrase) && scene.lines.some((l) => l.who === "a" && saysCatchphrase(l.text, a!.extras.catchphrase)),
    b: Boolean(b?.extras.catchphrase) && scene.lines.some((l) => l.who === "b" && saysCatchphrase(l.text, b!.extras.catchphrase)),
  };
  // v2 brings back the facts that fit the last few lines, and their show lines; v1 is the prompt as it was.
  const shown = v2 ? retrieveFacts(input.facts, night.slice(-RECENT_LINES).map((l) => l.text), { now: input.now, names: [names.a, names.b] }) : [];
  const styles = v2 ? input.styles : { a: [], b: [] };
  // v2.1: a new pair (no facts shown, nothing remembered) draws on their own sheets instead, numbered S1… (lib/adult/facts.ts).
  const sheetItems = v2 && !shown.length && !input.memories.length ? sheetMemories(a, b) : [];
  // v2.1: nothing past kissing in a public place (David, 2026-10-18), by where they are, not the model's claim; never
  // below how far it had already gone, and not under a Direct steer (which can jump).
  const publicCap =
    v2 && !(steer && steerMode === "direct") && isPublicPlace(scene.set_place ?? scene.place ?? date?.setting ?? null, homeNow) ? Math.max(KISSING, scene.stage) : null;
  const messages = sceneMessages(a, b, date, night, steer, pair.a.id, {
    place: placeOf(scene, date),
    stage: scene.stage,
    linesAtStage: scene.lines.length - scene.stage_from,
    cutTo: scene.cut_to,
    recap: scene.recap,
    opening: scene.chapter === 1 && scene.lines.length === 0,
    steerMode,
    set: scene.set_place,
    history: scene.place_history,
    homeNow,
    movesLeft: Math.max(0, MAX_SCENE_MOVES - movesTaken),
    memories: [...input.memories],
    catchphraseUsed,
    promptVersion: input.promptVersion,
    facts: shown,
    styles,
    sheetItems,
    linesHere: linesAtPlace(scene),
    // v2.2: a tell that's had its TELL_CAP lines this chapter is named, like a catchphrase that's had its once.
    ...(v2 ? { tellsUsed: { a: tellsAtCap(scene.lines, "a", a), b: tellsAtCap(scene.lines, "b", b) } } : {}),
    whispers,
    limits,
    profile: input.profile,
  });
  const usage: Usage[] = [];
  const flags: StepFlags = {
    calls: 0, retried: false, held: 0, repeats: 0, names_repaired: 0, names_dropped: 0, alternation_merged: 0, alternation_dropped: 0, alternation_boundary: 0,
    refused: 0, moralising: 0, refusal_reply: false, citations: [], worn_phrases: 0, show_copies_cut: 0, public_dropped: 0,
    hooks_cut: 0, tells_cut: 0, actions_cut: 0, openings_cut: 0, build_ups_cut: 0, whispers_said: 0, suggestions_replaced: 0, hard_nos: 0, intensity_dropped: 0,
  };
  const { temperature, frequency_penalty, presence_penalty, repetition_penalty } = input.sampling;
  const options: ModelOptions = {
    temperature,
    maxTokens: SCENE_REPLY_TOKENS,
    ...(frequency_penalty !== null ? { frequencyPenalty: frequency_penalty } : {}),
    ...(presence_penalty !== null ? { presencePenalty: presence_penalty } : {}),
    ...(repetition_penalty !== null ? { repetitionPenalty: repetition_penalty } : {}),
    onUsage: (u) => usage.push(u),
  };
  // A copy of one of their own show lines is a repeat too: v2 shows them to match the voice, never to say again. (Checked
  // on its own: in dropRepeats' window the critic would read their signature words as a tic.)
  const showLines = [...styles.a, ...styles.b];
  // v2.1: part of one copied counts too (COPIED_RUN words in a row), from their show lines or their sheet's sample lines.
  const ownLines = { a: v2 ? [...styles.a, ...sampleLines(a)] : [], b: v2 ? [...styles.b, ...sampleLines(b)] : [] };
  const dropped: DroppedLine[] = [];

  const guard = (raw: string) => {
    const written = parseSceneLines(raw, names);
    const drops: DroppedLine[] = [];
    const safe = written.filter((l) => {
      if (checkAdultText({ line: l.text }).ok) return true;
      flags.held++;
      drops.push({ who: l.who, text: "", reason: "crossed one of the two lines (withheld)" });
      return false;
    });
    const inScene: SceneLine[] = [];
    let named = 0;
    let refused = 0;
    // The viewer's limits, whatever the steer: a hard no crossed (the step is asked once more), or past the intensity.
    const hardHits: string[] = [];
    let limited = 0;
    for (const l of safe) {
      const hard = hardNoHit(l.text, limits.hard_nos);
      if (hard) {
        hardHits.push(hard);
        flags.hard_nos = (flags.hard_nos ?? 0) + 1;
        drops.push({ who: l.who, text: l.text, reason: `crossed a hard limit (${hard})` });
        continue;
      }
      const over = limitsHit(l.text, { intensity: limits.intensity, hard_nos: { chips: [], own: [] } });
      if (over) {
        limited++;
        flags.intensity_dropped = (flags.intensity_dropped ?? 0) + 1;
        drops.push({ who: l.who, text: l.text, reason: over });
        continue;
      }
      const r = refusalIn(l.text);
      if (r === "moralising") flags.moralising++;
      if (r === "refusal") {
        refused++;
        drops.push({ who: l.who, text: l.text, reason: "out of the scene: the model refused" });
        continue;
      }
      const g = guardNames(l.text, { a: names.a, b: names.b, cast: input.cast });
      if (g.stranger) {
        named++;
        drops.push({ who: l.who, text: l.text, reason: `names someone who isn't in the scene (${g.stranger})` });
        continue;
      }
      flags.names_repaired += g.repairs.length;
      // The steer acted out, never quoted (lib/adult/stage-floor.ts): an action that copies it goes, a line that does is dropped.
      const own = withoutSteerCopy(g.text, steer);
      if (!own) {
        drops.push({ who: l.who, text: l.text, reason: "copied the steer instead of acting it out" });
        continue;
      }
      // A whisper is played, never said aloud (lib/adult/director.ts), by either of them: the same rule as the steer.
      let played: { text: string } | null = own;
      for (const w of whispered) played = played && withoutSteerCopy(played.text, w);
      if (!played) {
        flags.whispers_said = (flags.whispers_said ?? 0) + 1;
        drops.push({ who: l.who, text: l.text, reason: "said a whisper out loud" });
        continue;
      }
      inScene.push(played.text === l.text ? l : { ...l, text: played.text });
    }
    // v2.1: in a public place, a line showing more than kissing goes (publicCap), until these lines agree to go somewhere
    // (a yes here, or one just before and them going here: lib/adult/continuity.ts shownMove).
    let publicDropped = 0;
    const heard = [...night, ...inScene];
    const leaveAt =
      publicCap === null
        ? -1
        : Math.min(
            agreedMove(heard, night.length)?.agree ?? Infinity,
            shownMove(heard, night.length, scene.set_place ?? scene.place ?? date?.setting ?? null, names)?.at ?? Infinity,
          ) - night.length;
    const inPlace =
      publicCap === null
        ? inScene
        : inScene.filter((l, i) => {
            const shownStage = i < leaveAt ? stageShown(l.text) : null;
            if (shownStage === null || shownStage <= publicCap) return true;
            publicDropped++;
            drops.push({ who: l.who, text: l.text, reason: `went past kissing in a public place (${scene.set_place ?? scene.place ?? date?.setting ?? "where they are"})` });
            return false;
          });
    const reps = dropRepeats(inPlace, night, scene.lines, a, b, { worn: v2, craft: v2 });
    const fresh = reps.kept.flatMap((l): SceneLine[] => {
      const copy = showLines.length ? repeatOf(l.text, showLines) : null;
      if (copy) {
        reps.dropped.push({ who: l.who, text: l.text, reason: `repeats one of their show lines: "${copy.of.slice(0, 80)}"` });
        return [];
      }
      // v2.1: part of one of their show or sample lines copied: that sentence goes, and the line if nothing's left.
      const part = copiedRun(l.text, ownLines[l.who]);
      if (!part) return [l];
      const text = withoutPhrase(l.text, (s) => copiedRun(s, ownLines[l.who]) !== null);
      if (text === l.text) return [l];
      flags.show_copies_cut++;
      if (text) return [{ ...l, text }];
      reps.dropped.push({ who: l.who, text: l.text, reason: `reuses part of one of their show lines ("${part}")` });
      return [];
    });
    const turns = guardAlternation(fresh, night.at(-1)?.who ?? null, { keepReplies: v2 });
    flags.refused += refused;
    flags.names_dropped += named;
    flags.public_dropped += publicDropped;
    flags.repeats += reps.dropped.length;
    flags.worn_phrases += reps.worn;
    flags.hooks_cut += reps.cuts.hooks;
    flags.tells_cut += reps.cuts.tells;
    flags.actions_cut += reps.cuts.actions;
    flags.openings_cut += reps.cuts.openings;
    flags.build_ups_cut += reps.cuts.build_ups;
    flags.alternation_merged += turns.merged;
    flags.alternation_dropped += turns.dropped.length;
    dropped.push(...drops, ...reps.dropped, ...turns.dropped);
    // Only repeats stood in the way (the note, and the message, say so as before).
    const onlyRepeats = reps.dropped.length > 0 && refused + named + publicDropped + turns.dropped.length + hardHits.length + limited === 0;
    return { raw, written, safe, kept: turns.kept, boundary: turns.boundary, onlyRepeats, repeated: reps.dropped, hardHits };
  };

  let out: ReturnType<typeof guard>;
  try {
    flags.calls++;
    out = guard(await input.model.complete(messages, options));
    if (out.hardHits.length) {
      // A hard limit crossed (lib/adult/limits.ts): those lines are out, and the step is asked once more, told which, with
      // nothing of the reply to copy from. The second reply is held to everything again; when nothing of it can be kept,
      // the first reply's other lines stand.
      flags.retried = true;
      flags.calls++;
      const limitsNote =
        `Your last reply crossed the viewer's hard limits (${[...new Set(out.hardHits)].join(", ")}). Those never happen and are never offered or asked for, ` +
        `in a line, an action or a suggestion, whatever the steer says. Write ${LINES_PER_TURN} new lines that keep to them. Reply with the JSON again.`;
      try {
        const second = guard(await input.model.complete([messages[0], { role: "user", content: `${messages[1].content}\n\n${limitsNote}` }], options));
        if (second.kept.length || !out.kept.length) out = second;
      } catch (err) {
        if (!out.kept.length) throw err;
      }
    } else if (out.safe.length && !out.kept.length) {
      // Nothing safe was kept (all repeats, or out of the scene): once more, told why (the only time a step costs a second call).
      flags.retried = true;
      // v2.1, the repeat lock (Cass × Chud on prod, 2026-10-21: the retry came back all repeats too): after nothing but
      // repeats, ask once more without the repeated reply to copy from, naming what can't come back, a little hotter.
      const hot = v2 && out.onlyRepeats;
      const note = hot
        ? repeatNote(out.repeated)
        : out.onlyRepeats
          ? `Every line you wrote was already said tonight (${out.repeated.map((d) => `"${d.text.slice(0, 60)}"`).slice(0, 3).join(", ")}). Write ${LINES_PER_TURN} new lines that move the scene on. Reply with the JSON again.`
          : `None of the lines you wrote could be used (${[...new Set(dropped.map((d) => d.reason.replace(/\s*[(:].*$/, "")))].join("; ")}). Write ${LINES_PER_TURN} new lines, only between ${names.a.split(/\s+/)[0]} and ${names.b.split(/\s+/)[0]}, taking turns, that move the scene on. Reply with the JSON again.`;
      flags.calls++;
      const again: ChatMessage[] = hot
        ? [messages[0], { role: "user", content: `${messages[1].content}\n\n${note}` }]
        : [...messages, { role: "assistant", content: out.raw }, { role: "user", content: note }];
      out = guard(await input.model.complete(again, hot ? hotter(options) : options));
    }
  } catch (err) {
    return { ok: false, status: 502, message: `After dark's model didn't answer: ${err instanceof Error ? err.message : "error"}`, dropped, flags, shown, usage };
  }
  const { raw, written } = out;
  flags.alternation_boundary += out.boundary;
  if (!written.length && refusalIn(raw)) flags.refusal_reply = true;
  if (!out.kept.length) {
    return {
      ok: false,
      status: 422,
      message: !written.length
        ? "The model's reply had no lines in it. Try again."
        : !out.safe.length
          ? "Every line crossed one of the two lines and was dropped. Try again."
          : out.onlyRepeats
            ? "The model only repeated lines already said tonight. Try again, or steer it somewhere new."
            : "None of the model's lines could be kept (they named someone who isn't here, broke the turn-taking, or stepped out of the scene). Try again.",
      dropped,
      flags,
      shown,
      usage,
      ...(flags.refusal_reply ? { raw: raw.slice(0, 400) } : {}),
    };
  }
  // What each line's memory cites: a fact shown (by its id, a quote or its words), another memory, a new pair's sheet
  // detail (v2.1), or tonight so far. v2.2: a fact the line doesn't use is loose, never one of its fact_ids (not bumped).
  const others = [...memoryLabels(input.memories), ...sheetItems];
  const context = [scene.recap ?? "", ...(date?.transcript ?? []).map((t) => t.dialogue), ...night.slice(-SCENE_IN_PROMPT).map((l) => l.text)].join("\n");
  flags.citations = out.kept.map((l) => citeMemory(l.memory, shown, others, context, { text: l.text, names: [names.a, names.b] }));
  let kept = out.kept.map((l, i) => (flags.citations[i].facts.length ? { ...l, fact_ids: flags.citations[i].facts } : l));

  const meta = parseSceneMeta(raw);
  const resolve = async (label: string) => (input.resolveSet ? await input.resolveSet(label) : drawLabel(label).slice(0, 40));
  // v2.2 (Lexi × Dex on prod, 2026-10-22: "Lexis bedroom", typed into set the scene without its apostrophe): a name that
  // lost its apostrophe gets it back, where they are and in what the model claims, so the set they're on is put right too.
  const named = (label: string | null) => possessiveNames(label, names);
  // Where they are now (lib/adult/continuity.ts): a rewording keeps the set; a move needs one to propose and the other
  // to agree in these lines, a move left this chapter, and somewhere they aren't already. Anything else is ignored.
  const settled = settlePlace({
    // Before the model has named a place, they're where their date was (they don't leave it unprompted either).
    current: { place: named(scene.place ?? date?.setting ?? null), set: named(scene.set_place) },
    claimed: { place: named(meta.place), set: named(meta.set ?? null) },
    lines: [...night, ...kept],
    from: night.length,
    movesThisChapter: movesTaken,
    homeNow,
    names,
    fromLines: v2,
  });
  // The public cap goes by the same signal as the place (botchelor-41, 2026-10-22): a line past kissing that the guard let
  // through because these lines agreed to go goes after all when the move wasn't taken (a third this chapter, or nowhere
  // new), so the stage can't climb past the cap while they're still somewhere public.
  if (publicCap !== null && !settled.moved) {
    const over = kept.map((l) => (stageShown(l.text) ?? 0) > publicCap);
    if (over.some(Boolean)) {
      const where = scene.set_place ?? scene.place ?? date?.setting ?? "where they are";
      kept.forEach((l, i) => over[i] && dropped.push({ who: l.who, text: l.text, reason: `went past kissing in a public place (${where}): the move they agreed to wasn't taken` }));
      flags.public_dropped += over.filter(Boolean).length;
      flags.citations = flags.citations.filter((_, i) => !over[i]);
      kept = kept.filter((_, i) => !over[i]);
      if (!kept.length) return { ok: false, status: 422, message: "Their lines went past kissing somewhere public without leaving it. Try again, or steer them somewhere private.", dropped, flags, shown, usage };
    }
  }
  let set_place = settled.set;
  // v2.1: a possessive neither of them goes by is put right ("his apartment entrance" with two women; their sheets'
  // pronouns, lib/adult/craft.ts). Lines are only flagged (the observer, the metrics).
  const place = v2 ? repairPlacePronouns(settled.place, { a: a?.pronouns, b: b?.pronouns }, names, settled.moved ? settled.moved.home : homeNow).text : settled.place;
  let place_history = scene.place_history;
  const moves = [...scene.moves];
  if (settled.moved) {
    // The closest set already drawn for the new place, else its canonical name, drawn once in the background.
    set_place = await resolve(settled.moved.to);
    kept[settled.moved.at] = { ...kept[settled.moved.at], moved_to: set_place };
    moves.push({ chapter: scene.chapter, at: scene.lines.length + settled.moved.at, from: scene.set_place ?? scene.place, to: set_place, taken: true, reason: "agreed" });
    place_history = [...place_history, { place: place ?? set_place, set: set_place, home: settled.moved.home, chapter: scene.chapter }];
  } else if (set_place && set_place !== scene.set_place) {
    // The scene's first set (or one named where the old one named nowhere, or v2.2's "Lexis bedroom" put right): the
    // closest drawn one, no move. The stop is the same one renamed, so it keeps the chapter they got there in.
    set_place = await resolve(set_place);
    place_history = [...place_history.slice(0, -1), { place: place ?? set_place, set: set_place, home: homeNow, chapter: place_history.at(-1)?.chapter ?? scene.chapter }];
  }
  if (settled.rejected) moves.push({ chapter: scene.chapter, at: scene.lines.length, from: scene.set_place ?? scene.place, to: settled.rejected.to, taken: false, reason: settled.rejected.reason });
  if (!place_history.length && (place || set_place)) place_history = [{ place: place ?? set_place!, set: set_place, home: null, chapter: scene.chapter }];
  // Unsteered, the stage moves at most one step, and only once the current one has had its lines; a steer can jump. Never
  // past the intensity's ceiling, a Direct steer included.
  const allowed = Math.min(cap, steer && steerMode === "direct" ? STAGES.length - 1 : scene.lines.length - scene.stage_from >= MIN_LINES_PER_STAGE ? scene.stage + 1 : scene.stage);
  // The model's claim, raised to what the lines plainly show when it ran behind them (lib/adult/stage-floor.ts); each line
  // carries the stage it was at, for the theater's label.
  const { perLine, stage } = stagesFor(kept, scene.stage, Math.min(meta.stage ?? scene.stage, allowed, publicCap !== null && !settled.moved ? publicCap : STAGES.length - 1));
  const stamped = kept.map((l, i) => ({ ...l, stage: perLine[i] }));
  const stage_from = stage === scene.stage ? scene.stage_from : scene.lines.length;
  // v2's suggested next moves (lib/adult/director.ts), held to the rules a line is, for the scene as these lines leave it:
  // at most a stage on, and past kissing somewhere public only by leaving first.
  const { suggestions, replaced } = v2
    ? suggestionsFor(meta.suggestions ?? {}, {
        stage,
        maxStage: Math.min(cap, stage + 1),
        publicPlace: isPublicPlace(set_place ?? place ?? date?.setting ?? null, place_history.at(-1)?.home ?? null),
        names,
        cast: input.cast,
        limit: (text) => limitsHit(text, limits),
      })
    : { suggestions: [], replaced: 0 };
  flags.suggestions_replaced = replaced;
  const next: SceneState = {
    ...scene, lines: [...scene.lines, ...stamped], place, stage, stage_from, set_place, cut_to: null, place_history, moves, suggestions, whispers: afterWhisperStep(whispers),
  };
  return { ok: true, lines: stamped, meta, dropped, flags, next, shown, usage };
}

/** What a step needs from the database, loaded read-only (stepContext). */
export type StepContext = {
  a: Character | null;
  b: Character | null;
  date: LatestDate | null;
  settings: AdultSettings;
  memories: string[];
  facts: AdultFact[];
  styles: { a: string[]; b: string[] };
  cast: Set<string>;
};

/**
 * Everything a step reads, and nothing it writes: the two characters (sheet, voice kit, look), their latest date, After
 * Dark's settings, what they remember (sceneMemories) and their facts, each one's best show lines, and everyone else's
 * names. `memories: false` and `facts: false` leave those out (the eval's memory modes).
 */
export async function stepContext(db: Db, ownerId: string, aId: string, bId: string, opts: { memories?: boolean; facts?: boolean } = {}): Promise<StepContext> {
  const [a, b, date, settings, cast] = await Promise.all([sceneCharacter(db, aId), sceneCharacter(db, bId), latestDate(db, aId, bId), getAdultSettings(db), castNames(db, [aId, bId])]);
  const [memories, facts, styleA, styleB] = await Promise.all([
    opts.memories === false ? Promise.resolve<string[]>([]) : sceneMemories(db, ownerId, a, b, date),
    opts.facts === false ? Promise.resolve<AdultFact[]>([]) : loadPairFacts(db, ownerId, aId, bId),
    a ? styleExamples(db, a.id, ownerId, cast) : Promise.resolve<string[]>([]),
    b ? styleExamples(db, b.id, ownerId, cast) : Promise.resolve<string[]>([]),
  ]);
  return { a, b, date, settings, memories, facts, styles: { a: styleA, b: styleB }, cast };
}

/**
 * Why a steer or whisper can't be sent under the pair's limits (lib/adult/limits.ts): it asks for one of the viewer's hard
 * nos, or for more than the intensity allows. Null when it can.
 */
export function limitRefusal(what: "steer" | "whisper", text: string | null, scene: Pick<AdultScene, "intensity" | "hard_nos" | "stage">): string | null {
  if (!text) return null;
  const hard = hardNoHit(text, scene.hard_nos);
  if (hard) return `That ${what} asks for one of your hard limits for these two (${hard}). Change it, or the limits, first.`;
  const level = INTENSITY[scene.intensity];
  const asked = stageAsked(text, scene.stage);
  if (asked !== null && asked > level.maxStage) return `That ${what} goes past ${STAGES[level.maxStage]}, as far as ${level.label.toLowerCase()} goes. Change it, or turn the intensity up, first.`;
  return null;
}

/** The scene's profile for the prompt: each one's turn-ons the hard nos allow, the framing, and tonight's scenario. */
async function sceneProfile(db: Db, scene: AdultScene): Promise<SceneProfile> {
  const [a, b] = await Promise.all([turnOnsOf(db, scene.a.id), turnOnsOf(db, scene.b.id)]);
  return {
    turnOns: { a: turnOnsFor(a, scene.hard_nos), b: turnOnsFor(b, scene.hard_nos) },
    framing: scene.framing,
    scenario: scene.scenario ? scenarioById(scene.scenario) : null,
  };
}

/** Which of the lines that never move a refused text crossed, in words for the person who typed it. */
export function linesCrossed(r: SafetyResult): string {
  if (r.ok) return "";
  if (r.theme === "family") return "no family or step-family roleplay";
  if (r.theme === "teacher_student") return "no teacher and student roleplay";
  if (r.theme === "school") return "no school settings";
  if (r.theme === "age_play") return "no age-play";
  return r.reason === "real_person" ? "no real people" : "nobody under 18, or anything that suggests it";
}

/** What a step can bring besides the steer: a whisper to one of the two, and whether it's a redo (logged as one). */
export type StepOptions = { whisper?: { to: "a" | "b"; text: string } | null; redo?: boolean };

/**
 * Writes the next lines of a pair's scene (writeSceneStep) on After Dark's model and saves them: the scene, the month's
 * count, the facts the lines cited, pictures when it turns explicit or they ask, and the chapter when it's full. A
 * whisper to one of them (lib/adult/director.ts) is held to the two lines like a steer, played this step and the next,
 * and kept on the step's log. Each step leaves what a rewind needs to take it back (StepUndo), UNDO_DEPTH deep.
 */
export async function continueScene(db: Db, adminId: string, x: string, y: string, direction: string | null, steerMode: SteerMode = "nudge", opts: StepOptions = {}): Promise<ContinueResult> {
  const scene = await loadScene(db, adminId, x, y);
  if (!scene) return { ok: false, status: 404, message: "Pick two characters who are in after dark: this season's cast, or ones you've switched on." };
  // Every step goes in the admin's log (lib/adult/steps.ts): what was asked, and what came of it or the error.
  const pairIds = { a: scene.a.id, b: scene.b.id };
  const whisperText = opts.whisper ? cleanWhisper(opts.whisper.text) : "";
  const whisper = opts.whisper && whisperText ? { to: opts.whisper.to, text: whisperText } : null;
  const failed = async (http: number, message: string, extra: { direction?: string | null; dropped?: DroppedLine[]; flags?: StepFlags; whisper?: StepOptions["whisper"] } = {}) => {
    await logStep(db, adminId, pairIds, scene.id, {
      kind: "write", direction: extra.direction ?? null, steer_mode: extra.direction ? steerMode : null, status: "error", http, message, chapter: scene.chapter,
      line_from: null, line_to: null, added: 0, dropped: extra.dropped ?? [], flags: extra.flags ? { ...extra.flags, ...(opts.redo ? { redo: true } : {}) } : opts.redo ? { redo: true } : null,
      whisper: extra.whisper ?? null,
    });
    return { ok: false as const, status: http, message };
  };
  const capped = await overCap(db, adminId, "writes");
  if (capped) return failed(429, capped);
  const steer = direction?.trim().slice(0, DIRECTION_MAX) || null;
  const steerCheck = steer ? checkAdultText({ direction: steer }) : { ok: true as const };
  if (!steerCheck.ok) {
    // Never stored: only that a steer was refused.
    return failed(422, `That steer crosses one of the lines that never move (${linesCrossed(steerCheck)}).`, { direction: "[a steer refused by the two lines]" });
  }
  const whisperCheck = whisper ? checkAdultText({ whisper: whisper.text }) : { ok: true as const };
  if (whisper && !whisperCheck.ok) {
    // The same for a whisper: never stored, only that one was refused.
    return failed(422, `That whisper crosses one of the lines that never move (${linesCrossed(whisperCheck)}).`, { whisper: { to: whisper.to, text: "[a whisper refused by the two lines]" } });
  }
  // The viewer's own limits hold over every steer (lib/adult/limits.ts): a steer or whisper that asks for a hard no, or
  // for more than the intensity allows, is refused before anything is written.
  const limits = limitsOf(scene);
  const steerRefused = limitRefusal("steer", steer, scene);
  if (steerRefused) return failed(422, steerRefused, { direction: steer });
  const whisperRefused = limitRefusal("whisper", whisper?.text ?? null, scene);
  if (whisperRefused) return failed(422, whisperRefused, { whisper });
  // The whispers this step plays: the one sent with it (for WHISPER_STEPS steps) and any still running.
  const whispers: Whispers = { ...scene.whispers, ...(whisper ? { [whisper.to]: { text: whisper.text, steps_left: WHISPER_STEPS } } : {}) };
  const ctx = await stepContext(db, adminId, scene.a.id, scene.b.id);
  const { a, b } = ctx;
  const step = await writeSceneStep({
    model: await adultModel(db),
    a,
    b,
    pair: { a: scene.a, b: scene.b },
    date: ctx.date,
    scene,
    steer,
    steerMode,
    promptVersion: ctx.settings.prompt_version,
    sampling: samplingOf(ctx.settings),
    memories: ctx.memories,
    facts: ctx.facts,
    styles: ctx.styles,
    cast: ctx.cast,
    resolveSet: (label) => resolveSet(db, label),
    whispers,
    limits,
    profile: await sceneProfile(db, scene),
  });
  if (!step.ok) return failed(step.status, step.message, { direction: steer, dropped: step.dropped, flags: step.flags, whisper });
  const { meta, next } = step;
  const stepId = await logStep(db, adminId, pairIds, scene.id, {
    kind: "write", direction: steer, steer_mode: steer ? steerMode : null, status: "ok", http: null, message: null, chapter: scene.chapter,
    line_from: scene.lines.length, line_to: scene.lines.length + step.lines.length - 1, added: step.lines.length, dropped: step.dropped,
    flags: opts.redo ? { ...step.flags, redo: true } : step.flags, whisper,
  });
  // What a rewind needs to take this step back: the scene before it, what it was asked, and the cited facts' uses.
  const cited = new Set(step.lines.flatMap((l) => l.fact_ids ?? []));
  const undo: StepUndo = {
    step_id: stepId,
    given: { direction: steer, steer_mode: steerMode, whisper },
    before: {
      line_count: scene.lines.length, prev_tail: scene.prev_tail, place: scene.place, stage: scene.stage, stage_from: scene.stage_from, set_place: scene.set_place,
      cut_to: scene.cut_to, chapter: scene.chapter, recap: scene.recap, place_history: scene.place_history, moves: scene.moves, picture_note: scene.picture_note,
      suggestions: scene.suggestions, whispers: scene.whispers,
    },
    bumped: ctx.facts.filter((f) => cited.has(f.id)).map((f) => ({ id: f.id, uses: f.uses, last_used_at: f.last_used_at })),
  };
  let stack = [...scene.undo, undo].slice(-UNDO_DEPTH);
  const { lines, place, stage, stage_from, set_place, place_history, moves } = next;
  const suggestions = next.suggestions ?? [];
  const nextWhispers = next.whispers ?? {};
  await db.query(
    `update adult_scenes set lines = $2::jsonb, place = $3, stage = $4, stage_from = $5, set_place = $6, cut_to = null, place_history = $7::jsonb, moves = $8::jsonb,
            suggestions = $9::jsonb, whispers = $10::jsonb, undo = $11::jsonb, updated_at = now() where id = $1`,
    [scene.id, JSON.stringify(lines), place, stage, stage_from, set_place, JSON.stringify(place_history), JSON.stringify(moves.slice(-40)), JSON.stringify(suggestions), JSON.stringify(nextWhispers), JSON.stringify(stack)],
  );
  await countUse(db, adminId, "writes");
  // The facts these lines drew on: one more use each (lib/adult/facts.ts).
  await bumpFacts(db, step.lines.flatMap((l) => l.fact_ids ?? []));
  // Pictures (lib/adult/media.ts), only with a fal key: each character's baseline the first time it turns explicit,
  // and a new one only when they asked and agreed in these lines. A failed picture never loses the lines.
  const pictures: Media[] = [];
  let picture_note: string | undefined;
  if ((meta.explicit || meta.picture) && !(await outputCheckReady(db))) picture_note = PICTURES_OFF_NOTE;
  else if ((meta.explicit || meta.picture) && a && b && (await pictureKeyReady(db))) {
    try {
      if (meta.explicit) for (const c of [a, b]) { const made = await ensureBaseline(db, adminId, c); if (made) pictures.push(made); }
      if (meta.picture) {
        const forOne = meta.picture.of === "b" ? b.id : a.id;
        const pctx = { place, stage, explicit: meta.explicit, recent: recentActions(step.lines) };
        pictures.push(
          await makePicture(db, adminId, {
            prompt: scenePrompt(a, b, meta.picture.of, meta.picture.description, pctx, adminId),
            kind: "scene",
            character_id: forOne,
            character_b: meta.picture.of === "both" ? b.id : null,
            // One of them: their baseline keeps the face the same (lib/adult/media.ts FACE_MODEL).
            face_of: meta.picture.of === "both" ? null : forOne,
          }),
        );
      }
    } catch (err) {
      picture_note = err instanceof Error ? err.message : "The picture didn't come through.";
    }
  }
  // The last picture problem stays on the scene (the gallery shows it), and clears once a picture comes through.
  const note = picture_note ?? (pictures.length ? null : scene.picture_note);
  if (note !== scene.picture_note) await db.query(`update adult_scenes set picture_note = $2 where id = $1`, [scene.id, note]);
  let after: LoadedScene = { ...scene, ...next, suggestions, whispers: nextWhispers, picture_note: note, undo: stack };
  // A full chapter: filed as a saved night, recapped, and the night runs straight on into the next one. What the close
  // changed goes with the step's undo, so a rewind takes it back too.
  if (lines.length >= CHAPTER_LINES) {
    const closed = await nextChapter(db, adminId, after, a, b);
    stack = [...stack.slice(0, -1), { ...undo, chapter_close: closed.undo }];
    await db.query(`update adult_scenes set undo = $2::jsonb where id = $1`, [scene.id, JSON.stringify(stack)]);
    after = { ...closed.scene, undo: stack };
  }
  return {
    ok: true,
    scene: publicScene(after),
    added: step.lines.length,
    held: step.flags.held,
    repeats: step.flags.repeats,
    dropped: step.flags.names_dropped + step.flags.alternation_dropped + step.flags.refused + (step.flags.whispers_said ?? 0),
    pictures,
    ...(picture_note ? { picture_note } : {}),
  };
}

/** What a chapter's close knows for certain, for a recap the model couldn't write: which chapter, where it ended, how far it went. */
export type ChapterEnd = Pick<AdultScene, "chapter" | "place" | "set_place" | "stage">;

/**
 * The recap in the model's reply: its JSON, even inside a code fence or after a sentence (lib/adult/facts.ts jsonOf), cut
 * to RECAP_MAX and held to the two lines; else why it can't be used (said in the log, never the reply itself).
 */
export function recapFrom(raw: string): { recap: string } | { reason: string } {
  const j = jsonOf(raw);
  if (!j || typeof j !== "object") return { reason: "the reply had no JSON object in it" };
  const recap = (j as { recap?: unknown }).recap;
  if (typeof recap !== "string" || !recap.trim()) return { reason: "the reply's JSON had no recap in it" };
  const text = recap.trim().slice(0, RECAP_MAX);
  return checkAdultText({ recap: text }).ok ? { recap: text } : { reason: "the recap crossed one of the two lines" };
}

/** Where a recap says they ended up: "at Lexi's bedroom", "at the street", "outside the truck" (a place that says its own preposition). */
const atPlace = (label: string) =>
  /^(?:in|on|at|by|near|under|inside|outside|behind|against|beside|next to|across)\b/i.test(label) ? label : /^(?:the|a|an|his|her|their|my|your|our)\b|['’]/i.test(label) ? `at ${label}` : `at the ${label}`;

/** The text at most `max` long, its oldest sentences dropped first, so the newest stays. */
function keepNewest(text: string, max: number): string {
  if (text.length <= max) return text;
  const parts = text.split(/(?<=[.!?])\s+/);
  while (parts.length > 1 && parts.join(" ").length > max) parts.shift();
  return parts.join(" ").slice(-max);
}

/**
 * The recap when the model's can't be used (v2.2; Lexi × Dex on prod, 2026-10-22: chapter 2 was filed with chapter 1's
 * recap word for word, so chapter 3 began the foreplay again though they were in her bed): the one before, never left as
 * it was, with a sentence from the chapter's own record ("Later, at Lexi's bedroom, it went as far as sex."), the newest
 * kept under RECAP_MAX. A place that wouldn't pass the two lines is left out of it.
 */
export function recapFallback(before: string | null, end: Pick<ChapterEnd, "place" | "set_place" | "stage">): string {
  const where = end.set_place?.trim() || end.place?.trim() || null;
  const sentence = (at: string | null) => {
    const s = `${at ? `${atPlace(at)}, ` : ""}it went as far as ${STAGES[end.stage] ?? STAGES[0]}.`;
    return before ? `Later, ${s}` : `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
  };
  const said = where && checkAdultText({ recap: sentence(where) }).ok ? sentence(where) : sentence(null);
  return keepNewest(before ? `${before.trim()} ${said}` : said, RECAP_MAX);
}

/**
 * The running recap: the night so far, from the last recap and the chapter just finished. When the model's can't be used
 * (no answer, no JSON, nothing in it, or over the two lines) it says why in the log and falls back (recapFallback).
 */
export async function writeRecap(db: Db, a: Character | null, b: Character | null, before: string | null, lines: SceneLine[], end: ChapterEnd): Promise<string> {
  const nameOf = (who: "a" | "b") => (who === "a" ? a?.name : b?.name) ?? who;
  let reason: string;
  try {
    const raw = await (await adultModel(db)).complete(
      [
        { role: "system", content: "You keep the running recap of a private scene between two consenting adults, so a writer picking it up later remembers it." },
        {
          role: "user",
          content:
            (before ? `The recap so far:\n${before}\n\n` : "") +
            `The latest chapter:\n${lines.map((l) => `${nameOf(l.who)}: ${l.text}`).join("\n")}\n\n` +
            `Write the recap of the whole night so far in under 150 words: where they've been, what's happened between them and in what order, ` +
            `how each of them feels now, and any running jokes, pet names or promises. Plain facts, no quotes. Reply with a JSON object: {"recap": "..."}`,
        },
      ],
      { temperature: 0.3, maxTokens: 400 },
    );
    const got = recapFrom(raw);
    if ("recap" in got) return got.recap;
    reason = got.reason;
  } catch (err) {
    reason = `the model didn't answer (${err instanceof Error ? err.message.slice(0, 160) : "error"})`;
  }
  console.warn(`[after-dark] chapter ${end.chapter}'s recap: ${reason}; kept the last one and added where the chapter ended`);
  return recapFallback(before, end);
}

/**
 * Files a full chapter as a saved night and starts the next one, carrying the recap and the last few lines. Returns the
 * scene after it, and what it changed beyond the scene (the night, the PG notes before it, the facts) for a rewind.
 */
async function nextChapter<S extends AdultScene>(db: Db, ownerId: string, scene: S, a: Character | null, b: Character | null): Promise<{ scene: S; undo: ChapterUndo }> {
  const recap = await writeRecap(db, a, b, scene.recap, scene.lines, scene);
  const nightId = crypto.randomUUID();
  await db.query(
    `insert into adult_nights (id, owner_id, character_a, character_b, lines, place, stage, date_setting, date_venue, set_place, chapter, recap, moves, place_history)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb)`,
    [
      nightId,
      ownerId,
      scene.a.id,
      scene.b.id,
      JSON.stringify(scene.lines),
      scene.place,
      scene.stage,
      scene.date?.setting ?? null,
      scene.date?.venue ?? null,
      scene.set_place,
      scene.chapter,
      recap,
      JSON.stringify(scene.moves),
      JSON.stringify(scene.place_history),
    ],
  );
  // The lines' thumbs (lib/line-feedback.ts) and the steps that wrote them (lib/adult/steps.ts) go with them to the
  // saved night, before the scene's lines are cleared.
  await moveLineFeedback(db, scene.id, nightId);
  await fileSteps(db, scene.id, scene.chapter, nightId);
  // The PG notes as they were, so a rewind of the step that closed this chapter can put them back.
  const notes = await notesBetween(db, scene.a.id, scene.b.id);
  await rememberAfterDark(db, ownerId, a, b, recap, scene.lines);
  // The chapter's concrete facts, for the scene prompt from now on (lib/adult/facts.ts; After Dark only).
  const facts = await rememberFactsChange(db, ownerId, a, b, scene.lines);
  const prev_tail = scene.lines.slice(-PREV_TAIL);
  // The stage's line count carries over, so the pacing doesn't restart with the chapter. Moves are counted per chapter;
  // where the night has been carries on.
  const stage_from = scene.stage_from - scene.lines.length;
  const chapter = scene.chapter + 1;
  await db.query(`update adult_scenes set lines = '[]'::jsonb, prev_tail = $2::jsonb, chapter = $3, recap = $4, stage_from = $5, moves = '[]'::jsonb, updated_at = now() where id = $1`, [
    scene.id,
    JSON.stringify(prev_tail),
    chapter,
    recap,
    stage_from,
  ]);
  return { scene: { ...scene, lines: [], prev_tail, chapter, recap, stage_from, moves: [] }, undo: { night_id: nightId, notes, facts } };
}

/**
 * Set the scene (David, 2026-10-19: "set the venue to any scene… for 1 token", paid by the caller): the scene jumps to
 * the place typed, its set is drawn if it has none, and the next lines open on arriving there. Held to the two lines.
 */
export async function setSceneTo(db: Db, ownerId: string, x: string, y: string, place: string): Promise<{ ok: true; scene: AdultScene } | { ok: false; status: number; message: string }> {
  const label = place.trim().replace(/\s+/g, " ").slice(0, SET_SCENE_MAX);
  if (!label) return { ok: false, status: 400, message: "Say where to take them." };
  const placeCheck = checkAdultText({ place: label });
  if (!placeCheck.ok) return { ok: false, status: 422, message: `That place crosses one of the lines that never move (${linesCrossed(placeCheck)}).` };
  const loaded = await loadScene(db, ownerId, x, y);
  if (!loaded) return { ok: false, status: 404, message: "Pick two characters who are in after dark." };
  const scene = loaded;
  // A name typed without its apostrophe ("Lexis bedroom") gets it back (lib/adult/craft.ts possessiveNames).
  const named = possessiveNames(label, { a: scene.a.name, b: scene.b.name }) ?? label;
  const set_place = named.slice(0, 40);
  // A paid cut is a move nobody has to agree to, and it doesn't count against the chapter's moves.
  const place_history = [...scene.place_history, { place: named, set: set_place, home: null, chapter: scene.chapter }];
  const moves: MoveLog[] = [...scene.moves, { chapter: scene.chapter, at: scene.lines.length, from: scene.set_place ?? scene.place, to: set_place, taken: true, reason: "set_scene" }];
  // A cut is a paid jump nobody rewinds past (the steps before it can't be taken back), and the last step's suggestions
  // were for where they were: the next step suggests again.
  await db.query(
    `update adult_scenes set place = $2, set_place = $3, cut_to = $2, place_history = $4::jsonb, moves = $5::jsonb, suggestions = '[]'::jsonb, undo = '[]'::jsonb, updated_at = now() where id = $1`,
    [scene.id, named, set_place, JSON.stringify(place_history), JSON.stringify(moves.slice(-40))],
  );
  await ensureSet(db, set_place);
  await logStep(db, ownerId, { a: scene.a.id, b: scene.b.id }, scene.id, {
    kind: "set_scene", direction: named, steer_mode: null, status: "ok", http: null, message: null, chapter: scene.chapter,
    line_from: null, line_to: null, added: 0, dropped: [], flags: null,
  });
  return { ok: true, scene: publicScene({ ...scene, place: named, set_place, cut_to: named, place_history, moves, suggestions: [], undo: [] }) };
}

export type RewindResult = { ok: true; scene: AdultScene; given: Given; rewound: number } | { ok: false; status: number; message: string };

/**
 * Rewind (David, 2026-10-22): the scene goes back one step, to its lines, stage, place, set, suggestions and whispers as
 * they were before it, and nothing the step caused stays behind:
 *  - the facts its lines cited get their uses and last use back;
 *  - when it filled the chapter, the chapter's close is taken back too: the saved night it was filed as goes (its lines
 *    come back to the scene, with their votes and steps), the PG notes are put back as they were, and the facts it
 *    extracted go while the ones it dropped to make room come back;
 *  - votes on its lines go with them (the line numbers will be a redo's);
 *  - its log entry stays, marked rewound with the lines it wrote, and the rewind is logged as a step of its own.
 * A step's pictures stay in the gallery (they were made and checked). Start over and Set the scene clear the stack, so
 * a rewind never undoes either. Free: only a redo's new step counts for the month.
 */
export async function rewindScene(db: Db, ownerId: string, x: string, y: string, opts: { forRedo?: boolean } = {}): Promise<RewindResult> {
  const scene = await loadScene(db, ownerId, x, y);
  if (!scene) return { ok: false, status: 404, message: "Pick two characters who are in after dark." };
  const top = scene.undo.at(-1);
  if (!top) return { ok: false, status: 409, message: "There's no step to rewind: Start over and Set the scene can't be taken back." };
  const { before } = top;
  let lines: SceneLine[];
  let gone: SceneLine[];
  if (top.chapter_close) {
    const close = top.chapter_close;
    const night = (await db.query<{ lines: SceneLine[] }>(`select lines from adult_nights where id = $1 and owner_id = $2`, [close.night_id, ownerId])).rows[0];
    if (!night) return { ok: false, status: 409, message: "The chapter that step closed isn't among their nights any more, so it can't be rewound." };
    const filed = night.lines ?? [];
    lines = filed.slice(0, before.line_count);
    gone = filed.slice(before.line_count);
    // The chapter's close, taken back: the votes and steps come home before the night goes.
    await moveLineFeedback(db, close.night_id, scene.id);
    await unfileSteps(db, close.night_id);
    await db.query(`delete from adult_nights where id = $1 and owner_id = $2`, [close.night_id, ownerId]);
    await restoreNotes(db, scene.a.id, scene.b.id, close.notes);
    await undoFacts(db, ownerId, close.facts);
  } else {
    lines = scene.lines.slice(0, before.line_count);
    gone = scene.lines.slice(before.line_count);
  }
  await restoreFactUses(db, top.bumped);
  // Votes on lines that are gone would land on whatever is written there next.
  await db.query(`delete from line_feedback where kind = 'after_dark' and ref_id = $1 and line_index >= $2`, [scene.id, lines.length]).catch(() => {});
  if (top.step_id) await markRewound(db, top.step_id, publicLines(gone));
  const undo = scene.undo.slice(0, -1);
  await logStep(db, ownerId, { a: scene.a.id, b: scene.b.id }, scene.id, {
    kind: "rewind", direction: top.given.direction, steer_mode: top.given.direction ? top.given.steer_mode : null, status: "ok", http: null,
    message: `took back ${gone.length} line${gone.length === 1 ? "" : "s"}${opts.forRedo ? ", to write them again" : ""}`, chapter: before.chapter,
    line_from: null, line_to: null, added: 0, dropped: [], flags: null,
  });
  // Only a chapter's close changes the chapter, its recap and the lines carried over: a step that didn't close one leaves
  // them as they are now (a recap edited since stays edited).
  const chapterBack = top.chapter_close ? { chapter: before.chapter, recap: before.recap, prev_tail: before.prev_tail } : { chapter: scene.chapter, recap: scene.recap, prev_tail: scene.prev_tail };
  const restored: LoadedScene = {
    ...scene, lines, ...chapterBack, place: before.place, stage: before.stage, stage_from: before.stage_from, set_place: before.set_place, cut_to: before.cut_to,
    place_history: before.place_history, moves: before.moves, picture_note: before.picture_note, suggestions: [], whispers: storedWhispers(before.whispers), undo,
  };
  // The suggestions it had then, held to the limits as they are now.
  restored.suggestions = await heldAgain(db, restored, limitsOf(scene), storedSuggestions(before.suggestions));
  await db.query(
    `update adult_scenes set lines = $2::jsonb, prev_tail = $3::jsonb, place = $4, stage = $5, stage_from = $6, set_place = $7, cut_to = $8, chapter = $9, recap = $10,
            place_history = $11::jsonb, moves = $12::jsonb, picture_note = $13, suggestions = $14::jsonb, whispers = $15::jsonb, undo = $16::jsonb, updated_at = now() where id = $1`,
    [
      scene.id, JSON.stringify(lines), JSON.stringify(restored.prev_tail), restored.place, restored.stage, restored.stage_from, restored.set_place, restored.cut_to, restored.chapter,
      restored.recap, JSON.stringify(restored.place_history), JSON.stringify(restored.moves), restored.picture_note, JSON.stringify(restored.suggestions), JSON.stringify(restored.whispers),
      JSON.stringify(undo),
    ],
  );
  return { ok: true, scene: publicScene(restored), given: top.given, rewound: gone.length };
}

/**
 * Redo: rewinds the last step and writes it again, with the same steer, the same strength and the same whisper. The new
 * step counts for the month like any other (checked before anything is taken back).
 */
export async function redoScene(db: Db, ownerId: string, x: string, y: string): Promise<ContinueResult> {
  const capped = await overCap(db, ownerId, "writes");
  if (capped) return { ok: false, status: 429, message: capped };
  // The step's steer and whisper, held to the limits as they are now, before anything is taken back.
  const scene = await loadScene(db, ownerId, x, y);
  const given = scene?.undo.at(-1)?.given;
  if (scene && given) {
    const refused = limitRefusal("steer", given.direction, scene) ?? limitRefusal("whisper", given.whisper?.text ?? null, scene);
    if (refused) return { ok: false, status: 422, message: `Redo would send the same again, and the limits have changed since: ${refused}` };
  }
  const back = await rewindScene(db, ownerId, x, y, { forRedo: true });
  if (!back.ok) return back;
  const r = await continueScene(db, ownerId, x, y, back.given.direction, back.given.steer_mode, { whisper: back.given.whisper, redo: true });
  return r.ok ? r : { ...r, message: `The step was taken back, but the new take didn't come through: ${r.message}` };
}

/** Forgets a whisper still running, before its steps are up. */
export async function forgetWhisper(db: Db, ownerId: string, x: string, y: string, who: "a" | "b"): Promise<AdultScene | null> {
  const scene = await loadScene(db, ownerId, x, y);
  if (!scene) return null;
  const whispers: Whispers = { ...scene.whispers };
  delete whispers[who];
  await db.query(`update adult_scenes set whispers = $2::jsonb, updated_at = now() where id = $1`, [scene.id, JSON.stringify(whispers)]);
  return publicScene({ ...scene, whispers });
}

/**
 * The last step's suggestions held again, to the limits as they are now and the scene as it stands (after the limits
 * change, or a rewind brings back older ones): one that no longer passes is replaced like any other. None stays none.
 */
async function heldAgain(db: Db, scene: LoadedScene, limits: PairLimits, suggestions: readonly Suggestion[]): Promise<Suggestion[]> {
  if (!suggestions.length) return [];
  const cap = INTENSITY[limits.intensity].maxStage;
  const where = scene.set_place ?? scene.place ?? scene.date?.setting ?? null;
  return suggestionsFor(Object.fromEntries(suggestions.map((x) => [x.heat, x.text])), {
    stage: scene.stage,
    maxStage: Math.min(cap, scene.stage + 1),
    publicPlace: isPublicPlace(where, scene.place_history.at(-1)?.home ?? null),
    names: { a: scene.a.name, b: scene.b.name },
    cast: await castNames(db, [scene.a.id, scene.b.id]),
    limit: (text) => limitsHit(text, limits),
  }).suggestions;
}

export type LimitsInput = { intensity?: string; hard_nos?: { chips?: string[]; own?: string[] } };

/**
 * Sets the viewer's limits for a pair (lib/adult/limits.ts): the intensity and the hard nos, per owner and pair (they
 * outlive Start over). The viewer's own hard nos are held to the two lines like anything typed, OWN_MAX of OWN_LEN
 * characters at most. The last step's suggestions are held to the new limits at once.
 */
export async function saveLimits(db: Db, ownerId: string, x: string, y: string, input: LimitsInput): Promise<{ ok: true; scene: AdultScene } | { ok: false; status: number; message: string }> {
  const scene = await loadScene(db, ownerId, x, y);
  if (!scene) return { ok: false, status: 404, message: "Pick two characters who are in after dark." };
  const intensity = input.intensity === undefined ? scene.intensity : intensityOf(input.intensity);
  let hard_nos = scene.hard_nos;
  if (input.hard_nos) {
    const seen = new Set<string>();
    const own = (input.hard_nos.own ?? []).map((o) => o.replace(/\s+/g, " ").trim()).filter((o) => o && !seen.has(o.toLowerCase()) && seen.add(o.toLowerCase()));
    if (own.length > OWN_MAX) return { ok: false, status: 400, message: `Up to ${OWN_MAX} of your own hard nos.` };
    const long = own.find((o) => o.length > OWN_LEN);
    if (long) return { ok: false, status: 400, message: `Keep each hard no to ${OWN_LEN} characters ("${long.slice(0, 20)}…").` };
    if (own.some((o) => !checkAdultText({ limit: o }).ok)) {
      return { ok: false, status: 422, message: "One of those crosses the two lines (nobody under 18, no real people): they already never happen, so there's no need to list them." };
    }
    hard_nos = storedHardNos({ chips: input.hard_nos.chips ?? [], own });
  }
  const limits: PairLimits = { intensity, hard_nos };
  const suggestions = await heldAgain(db, scene, limits, scene.suggestions);
  await db.query(`update adult_scenes set intensity = $2, hard_nos = $3::jsonb, suggestions = $4::jsonb, updated_at = now() where id = $1`, [
    scene.id,
    intensity,
    JSON.stringify(hard_nos),
    JSON.stringify(suggestions),
  ]);
  return { ok: true, scene: publicScene({ ...scene, intensity, hard_nos, suggestions }) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Scenarios, turn-ons and framing (David, 2026-10-22)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Start a night from a scenario (lib/adult/scenarios.ts): the night that ran is filed as Start over files it, they're put
 * in the scenario's place (setSceneTo: the first lines open on arriving there), the stage starts where the scenario does
 * (never past the pair's intensity), the premise stays on the scene for every step of the night, and the first lines are
 * written with the opening as a Nudge, so the pacing, the public-place cap, the intensity and the hard nos all hold from
 * the first line. Nothing is filed when the scenario runs into the viewer's limits, or the month's steps are used up.
 * Free: the places are a fixed few, each drawn once for everyone.
 */
export async function startScenario(db: Db, ownerId: string, x: string, y: string, id: string): Promise<ContinueResult & { placed?: AdultScene }> {
  const sc = scenarioById(id);
  if (!sc) return { ok: false, status: 404, message: "There's no such scenario." };
  const before = await loadScene(db, ownerId, x, y);
  if (!before) return { ok: false, status: 404, message: "Pick two characters who are in after dark." };
  // Curated and reviewed, and checked again here so an edit to the list can never slip past the lines.
  if (!checkAdultText({ title: sc.title, premise: sc.premise, place: sc.place, opening: sc.opening }).ok) return { ok: false, status: 422, message: "That scenario crosses one of the lines." };
  const refused = limitRefusal("steer", `${sc.premise} ${sc.opening}`, { ...before, stage: sc.stage });
  if (refused) return { ok: false, status: 422, message: refused.replace(/^That steer/, "That scenario") };
  const capped = await overCap(db, ownerId, "writes");
  if (capped) return { ok: false, status: 429, message: capped };
  await resetScene(db, ownerId, x, y);
  const placed = await setSceneTo(db, ownerId, x, y, sc.place);
  if (!placed.ok) return placed;
  const stage = Math.min(sc.stage, INTENSITY[before.intensity].maxStage);
  await db.query(`update adult_scenes set stage = $2, stage_from = 0, scenario = $3, updated_at = now() where id = $1`, [placed.scene.id, stage, sc.id]);
  const r = await continueScene(db, ownerId, x, y, sc.opening, "nudge");
  if (r.ok) return r;
  // Filed and placed, but the first lines didn't come: the page shows them there, ready for Write.
  return { ...r, placed: (await openScene(db, ownerId, x, y)) ?? undefined };
}

/** Sets how the viewer frames the pair (lib/adult/profile.ts FRAMINGS), or clears it (null). Per owner and pair. */
export async function saveFraming(db: Db, ownerId: string, x: string, y: string, framing: string | null): Promise<AdultScene | null> {
  const scene = await loadScene(db, ownerId, x, y);
  if (!scene) return null;
  const value = framing === null ? null : framingOf(framing);
  await db.query(`update adult_scenes set framing = $2, updated_at = now() where id = $1`, [scene.id, value]);
  return publicScene({ ...scene, framing: value });
}

/** Each one's turn-ons as the viewer may see them: only a character whose profile they may set (theirs, or an admin's house cast). */
export type ProfileView = { a: { editable: boolean; turn_ons: TurnOnId[] }; b: { editable: boolean; turn_ons: TurnOnId[] } };

export async function profileView(db: Db, viewer: string, x: string, y: string): Promise<ProfileView | null> {
  const pair = await eligiblePair(db, viewer, x, y);
  if (!pair) return null;
  const side = async (id: string) => {
    const editable = await mayEditProfile(db, viewer, id);
    return { editable, turn_ons: editable ? await turnOnsOf(db, id) : [] };
  };
  const [a, b] = await Promise.all([side(pair[0]), side(pair[1])]);
  return { a, b };
}

// ---------------------------------------------------------------------------------------------------------------------
// Memory you can see and edit (David, 2026-10-22)
// ---------------------------------------------------------------------------------------------------------------------

/** What each of them remembers about the other, as the viewer sees and edits it. Owner-scoped. */
export type MemoryView = {
  /** Each one's PG note about the other (lib/adult/memory.ts): it reaches their public dates and texts. */
  notes: { a: string | null; b: string | null };
  /** The facts each remembers about the other (lib/adult/facts.ts), newest first. */
  facts: { id: string; of: "a" | "b"; kind: string; fact: string; quote: string | null; uses: number }[];
  /** The night's running recap so far (the prompt's "Earlier tonight"). */
  recap: string | null;
};

/** The pair's memory for this viewer: only what their own nights wrote. Null for any pair outside their After Dark. */
export async function memoryView(db: Db, ownerId: string, x: string, y: string): Promise<MemoryView | null> {
  const scene = await loadScene(db, ownerId, x, y);
  if (!scene) return null;
  const [notes, facts] = await Promise.all([ownNotes(db, ownerId, scene.a.id, scene.b.id), loadPairFacts(db, ownerId, scene.a.id, scene.b.id)]);
  return {
    notes: { a: notes.find((n) => n.character_id === scene.a.id)?.note ?? null, b: notes.find((n) => n.character_id === scene.b.id)?.note ?? null },
    facts: facts
      .slice()
      .reverse()
      .map((f) => ({ id: f.id, of: f.character_id === scene.a.id ? ("a" as const) : ("b" as const), kind: f.kind, fact: f.fact, quote: f.quote, uses: f.uses })),
    recap: scene.recap,
  };
}

export type MemoryEdit = { kind: "note"; of: "a" | "b"; text: string | null } | { kind: "fact"; id: string; text: string | null } | { kind: "recap"; text: string | null };

/**
 * Edits or deletes one thing they remember (text null deletes it): a PG note (held to the show's own check as well as
 * the two lines, since it reaches their public dates and texts), a fact, or the night's recap (the two lines). Only the
 * viewer's own: another person's notes and facts are never touched.
 */
export async function editMemory(
  db: Db,
  ownerId: string,
  x: string,
  y: string,
  edit: MemoryEdit,
): Promise<{ ok: true; memory: MemoryView; scene: AdultScene } | { ok: false; status: number; message: string }> {
  const scene = await loadScene(db, ownerId, x, y);
  if (!scene) return { ok: false, status: 404, message: "Pick two characters who are in after dark." };
  const text = edit.text === null ? null : edit.text.replace(/\s+/g, " ").trim();
  if (text !== null && !text) return { ok: false, status: 400, message: "Write something, or delete it instead." };
  const memoryCheck = text === null ? { ok: true as const } : checkAdultText({ memory: text });
  if (!memoryCheck.ok) return { ok: false, status: 422, message: `That crosses one of the lines that never move (${linesCrossed(memoryCheck)}).` };
  let recap = scene.recap;
  if (edit.kind === "note") {
    const [self, other] = edit.of === "a" ? [scene.a.id, scene.b.id] : [scene.b.id, scene.a.id];
    const r = await setOwnNote(db, ownerId, self, other, text);
    if (!r.ok) return r;
  } else if (edit.kind === "fact") {
    const r = await editOwnFact(db, ownerId, [scene.a.id, scene.b.id], edit.id, text);
    if (!r.ok) return r;
  } else {
    if (text !== null && text.length > RECAP_MAX) return { ok: false, status: 400, message: `Keep the recap to ${RECAP_MAX} characters.` };
    recap = text;
    await db.query(`update adult_scenes set recap = $2, updated_at = now() where id = $1`, [scene.id, recap]);
  }
  const memory = await memoryView(db, ownerId, x, y);
  return { ok: true, memory: memory!, scene: publicScene({ ...scene, recap }) };
}

/** A finished scene, kept to play back (adult_nights). */
export type AdultNight = { id: string; lines: SceneLine[]; place: string | null; stage: number; date_setting: string | null; date_venue: string | null; set_place: string | null; chapter: number | null; created_at: string };

/** The pair's saved nights for this person, newest first. */
export async function listNights(db: Db, ownerId: string, x: string, y: string): Promise<AdultNight[]> {
  const pair = await eligiblePair(db, ownerId, x, y);
  if (!pair) return [];
  const { rows } = await db.query<AdultNight>(
    `select id, lines, place, stage, date_setting, date_venue, set_place, chapter, created_at from adult_nights where owner_id = $1 and character_a = $2 and character_b = $3 order by created_at desc limit 50`,
    [ownerId, ...pair],
  );
  return rows.map((r) => ({ ...r, lines: publicLines(r.lines ?? []).map((l) => ({ ...l, text: dropForeignActions(l.text) })), created_at: new Date(r.created_at).toISOString() }));
}

/** One line with its private notes, for an admin reading why it was written. */
/** `step`: which of `steps` wrote the line (null for lines from before steps were logged, 2026-10-22). */
export type LineNote = { i: number; who: string; text: string; why: string | null; memory: string | null; moved_to: string | null; facts: string[] | null; step: number | null };
export type SceneNotes = {
  a: { id: string; name: string };
  b: { id: string; name: string };
  current: { chapter: number; place: string | null; set_place: string | null; place_history: PlaceStop[]; moves: MoveLog[]; steps: StepRow[]; lines: LineNote[] };
  nights: { id: string; chapter: number | null; created_at: string; set_place: string | null; moves: MoveLog[] | null; steps: StepRow[]; lines: LineNote[] }[];
};

const notesOf = (lines: readonly SceneLine[], names: { a: string; b: string }, steps: readonly StepRow[] = []): LineNote[] => {
  const by = stepIndexOf(steps, lines.length);
  return lines.map((l, i) => ({ i, who: l.who === "a" ? names.a : names.b, text: l.text, why: l.why ?? null, memory: l.memory ?? null, moved_to: l.moved_to ?? null, facts: l.fact_ids ?? null, step: by[i] }));
};

/**
 * Every line of the pair's scene and saved nights with its private "why" and "memory" (David, 2026-10-21), for the
 * admin's JSON export (/api/admin/after-dark/why). Lines from before the notes existed have nulls. Null for any other pair.
 */
export async function sceneNotes(db: Db, ownerId: string, x: string, y: string): Promise<SceneNotes | null> {
  const scene = await loadScene(db, ownerId, x, y);
  if (!scene) return null;
  const names = { a: scene.a.name, b: scene.b.name };
  const { rows } = await db.query<{ id: string; chapter: number | null; created_at: string; set_place: string | null; moves: MoveLog[] | null; lines: SceneLine[] }>(
    `select id, chapter, created_at, set_place, moves, lines from adult_nights where owner_id = $1 and character_a = $2 and character_b = $3 order by created_at desc limit 50`,
    [ownerId, scene.a.id, scene.b.id],
  );
  // What was asked at each step, and what came of it or the error (lib/adult/steps.ts).
  const steps = await stepsOf(db, ownerId, scene.a.id, scene.b.id);
  return {
    a: scene.a,
    b: scene.b,
    current: {
      chapter: scene.chapter, place: scene.place, set_place: scene.set_place, place_history: scene.place_history, moves: scene.moves,
      steps: steps.running, lines: notesOf(scene.lines, names, steps.running),
    },
    nights: rows.map((r) => {
      const own = steps.byNight.get(r.id) ?? [];
      return { ...r, created_at: new Date(r.created_at).toISOString(), steps: own, lines: notesOf(r.lines ?? [], names, own) };
    }),
  };
}

/** Starts the pair's scene again from the top, saving the one that ran as a night to play back. */
export async function resetScene(db: Db, adminId: string, x: string, y: string): Promise<void> {
  const pair = await eligiblePair(db, adminId, x, y);
  if (!pair) return;
  const scene = await loadScene(db, adminId, ...pair);
  if (scene?.lines.length) {
    const [ca, cb] = await Promise.all([loadCharacter(db, scene.a.id), loadCharacter(db, scene.b.id)]);
    await rememberAfterDark(db, adminId, ca, cb, scene.recap, scene.lines);
    // The night's concrete facts, for the scene prompt from now on (lib/adult/facts.ts; After Dark only).
    await rememberFacts(db, adminId, ca, cb, scene.lines);
    const nightId = crypto.randomUUID();
    await db.query(
      `insert into adult_nights (id, owner_id, character_a, character_b, lines, place, stage, date_setting, date_venue, set_place, chapter, recap, moves, place_history) values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb)`,
      [nightId, adminId, ...pair, JSON.stringify(scene.lines), scene.place, scene.stage, scene.date?.setting ?? null, scene.date?.venue ?? null, scene.set_place, scene.chapter, scene.recap, JSON.stringify(scene.moves), JSON.stringify(scene.place_history)],
    );
    // The lines' thumbs (lib/line-feedback.ts) and their steps (lib/adult/steps.ts) go with them to the saved night.
    await moveLineFeedback(db, scene.id, nightId);
    await fileSteps(db, scene.id, scene.chapter, nightId);
  }
  if (scene) {
    await logStep(db, adminId, { a: pair[0], b: pair[1] }, scene.id, {
      kind: "reset", direction: null, steer_mode: null, status: "ok", http: null, message: null, chapter: 1, line_from: null, line_to: null, added: 0, dropped: [], flags: null,
    });
  }
  await db.query(
    `update adult_scenes set lines = '[]'::jsonb, place = null, stage = 0, stage_from = 0, picture_note = null, set_place = null, cut_to = null, chapter = 1, recap = null, prev_tail = '[]'::jsonb, place_history = '[]'::jsonb, moves = '[]'::jsonb,
            suggestions = '[]'::jsonb, whispers = '{}'::jsonb, undo = '[]'::jsonb, scenario = null, updated_at = now() where owner_id = $1 and character_a = $2 and character_b = $3`,
    [adminId, ...pair],
  );
}
