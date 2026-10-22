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
import { checkAdultText } from "../safety";
import { eligibleIds } from "./characters";
import { pictureKeyReady, ensureBaseline, makePicture, outputCheckReady, PICTURES_OFF_NOTE, recentActions, scenePrompt, type Media } from "./media";
import { countUse, overCap } from "./usage";
import { adultModel } from "./mode";
import { drawLabel, ensureSet, resolveSet } from "../sets";
import { pairMemory } from "../memory";
import { contentWords, lineIssues } from "../quality";
import type { Turn } from "../conversation";
import { afterDarkNote, rememberAfterDark } from "./memory";
import { agreedMove, historyPhrase, isPublicPlace, MAX_SCENE_MOVES, repeatOf, saysCatchphrase, settlePlace, shownMove, withoutPhrase, type MoveLog, type PlaceStop } from "./continuity";
import { activeLimit, linesAtPlace, objectOf, possessiveOf, pronounKind, recentClimax, repairPlacePronouns, THRESHOLD_LINES, thresholdOf } from "./craft";
import { stageShown, stagesFor, withoutSteerCopy } from "./stage-floor";
import { MIN_LINES_PER_STAGE, STAGES } from "./stages";
import {
  bumpFacts,
  citeMemory,
  factLine,
  loadPairFacts,
  memoryLabels,
  RECENT_LINES,
  rememberFacts,
  retrieveFacts,
  sheetFacets,
  sheetMemories,
  type AdultFact,
  type Citation,
  type SheetFacet,
  type SheetItem,
  type ShownFact,
} from "./facts";
import { guardAlternation, guardNames } from "./guards";
import { bannedPhrases, copiedRun, countPhrases, hooksOf, phraseNames, phrasesIn, questionHabit, refusalIn, sheetText, sideOfCharacter, topPhrases, touchesHook, WORN_AT, wornIn } from "./quality";
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
};

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

/** A scene without its lines' private notes. */
export const publicScene = (scene: AdultScene): AdultScene => ({ ...scene, lines: publicLines(scene.lines), prev_tail: publicLines(scene.prev_tail) });

/** The scene with everything stored on its lines, for writing more. Null for any pair outside this person's after dark. */
async function loadScene(db: Db, adminId: string, x: string, y: string): Promise<AdultScene | null> {
  const pair = await eligiblePair(db, adminId, x, y);
  if (!pair) return null;
  const [a, b] = pair;
  await db.query(`insert into adult_scenes (id, owner_id, character_a, character_b) values ($1, $2, $3, $4) on conflict do nothing`, [
    crypto.randomUUID(),
    adminId,
    a,
    b,
  ]);
  const row = (await db.query<{ id: string; lines: SceneLine[]; place: string | null; stage: number; stage_from: number; picture_note: string | null; set_place: string | null; cut_to: string | null; chapter: number; recap: string | null; prev_tail: SceneLine[] | null; place_history: PlaceStop[] | null; moves: MoveLog[] | null }>(`select id, lines, place, stage, stage_from, picture_note, set_place, cut_to, chapter, recap, prev_tail, place_history, moves from adult_scenes where owner_id = $1 and character_a = $2 and character_b = $3`, [adminId, a, b]))
    .rows[0];
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
  };
}

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
 * (v2.1: a v2 night put two women in "his apartment entrance") their pronouns, from their sheets only.
 */
