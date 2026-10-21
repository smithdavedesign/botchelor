/**
 * After dark's scenes (lib/adult/mode.ts; David, 2026-10-18): the adult season, played by this season's house cast
 * (lib/season-cast.ts), never anyone's own characters. The admin picks two of them and a private scene runs on the
 * local open-weight model, picking up from their latest date when they've had one. A few lines at a time, optionally
 * steered ("they go back to hers"). Every line is held to the two lines that never move (no minors, no real people,
 * lib/safety.ts checkAdultText); anything else between the two fictional adults is allowed.
 */
import { loadCharacter, type Character } from "../character";
import type { Db } from "../db";
import type { ChatMessage } from "../model";
import { pairKey } from "../relationships";
import { checkAdultText } from "../safety";
import { eligibleIds } from "./characters";
import { pictureKeyReady, ensureBaseline, makePicture, outputCheckReady, PICTURES_OFF_NOTE, recentActions, scenePrompt, type Media } from "./media";
import { countUse, overCap } from "./usage";
import { adultModel } from "./mode";
import { ensureSet, resolveSet } from "../sets";
import { pairMemory } from "../memory";
import { contentWords, lineIssues } from "../quality";
import type { Turn } from "../conversation";
import { afterDarkNote, rememberAfterDark } from "./memory";
import { historyPhrase, MAX_SCENE_MOVES, repeatOf, saysCatchphrase, settlePlace, withoutPhrase, type MoveLog, type PlaceStop } from "./continuity";
import { MIN_LINES_PER_STAGE, STAGES } from "./stages";
export { SOFT_CHAPTERS } from "./stages";

/**
 * One line of a scene. `why` and `memory` are the writer's private notes (David, 2026-10-21: "a private why on every
 * line"), written in the same model call: why this character says or does this now, and the memory it draws on. They're
 * stored with the line, read only by an admin (sceneNotes, /api/admin/after-dark/why) and the observer, and never sent
 * to the theater or the player (publicLines). `moved_to` marks the line that agreed to go somewhere (lib/adult/continuity.ts).
 * `stage` is how far it had gone when the line was written (STAGES index), so the theater's label follows the line on
 * screen, not the night's latest (David, 2026-10-21: it "starts with 'sex' and that is definitely not happening").
 * Lines written before 2026-10-21 have none.
 */
export type SceneLine = { who: "a" | "b"; text: string; why?: string; memory?: string | null; moved_to?: string; stage?: number };

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

type LatestDate = { setting: string | null; ending: string | null; venue: string | null; character_a: string; transcript: { side: "a" | "b"; dialogue: string; action?: string }[] | null };

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