function voiceRules(a: Character | null, b: Character | null, names: { a: string; b: string }): string[] {
  const banned = bannedPhrases([a, b].filter((c): c is Character => Boolean(c)).map((c) => sheetText(sideOfCharacter(c))));
  const pronouns = (c: Character | null, name: string) => `${name.split(/\s+/)[0]}: ${c?.pronouns?.trim() || "none given, so use their name"}`;
  return [
    `Only the two of them are in this scene: ${names.a} and ${names.b}. Nobody else speaks, arrives or is named, and each calls the other by their own name.`,
    "Stay this person when it gets intimate: their job, hobbies, humour and tells still show; no generic romance-novel phrasing. They sound like their sheets, not like a paperback.",
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

/**
 * Prompt v2.1's craft (David's review of a v2 night, Star Dust × Sable Quist, 2026-10-21: a limit overridden, the place
 * stuck in a doorway, tics, no arc). The rules that always hold: limits, a detail of the place, the rhythm, answering each
 * other, a repeat with a new action is still a repeat, and the last stage's arc. Then tonight's notes, from the lines so
 * far (lib/adult/craft.ts, lib/adult/quality.ts): a limit still standing, each one's worn phrases, question endings and
 * hook (with the other sides of them their sheet shows), and a threshold they've stood at too long.
 */
function craftLines(
  a: Character | null,
  b: Character | null,
  lines: readonly SceneLine[],
  now: { place: string; set?: string | null; stage: number; movesLeft?: number; linesHere?: number; publicPlace?: boolean },
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
  if (now.stage >= STAGES.length - 1) {
    const climax = recentClimax(lines);
    rules.push(
      climax
        ? `- They've reached a climax (${first(climax.who)}: "${climax.text.replace(/\*[^*]*\*/g, "").trim().slice(0, 60)}"): now the afterglow, a resolution. They check in with each other, stay warm, make each other laugh; it doesn't start over.`
        : "- This is the last stage: write toward a climax, then a resolution or an afterglow beat (checking in, warmth, a joke), instead of looping.",
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
    const sides = sheetFacets(c).filter((f) => !touchesHook(f.text, hook) && !kinds.has(f.kind) && kinds.add(f.kind)).slice(0, 3);
    notes.push(
      `- ${first(who)} keeps coming back to "${hook.word}" (${hook.lines} of ${poss(who)} last ${hook.of} lines). Show other sides of ${objectOf(kind(who))}, from ${poss(who)} sheet, and name the one a line uses in its "why": ${sides.length ? sides.map((f) => facetPhrase(poss(who), f)).join("; ") : `${poss(who)} work, hobbies, humour and tells`}.`,
    );
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
  } = { place: "wherever they've just met", stage: 0 },
): ChatMessage[] {
  const v2 = (now.promptVersion ?? DEFAULT_PROMPT_VERSION) === "v2";
  const nameOf = (who: "a" | "b") => (who === "a" ? a?.name : b?.name) ?? who;
  const first = (who: "a" | "b") => nameOf(who).split(/\s+/)[0];
  // v2.1: where they are, with a possessive neither of them goes by put right ("his apartment entrance", two women).
  const fixPlace = (label: string) => repairPlacePronouns(label, { a: a?.pronouns, b: b?.pronouns }, { a: nameOf("a"), b: nameOf("b") }, now.homeNow ?? null).text ?? label;
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
  const system = [
    "You write a private, adults-only scene for one reader: two characters from a dating show, alone together.",
    "Both characters are adults (18 or older) and both are willing. Explicit sexual content is allowed and expected when the scene goes there; write it frankly, in each character's own voice.",
    "Two rules never move: nobody in the scene is under 18 or described as a child, and no real, identifiable person appears or is named.",
    ...(v2 ? voiceRules(a, b, { a: nameOf("a"), b: nameOf("b") }) : []),
    "",
    v2 ? sheetV2(a, "a", now.catchphraseUsed?.a, now.styles?.a) : sheetOf(a, "a", now.catchphraseUsed?.a),
    "",
    v2 ? sheetV2(b, "b", now.catchphraseUsed?.b, now.styles?.b) : sheetOf(b, "b", now.catchphraseUsed?.b),
    "",
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
    `Where they are now: ${where.place}${where.set && where.set.toLowerCase() !== where.place.toLowerCase() ? ` (the set: ${where.set})` : ""}. How far it's gone: ${STAGES[now.stage]} (stage ${now.stage + 1} of ${STAGES.length}: ${STAGES.join(" → ")}).`,
    // The night's places, so nobody asks "my place?" once they're there (Star × Chud, 2026-10-21, asked it at his place).
    (now.history?.length ?? 0) > 1 ? `Where they've been tonight, in order: ${historyPhrase(now.history!)}. They're at the last one now.` : "",
    now.homeNow ? `They're in ${nameOf(now.homeNow)}'s home now: nobody asks "my place?" or "your place?" again.` : "",
    "Pace and place, unless the steer says otherwise:",
    (now.linesAtStage ?? 0) < MIN_LINES_PER_STAGE
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
  const user =
    `Write the next ${LINES_PER_TURN} lines of the scene, alternating between ${first("a")} and ${first("b")}${v2 ? `, starting with ${first(next)}` : ""}. ` +
    `Each line is ${v2 ? "a few words to 3 sentences (now and then only an action)" : "1 to 3 sentences"} in that character's own voice, vivid and specific, never a stock line ("you feel amazing"). ` +
    (v2 ? "As it heats up they stay themselves: their work, their hobbies, their humour and their tells keep showing, and nothing reads like a romance novel. " : "") +
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
    (avoid.length ? ` Don't lean on these words again: ${avoid.join(", ")}.` : "") +
    ` Reply with a JSON object: {"lines": [{"who": "a", "action": "...", "text": "...", "why": "...", "memory": null}, {"who": "b", "action": "", "text": "...", "why": "...", "memory": ${v2 ? (cite ? `"${cite}"` : "null") : '"..."'}}], "place": "where they are at the end of these lines", "set": "the place itself in 2 to 4 words, e.g. ${v2 ? "the bedroom" : "his bedroom"}: the same as now unless they agreed to go somewhere", "stage": 1, "explicit": false, "picture": null}, where "a" is ${first("a")} and "b" is ${first("b")}, and "stage" is the stage number (1 to ${STAGES.length}) at the end of these lines.` +
    (v2
      ? ` On every line, "why" is one short private sentence on why this character says or does this now, naming the specific thing behind it: a memory, a detail from their sheet (their job, a hobby, a tell, a line of their bio), what they want, or what just happened; never a trait word on its own ("${first("b")} is ${trait}" says nothing), and each line's why is its own ("the moment" says nothing either). "memory" is the id of the memory it draws on from what they can remember (like "F3" or "M1"), or null.${sheetItems.length ? ` One of their own sheet details ("${sheetItems[0].label}"…) counts as a memory too.` : ""} Nobody sees these notes but the writer.`
      : ` On every line, "why" is one short private sentence on why this character says or does this now: the memory it draws on, a trait or tell from their sheet, what they want, or "the moment"; and "memory" is the memory it draws on, quoted or named from what they can remember, or null. Nobody sees these notes but the writer.`) +
    ` Set "explicit" to true once the scene is sexually explicit. Set "picture" only when, in these lines, one of them asks the other for a picture or to be shown something and the other agrees:` +
    ` {"of": "a", "b" or "both", "description": "what the picture shows, in one sentence: the pose, what they're wearing or not, the expression, the framing"}; otherwise null.`;
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

/** What else the model said about these lines: whether the scene is explicit, and a picture they agreed on. */
export type SceneMeta = { explicit: boolean; picture: { of: "a" | "b" | "both"; description: string } | null; place: string | null; stage: number | null; set?: string | null };

export function parseSceneMeta(raw: string): SceneMeta {
  try {
    const j = JSON.parse(unfence(raw).trim()) as { explicit?: unknown; picture?: { of?: unknown; description?: unknown } | null; place?: unknown; stage?: unknown; set?: unknown };
    const p = j.picture;
    const of = p && (p.of === "a" || p.of === "b" || p.of === "both") ? p.of : null;
    const description = p && typeof p.description === "string" ? p.description.trim().slice(0, 400) : "";
    const place = typeof j.place === "string" && j.place.trim() ? j.place.trim().slice(0, 120) : null;
    const n = Number(j.stage);
    const stage = Number.isFinite(n) ? Math.min(STAGES.length - 1, Math.max(0, Math.round(n) - 1)) : null;
    const set = typeof j.set === "string" && j.set.trim() ? j.set.trim().replace(/[.!]+$/, "").slice(0, 40) : null;
    return { explicit: j.explicit === true, picture: of && description ? { of, description } : null, place, stage, set };
  } catch {
    return { explicit: false, picture: null, place: null, stage: null, set: null };
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

/**
 * The new lines minus repeats (David, 2026-10-21: Star × Chud's lines 102–106 were 84–88 again): a line said before
 * tonight, word for word or nearly (lib/adult/continuity.ts repeatOf), or one the dates' near-duplicate critic flags is
 * dropped; a catchphrase past its once a chapter, or a tic the catchphrase critic flags, loses its sentence (the line
 * goes if nothing's left). `night` is everything said tonight that's at hand; `chapter` is this chapter's lines.
 */
export function dropRepeats(
  written: readonly SceneLine[],
  night: readonly SceneLine[],
  chapter: readonly SceneLine[],
  a: Character | null,
  b: Character | null,
  opts: { worn?: boolean } = {},
): { kept: SceneLine[]; dropped: DroppedLine[]; worn: number } {
  const kept: SceneLine[] = [];
  const dropped: DroppedLine[] = [];
  const drop = (l: SceneLine, reason: string) => dropped.push({ who: l.who, text: l.text, reason });
  // v2.1's worn phrases (lib/adult/quality.ts): each speaker's phrases tonight, so a fourth use loses its sentence.
  const named = phraseNames(a?.name ?? "", b?.name ?? "");
  const counts = opts.worn ? { a: countPhrases(night.filter((l) => l.who === "a"), named), b: countPhrases(night.filter((l) => l.who === "b"), named) } : null;
  let worn = 0;
  for (const l of written) {
    const before = [...night, ...kept];
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
    // v2.1: a phrase this speaker has already said in WORN_AT lines tonight ("let's see" in 23 of 59) loses its sentence;
    // the line goes if nothing's left. The v2.1 prompt lists these phrases, so the model was told.
    if (counts) {
      const mine = counts[l.who];
      const hit = wornIn(text, mine, named);
      if (hit) {
        worn++;
        text = withoutPhrase(text, (s) => wornIn(s, mine, named) !== null);
        if (!text) {
          drop(l, `a worn phrase ("${hit.phrase}", already in ${hit.count} of their lines tonight)`);
          continue;
        }
      }
    }
    const line = text === l.text ? l : { ...l, text };
    kept.push(line);
    if (counts) for (const p of phrasesIn(line.text, named)) counts[l.who].set(p, (counts[l.who].get(p) ?? 0) + 1);
  }
  return { kept, dropped, worn };
}

export type ContinueResult =
  | { ok: true; scene: AdultScene; added: number; held: number; repeats: number; dropped: number; pictures: Media[]; picture_note?: string }
  | { ok: false; status: number; message: string };

/**
 * How a steer is taken (David, 2026-10-19: "is it a light suggestion?"): a nudge (the default) is worked toward at the
 * scene's own pace, the pacing rules still hold; direct does it now and can jump stages.
 */
export type SteerMode = "nudge" | "direct";

/** What a scene keeps between steps (adult_scenes' columns): its lines, where it is, how far it's gone, where it's been. */
export type SceneState = Pick<AdultScene, "lines" | "prev_tail" | "place" | "stage" | "stage_from" | "set_place" | "cut_to" | "chapter" | "recap" | "place_history" | "moves">;

/** A scene before its first line, picking up where the pair's latest date ended (as loadScene makes one). */
export const emptyScene = (): SceneState => ({ lines: [], prev_tail: [], place: null, stage: 0, stage_from: 0, set_place: null, cut_to: null, chapter: 1, recap: null, place_history: [], moves: [] });

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
};

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
  });
  const usage: Usage[] = [];
  const flags: StepFlags = {
    calls: 0, retried: false, held: 0, repeats: 0, names_repaired: 0, names_dropped: 0, alternation_merged: 0, alternation_dropped: 0, alternation_boundary: 0,
    refused: 0, moralising: 0, refusal_reply: false, citations: [], worn_phrases: 0, show_copies_cut: 0, public_dropped: 0,
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
    for (const l of safe) {
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
      inScene.push(own.text === l.text ? l : { ...l, text: own.text });
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
    const reps = dropRepeats(inPlace, night, scene.lines, a, b, { worn: v2 });
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
    flags.alternation_merged += turns.merged;
    flags.alternation_dropped += turns.dropped.length;
    dropped.push(...drops, ...reps.dropped, ...turns.dropped);
    // Only repeats stood in the way (the note, and the message, say so as before).
    const onlyRepeats = reps.dropped.length > 0 && refused + named + publicDropped + turns.dropped.length === 0;
    return { raw, written, safe, kept: turns.kept, boundary: turns.boundary, onlyRepeats, repeated: reps.dropped };
  };

  let out: ReturnType<typeof guard>;
  try {
    flags.calls++;
    out = guard(await input.model.complete(messages, options));
    // Nothing safe was kept (all repeats, or out of the scene): once more, told why (the only time a step costs a second call).
    if (out.safe.length && !out.kept.length) {
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
  // detail (v2.1), or tonight so far.
  const others = [...memoryLabels(input.memories), ...sheetItems];
  const context = [scene.recap ?? "", ...(date?.transcript ?? []).map((t) => t.dialogue), ...night.slice(-SCENE_IN_PROMPT).map((l) => l.text)].join("\n");
  flags.citations = out.kept.map((l) => citeMemory(l.memory, shown, others, context));
  const kept = out.kept.map((l, i) => (flags.citations[i].facts.length ? { ...l, fact_ids: flags.citations[i].facts } : l));

  const meta = parseSceneMeta(raw);
  const resolve = async (label: string) => (input.resolveSet ? await input.resolveSet(label) : drawLabel(label).slice(0, 40));
  // Where they are now (lib/adult/continuity.ts): a rewording keeps the set; a move needs one to propose and the other
  // to agree in these lines, a move left this chapter, and somewhere they aren't already. Anything else is ignored.
  const settled = settlePlace({
    // Before the model has named a place, they're where their date was (they don't leave it unprompted either).
    current: { place: scene.place ?? date?.setting ?? null, set: scene.set_place },
    claimed: { place: meta.place, set: meta.set ?? null },
    lines: [...night, ...kept],
    from: night.length,
    movesThisChapter: movesTaken,
    homeNow,
    names,
    fromLines: v2,
  });
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
    // The scene's first set (or one named where the old one named nowhere): the closest drawn one, no move.
    set_place = await resolve(set_place);
    place_history = [...place_history.slice(0, -1), { place: place ?? set_place, set: set_place, home: homeNow, chapter: scene.chapter }];
  }
  if (settled.rejected) moves.push({ chapter: scene.chapter, at: scene.lines.length, from: scene.set_place ?? scene.place, to: settled.rejected.to, taken: false, reason: settled.rejected.reason });
  if (!place_history.length && (place || set_place)) place_history = [{ place: place ?? set_place!, set: set_place, home: null, chapter: scene.chapter }];
  // Unsteered, the stage moves at most one step, and only once the current one has had its lines; a steer can jump.
  const allowed = steer && steerMode === "direct" ? STAGES.length - 1 : scene.lines.length - scene.stage_from >= MIN_LINES_PER_STAGE ? scene.stage + 1 : scene.stage;
  // The model's claim, raised to what the lines plainly show when it ran behind them (lib/adult/stage-floor.ts); each line
  // carries the stage it was at, for the theater's label.
  const { perLine, stage } = stagesFor(kept, scene.stage, Math.min(meta.stage ?? scene.stage, allowed, publicCap !== null && !settled.moved ? publicCap : STAGES.length - 1));
  const stamped = kept.map((l, i) => ({ ...l, stage: perLine[i] }));
  const stage_from = stage === scene.stage ? scene.stage_from : scene.lines.length;
  const next: SceneState = { ...scene, lines: [...scene.lines, ...stamped], place, stage, stage_from, set_place, cut_to: null, place_history, moves };
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
 * Writes the next lines of a pair's scene (writeSceneStep) on After Dark's model and saves them: the scene, the month's
 * count, the facts the lines cited, pictures when it turns explicit or they ask, and the chapter when it's full.
 */
export async function continueScene(db: Db, adminId: string, x: string, y: string, direction: string | null, steerMode: SteerMode = "nudge"): Promise<ContinueResult> {
  const scene = await loadScene(db, adminId, x, y);
  if (!scene) return { ok: false, status: 404, message: "Pick two characters who are in after dark: this season's cast, or ones you've switched on." };
  const capped = await overCap(db, adminId, "writes");
  if (capped) return { ok: false, status: 429, message: capped };
  const steer = direction?.trim().slice(0, DIRECTION_MAX) || null;
  if (steer && !checkAdultText({ direction: steer }).ok) {
    return { ok: false, status: 422, message: "That steer crosses one of the two lines (nobody under 18, no real people)." };
  }
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
  });
  if (!step.ok) return { ok: false, status: step.status, message: step.message };
  const { meta, next } = step;
  const { lines, place, stage, stage_from, set_place, place_history, moves } = next;
  await db.query(
    `update adult_scenes set lines = $2::jsonb, place = $3, stage = $4, stage_from = $5, set_place = $6, cut_to = null, place_history = $7::jsonb, moves = $8::jsonb, updated_at = now() where id = $1`,
    [scene.id, JSON.stringify(lines), place, stage, stage_from, set_place, JSON.stringify(place_history), JSON.stringify(moves.slice(-40))],
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
  const after: AdultScene = { ...scene, ...next, picture_note: note };
  // A full chapter: filed as a saved night, recapped, and the night runs straight on into the next one.
  const chaptered = lines.length >= CHAPTER_LINES ? await nextChapter(db, adminId, after, a, b) : after;
  return {
    ok: true,
    scene: publicScene(chaptered),
    added: step.lines.length,
    held: step.flags.held,
    repeats: step.flags.repeats,
    dropped: step.flags.names_dropped + step.flags.alternation_dropped + step.flags.refused,
    pictures,
    ...(picture_note ? { picture_note } : {}),
  };
}

/** The running recap: the night so far, from the last recap and the chapter just finished. Falls back to the old one. */
export async function writeRecap(db: Db, a: Character | null, b: Character | null, before: string | null, lines: SceneLine[]): Promise<string | null> {
  const nameOf = (who: "a" | "b") => (who === "a" ? a?.name : b?.name) ?? who;
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
    const recap = (JSON.parse(raw.trim()) as { recap?: unknown }).recap;
    if (typeof recap !== "string" || !recap.trim()) return before;
    const text = recap.trim().slice(0, RECAP_MAX);
    return checkAdultText({ recap: text }).ok ? text : before;
  } catch {
    return before;
  }
}

/** Files a full chapter as a saved night and starts the next one, carrying the recap and the last few lines. */
async function nextChapter(db: Db, ownerId: string, scene: AdultScene, a: Character | null, b: Character | null): Promise<AdultScene> {
  const recap = await writeRecap(db, a, b, scene.recap, scene.lines);
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
  // The lines' thumbs (lib/line-feedback.ts) go with them to the saved night, before the scene's lines are cleared.
  await moveLineFeedback(db, scene.id, nightId);
  await rememberAfterDark(db, ownerId, a, b, recap, scene.lines);
  // The chapter's concrete facts, for the scene prompt from now on (lib/adult/facts.ts; After Dark only).
  await rememberFacts(db, ownerId, a, b, scene.lines);
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
  return { ...scene, lines: [], prev_tail, chapter, recap, stage_from, moves: [] };
}

/**
 * Set the scene (David, 2026-10-19: "set the venue to any scene… for 1 token", paid by the caller): the scene jumps to
 * the place typed, its set is drawn if it has none, and the next lines open on arriving there. Held to the two lines.
 */
export async function setSceneTo(db: Db, ownerId: string, x: string, y: string, place: string): Promise<{ ok: true; scene: AdultScene } | { ok: false; status: number; message: string }> {
  const label = place.trim().replace(/\s+/g, " ").slice(0, SET_SCENE_MAX);
  if (!label) return { ok: false, status: 400, message: "Say where to take them." };
  if (!checkAdultText({ place: label }).ok) return { ok: false, status: 422, message: "That place crosses one of the two lines (nobody under 18, no real people)." };
  const scene = await loadScene(db, ownerId, x, y);
  if (!scene) return { ok: false, status: 404, message: "Pick two characters who are in after dark." };
  const set_place = label.slice(0, 40);
  // A paid cut is a move nobody has to agree to, and it doesn't count against the chapter's moves.
  const place_history = [...scene.place_history, { place: label, set: set_place, home: null, chapter: scene.chapter }];
  const moves: MoveLog[] = [...scene.moves, { chapter: scene.chapter, at: scene.lines.length, from: scene.set_place ?? scene.place, to: set_place, taken: true, reason: "set_scene" }];
  await db.query(`update adult_scenes set place = $2, set_place = $3, cut_to = $2, place_history = $4::jsonb, moves = $5::jsonb, updated_at = now() where id = $1`, [
    scene.id,
    label,
    set_place,
    JSON.stringify(place_history),
    JSON.stringify(moves.slice(-40)),
  ]);
  await ensureSet(db, set_place);
  return { ok: true, scene: publicScene({ ...scene, place: label, set_place, cut_to: label, place_history, moves }) };
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
export type LineNote = { i: number; who: string; text: string; why: string | null; memory: string | null; moved_to: string | null; facts: string[] | null };
export type SceneNotes = {
  a: { id: string; name: string };
  b: { id: string; name: string };
  current: { chapter: number; place: string | null; set_place: string | null; place_history: PlaceStop[]; moves: MoveLog[]; lines: LineNote[] };
  nights: { id: string; chapter: number | null; created_at: string; set_place: string | null; moves: MoveLog[] | null; lines: LineNote[] }[];
};

const notesOf = (lines: readonly SceneLine[], names: { a: string; b: string }): LineNote[] =>
  lines.map((l, i) => ({ i, who: l.who === "a" ? names.a : names.b, text: l.text, why: l.why ?? null, memory: l.memory ?? null, moved_to: l.moved_to ?? null, facts: l.fact_ids ?? null }));

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
  return {
    a: scene.a,
    b: scene.b,
    current: { chapter: scene.chapter, place: scene.place, set_place: scene.set_place, place_history: scene.place_history, moves: scene.moves, lines: notesOf(scene.lines, names) },
    nights: rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString(), lines: notesOf(r.lines ?? [], names) })),
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
    // The lines' thumbs (lib/line-feedback.ts) go with them to the saved night.
    await moveLineFeedback(db, scene.id, nightId);
  }
  await db.query(
    `update adult_scenes set lines = '[]'::jsonb, place = null, stage = 0, stage_from = 0, picture_note = null, set_place = null, cut_to = null, chapter = 1, recap = null, prev_tail = '[]'::jsonb, place_history = '[]'::jsonb, moves = '[]'::jsonb, updated_at = now() where owner_id = $1 and character_a = $2 and character_b = $3`,
    [adminId, ...pair],
  );
}