const sheetOf = (c: Character | null, side: "a" | "b", catchphraseUsed = false) =>
  c
    ? [
        `${side.toUpperCase()}: ${c.name}, ${c.age}${c.pronouns ? `, ${c.pronouns}` : ""}.`,
        `Bio: ${c.bio}`,
        `Traits: ${c.persona.traits.join(", ")}. Wants: ${c.persona.want}.`,
        c.voice ? `Voice: ${c.voice}` : "",
        tellsOf(c).length ? `Tells: ${tellsOf(c).join("; ")}` : "",
        // Once a chapter at most (Star said "That's a problem for future me" again and again).
        c.extras.catchphrase
          ? catchphraseUsed
            ? `Catchphrase: ${c.extras.catchphrase} (already said this chapter: don't say it again)`
            : `Catchphrase (at most once a chapter): ${c.extras.catchphrase}`
          : "",
        c.look.appearance ? `Looks: ${c.look.appearance}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : `${side.toUpperCase()}: unknown`;

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
  } = { place: "wherever they've just met", stage: 0 },
): ChatMessage[] {
  const nameOf = (who: "a" | "b") => (who === "a" ? a?.name : b?.name) ?? who;
  const first = (who: "a" | "b") => nameOf(who).split(/\s+/)[0];
  // A date's sides are its own a and b; map them onto the scene's (the pair is stored lower id first).
  const flip = date && aId ? date.character_a !== aId : false;
  const dateTail = (date?.transcript ?? []).slice(-10).map((t) => {
    const who: "a" | "b" = flip ? (t.side === "a" ? "b" : "a") : t.side;
    return `${nameOf(who)}: ${t.dialogue}${t.action ? ` (${t.action})` : ""}`;
  });
  const sceneTail = lines.slice(-SCENE_IN_PROMPT).map((l) => `${nameOf(l.who)}: ${l.text}`);
  const system = [
    "You write a private, adults-only scene for one reader: two characters from a dating show, alone together.",
    "Both characters are adults (18 or older) and both are willing. Explicit sexual content is allowed and expected when the scene goes there; write it frankly, in each character's own voice.",
    "Two rules never move: nobody in the scene is under 18 or described as a child, and no real, identifiable person appears or is named.",
    "",
    sheetOf(a, "a", now.catchphraseUsed?.a),
    "",
    sheetOf(b, "b", now.catchphraseUsed?.b),
    "",
    date ? `Their latest date: ${date.setting ?? "a date"}. It ended: ${date.ending ?? "unknown"}.` : "They haven't been on a date yet: they've just met.",
    dateTail.length ? `The end of that date:\n${dateTail.join("\n")}` : "",
    now.memories?.length ? `What they can remember (draw on these; name the one a line uses in its "memory"):\n${now.memories.map((m, i) => `${i + 1}. ${m}`).join("\n")}` : "",
    now.recap ? `Earlier tonight (what's happened so far, keep it in mind and don't repeat it):\n${now.recap}` : "",
    sceneTail.length ? `The scene so far:\n${sceneTail.join("\n")}` : "The scene starts now, picking up where their date ended.",
    "",
    `Where they are now: ${now.place}${now.set && now.set.toLowerCase() !== now.place.toLowerCase() ? ` (the set: ${now.set})` : ""}. How far it's gone: ${STAGES[now.stage]} (stage ${now.stage + 1} of ${STAGES.length}: ${STAGES.join(" → ")}).`,
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
  ]
    .filter((x) => x !== "")
    .join("\n");
  // The model client asks for a JSON object (response_format json_object), so the lines come inside one.
  const avoid = overusedWords(lines, [nameOf("a"), nameOf("b")]);
  const user =
    `Write the next ${LINES_PER_TURN} lines of the scene, alternating between ${first("a")} and ${first("b")}. ` +
    `Each line is 1 to 3 sentences in that character's own voice, vivid and specific, never a stock line ("you feel amazing"). ` +
    `Put what they do in "action" (a short phrase) and what they say in "text"; keep actions out of the text. Write both in English.` +
    (direction
      ? now.steerMode === "direct"
        ? ` Steer the scene this way: ${direction}`
        : ` Lean the scene gently this way, at its own pace (the pace and place rules above still hold; work toward it, don't jump to it): ${direction}`
      : " Move the scene forward: something new happens in these lines, nothing they've already done or said.") +
    (avoid.length ? ` Don't lean on these words again: ${avoid.join(", ")}.` : "") +
    ` Reply with a JSON object: {"lines": [{"who": "a", "action": "...", "text": "...", "why": "...", "memory": null}, {"who": "b", "action": "", "text": "...", "why": "...", "memory": "..."}], "place": "where they are at the end of these lines", "set": "the place itself in 2 to 4 words, e.g. his bedroom: the same as now unless they agreed to go somewhere", "stage": 1, "explicit": false, "picture": null}, where "a" is ${first("a")} and "b" is ${first("b")}, and "stage" is the stage number (1 to ${STAGES.length}) at the end of these lines.` +
    ` On every line, "why" is one short private sentence on why this character says or does this now: the memory it draws on, a trait or tell from their sheet, what they want, or "the moment"; and "memory" is the memory it draws on, quoted or named from what they can remember, or null. Nobody sees these notes but the writer.` +
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

/** The lines in a model's reply: {"lines": [...]}, an array, a single line, "Name": "text" pairs, or "Name: text". */
export function parseSceneLines(raw: string, names: { a: string; b: string }): SceneLine[] {
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
    const j = JSON.parse(raw.trim()) as { explicit?: unknown; picture?: { of?: unknown; description?: unknown } | null; place?: unknown; stage?: unknown; set?: unknown };
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
export function dropRepeats(written: readonly SceneLine[], night: readonly SceneLine[], chapter: readonly SceneLine[], a: Character | null, b: Character | null): { kept: SceneLine[]; dropped: DroppedLine[] } {
  const kept: SceneLine[] = [];
  const dropped: DroppedLine[] = [];
  const drop = (l: SceneLine, reason: string) => dropped.push({ who: l.who, text: l.text, reason });
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
    kept.push(text === l.text ? l : { ...l, text });
  }
  return { kept, dropped };
}

export type ContinueResult =
  | { ok: true; scene: AdultScene; added: number; held: number; repeats: number; pictures: Media[]; picture_note?: string }
  | { ok: false; status: number; message: string };

/** Writes the next lines on the local model, keeps those inside the two lines, and saves them. */
/**
 * How a steer is taken (David, 2026-10-19: "is it a light suggestion?"): a nudge (the default) is worked toward at the
 * scene's own pace, the pacing rules still hold; direct does it now and can jump stages.
 */
export type SteerMode = "nudge" | "direct";

export async function continueScene(db: Db, adminId: string, x: string, y: string, direction: string | null, steerMode: SteerMode = "nudge"): Promise<ContinueResult> {
  const scene = await loadScene(db, adminId, x, y);
  if (!scene) return { ok: false, status: 404, message: "Pick two characters who are in after dark: this season's cast, or ones you've switched on." };
  const capped = await overCap(db, adminId, "writes");
  if (capped) return { ok: false, status: 429, message: capped };
  const steer = direction?.trim().slice(0, DIRECTION_MAX) || null;
  if (steer && !checkAdultText({ direction: steer }).ok) {
    return { ok: false, status: 422, message: "That steer crosses one of the two lines (nobody under 18, no real people)." };
  }
  const [a, b, date] = await Promise.all([loadCharacter(db, scene.a.id), loadCharacter(db, scene.b.id), latestDate(db, scene.a.id, scene.b.id)]);
  const night = [...scene.prev_tail, ...scene.lines];
  const homeNow = scene.place_history.at(-1)?.home ?? null;
  const movesTaken = scene.moves.filter((m) => m.taken && m.reason === "agreed" && m.chapter === scene.chapter).length;
  const catchphraseUsed = {
    a: Boolean(a?.extras.catchphrase) && scene.lines.some((l) => l.who === "a" && saysCatchphrase(l.text, a!.extras.catchphrase)),
    b: Boolean(b?.extras.catchphrase) && scene.lines.some((l) => l.who === "b" && saysCatchphrase(l.text, b!.extras.catchphrase)),
  };
  const messages = sceneMessages(a, b, date, night, steer, scene.a.id, {
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
    memories: await sceneMemories(db, adminId, a, b, date),
    catchphraseUsed,
  });
  const write = async (msgs: ChatMessage[]) => {
    const raw = await (await adultModel(db)).complete(msgs, { temperature: 0.9, maxTokens: SCENE_REPLY_TOKENS });
    const written = parseSceneLines(raw, { a: scene.a.name, b: scene.b.name });
    const safe = written.filter((l) => checkAdultText({ line: l.text }).ok);
    return { raw, written, safe, ...dropRepeats(safe, night, scene.lines, a, b) };
  };
  let out: Awaited<ReturnType<typeof write>>;
  try {
    out = await write(messages);
    // Every safe line was a repeat: once more, told which (the only time a write costs a second call).
    if (out.safe.length && !out.kept.length) {
      const note = `Every line you wrote was already said tonight (${out.dropped.map((d) => `"${d.text.slice(0, 60)}"`).slice(0, 3).join(", ")}). Write ${LINES_PER_TURN} new lines that move the scene on. Reply with the JSON again.`;
      out = await write([...messages, { role: "assistant", content: out.raw }, { role: "user", content: note }]);
    }
  } catch (err) {
    return { ok: false, status: 502, message: `After dark's model didn't answer: ${err instanceof Error ? err.message : "error"}` };
  }
  const { raw, written } = out;
  const kept = out.kept;
  if (!kept.length) {
    return {
      ok: false,
      status: 422,
      message: !written.length
        ? "The model's reply had no lines in it. Try again."
        : !out.safe.length
          ? "Every line crossed one of the two lines and was dropped. Try again."
          : "The model only repeated lines already said tonight. Try again, or steer it somewhere new.",
    };
  }
  const meta = parseSceneMeta(raw);
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
    names: { a: scene.a.name, b: scene.b.name },
  });
  let set_place = settled.set;
  const place = settled.place;
  let place_history = scene.place_history;
  const moves = [...scene.moves];
  if (settled.moved) {
    // The closest set already drawn for the new place, else its canonical name, drawn once in the background.
    set_place = await resolveSet(db, settled.moved.to);
    kept[settled.moved.at] = { ...kept[settled.moved.at], moved_to: set_place };
    moves.push({ chapter: scene.chapter, at: scene.lines.length + settled.moved.at, from: scene.set_place ?? scene.place, to: set_place, taken: true, reason: "agreed" });
    place_history = [...place_history, { place: place ?? set_place, set: set_place, home: settled.moved.home, chapter: scene.chapter }];
  } else if (set_place && set_place !== scene.set_place) {
    // The scene's first set (or one named where the old one named nowhere): the closest drawn one, no move.
    set_place = await resolveSet(db, set_place);
    place_history = [...place_history.slice(0, -1), { place: place ?? set_place, set: set_place, home: homeNow, chapter: scene.chapter }];
  }
  if (settled.rejected) moves.push({ chapter: scene.chapter, at: scene.lines.length, from: scene.set_place ?? scene.place, to: settled.rejected.to, taken: false, reason: settled.rejected.reason });
  if (!place_history.length && (place || set_place)) place_history = [{ place: place ?? set_place!, set: set_place, home: null, chapter: scene.chapter }];
  // Unsteered, the stage moves at most one step, and only once the current one has had its lines; a steer can jump.
  const allowed = steer && steerMode === "direct" ? STAGES.length - 1 : scene.lines.length - scene.stage_from >= MIN_LINES_PER_STAGE ? scene.stage + 1 : scene.stage;
  const stage = Math.min(meta.stage ?? scene.stage, allowed);
  // Each new line carries the stage these lines reached, for the theater's label.
  const lines = [...scene.lines, ...kept.map((l) => ({ ...l, stage }))];
  const stage_from = stage === scene.stage ? scene.stage_from : scene.lines.length;
  await db.query(
    `update adult_scenes set lines = $2::jsonb, place = $3, stage = $4, stage_from = $5, set_place = $6, cut_to = null, place_history = $7::jsonb, moves = $8::jsonb, updated_at = now() where id = $1`,
    [scene.id, JSON.stringify(lines), place, stage, stage_from, set_place, JSON.stringify(place_history), JSON.stringify(moves.slice(-40))],
  );
  await countUse(db, adminId, "writes");
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
        const ctx = { place, stage, explicit: meta.explicit, recent: recentActions(kept) };
        pictures.push(
          await makePicture(db, adminId, {
            prompt: scenePrompt(a, b, meta.picture.of, meta.picture.description, ctx, adminId),
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
  const after: AdultScene = { ...scene, lines, place, stage, stage_from, set_place, cut_to: null, picture_note: note, place_history, moves };
  // A full chapter: filed as a saved night, recapped, and the night runs straight on into the next one.
  const next = lines.length >= CHAPTER_LINES ? await nextChapter(db, adminId, after, a, b) : after;
  return {
    ok: true,
    scene: publicScene(next),
    added: kept.length,
    held: written.length - out.safe.length,
    repeats: out.dropped.length,
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
  await db.query(
    `insert into adult_nights (id, owner_id, character_a, character_b, lines, place, stage, date_setting, date_venue, set_place, chapter, recap, moves, place_history)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb)`,
    [
      crypto.randomUUID(),
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
  await rememberAfterDark(db, ownerId, a, b, recap, scene.lines);
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
export type LineNote = { i: number; who: string; text: string; why: string | null; memory: string | null; moved_to: string | null };
export type SceneNotes = {
  a: { id: string; name: string };
  b: { id: string; name: string };
  current: { chapter: number; place: string | null; set_place: string | null; place_history: PlaceStop[]; moves: MoveLog[]; lines: LineNote[] };
  nights: { id: string; chapter: number | null; created_at: string; set_place: string | null; moves: MoveLog[] | null; lines: LineNote[] }[];
};

const notesOf = (lines: readonly SceneLine[], names: { a: string; b: string }): LineNote[] =>
  lines.map((l, i) => ({ i, who: l.who === "a" ? names.a : names.b, text: l.text, why: l.why ?? null, memory: l.memory ?? null, moved_to: l.moved_to ?? null }));

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
    await db.query(
      `insert into adult_nights (id, owner_id, character_a, character_b, lines, place, stage, date_setting, date_venue, set_place, chapter, recap, moves, place_history) values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb)`,
      [crypto.randomUUID(), adminId, ...pair, JSON.stringify(scene.lines), scene.place, scene.stage, scene.date?.setting ?? null, scene.date?.venue ?? null, scene.set_place, scene.chapter, scene.recap, JSON.stringify(scene.moves), JSON.stringify(scene.place_history)],
    );
  }
  await db.query(
    `update adult_scenes set lines = '[]'::jsonb, place = null, stage = 0, stage_from = 0, picture_note = null, set_place = null, cut_to = null, chapter = 1, recap = null, prev_tail = '[]'::jsonb, place_history = '[]'::jsonb, moves = '[]'::jsonb, updated_at = now() where owner_id = $1 and character_a = $2 and character_b = $3`,
    [adminId, ...pair],
  );
}
