/**
 * The full-night video (David, 2026-10-19: "send the full conversation over to be generated with the transcript and a
 * few base images of both characters… this is the bread winner"). A reel is a short film of a whole night: the director
 * (After Dark's text model) picks its strongest lines (the opening, the build, the peak, the close: the peak is rarely
 * at either end) and writes each as a shot of the two of them; the shots play in order with the line as a caption.
 *
 *  - Both of them in every shot (David, 2026-10-22, on Lexi and Dex's video: it "doesn't actually show the
 *    interacting… they are not in the same video together"). A video model can only move what its first frame holds.
 *    Started from one person's portrait it filmed them alone (#588: lines said to the camera, sex played as a solo);
 *    asked for "two adults" from one portrait, it made the partner up (Star Dust and Sable's strangers). So each shot
 *    starts from a keyframe of BOTH of them: their two baselines, made by Venice's multi-image edit into one picture of
 *    them posed as the script has them at that line, in the night's place (its drawn set as a third picture, when there
 *    is one). Every test clip David liked (Chud and Sable, 2026-10-19) started from a picture of the two of them; the
 *    adult products that show two people touching all start from a frame that already holds both (docs/after-dark.md,
 *    "Videos with both of them in").
 *  - The director writes each shot as a still (`frame`: where they are, how they're posed toward each other, what they
 *    wear by then, the framing) and what they do next (`motion`), from the line's action and the lines before it. It
 *    names them only by how they look ("the woman", "the man", or by their hair when both are women or both men): a
 *    name means nothing to a picture model, and can pull a real person's face.
 *  - Voices: a model that makes its own sound (Wan 3.0, David's pick) says the line, quoted in its prompt, in the same
 *    voice words for a character every shot. A model that takes our audio in (Wan 2.5–2.7, each character's stock
 *    Kokoro voice, never a cloned one) lip-syncs it to whichever face is clearest, often the wrong one in a two-person
 *    shot (2026-10-22: Dex's line on Lexi's mouth); it stays a setting (`reel_model`).
 *  - The check: every keyframe passes Hive's age question before a video is made from it, and every shot passes Hive's
 *    moderation before it's stored (lib/adult/check.ts); a failure is discarded, never stored, and its share of the
 *    tokens given back. A keyframe doesn't get moderation of its own (2026-10-23: self-serve Hive's daily cap counts
 *    moderation requests, and a 6-shot video used 12): the shot's moderation samples its frames, the first of them that
 *    keyframe, and a keyframe isn't shown on its own until its shot has passed (lib/adult/media.ts FRAME_SHOWN). While
 *    Hive is over its daily limit (lib/adult/hive-limit.ts) no video starts, and a shot already made waits, uncollected
 *    and unchecked, until the pause is over.
 *  - The price: `reel_tokens` bought tokens (After Dark's settings), admins free.
 *  - On Replicate, the backup (`media_provider`, David 2026-10-22; lib/adult/replicate.ts): the keyframe is Qwen-Image-
 *    Edit's, the shot Wan 2.2's, both with Replicate's safety checker off and both through the same Hive check. Wan
 *    2.2 is silent, so once a shot is kept its line is said by the character's stock Kokoro voice, stored beside it
 *    (an adult_images 'audio', `audio_id`) and played with it. A shot keeps who makes it (`provider`), so a reel
 *    started on one finishes there.
 *
 * The keyframes are drawn, checked and queued when the reel starts. Shots take minutes on Venice, so a reel is then
 * advanced by whoever's watching (GET polls advanceReel).
 */
import { isAdmin } from "../admins";
import { refundBoughtTokens, spendBoughtTokens } from "../allowance";
import type { Character } from "../character";
import { loadCharacter } from "../character";
import type { Db } from "../db";
import { keepBytes } from "../object-store";
import { checkAdultText } from "../safety";
import { getSet } from "../sets";
import { normalizeScene, setPath } from "../venues";
import { crossesTaboo } from "./acts";
import type { CheckResult } from "./check";
import { checkMedia } from "./moderation";
import { providerError, runMedia } from "./fallback";
import { hiveGate, hivePausedErrorMessage, hivePausedReason, HivePausedError, hivePausedUntil } from "./hive-limit";
import type { PlaceStop } from "./continuity";
import { beatPictureFor } from "./beats";
import { ensureBaseline, ensureNudeBaseline, lookWords, signedMediaUrl } from "./media";
import { nudeSql } from "./attire";
import { adultModel } from "./mode";
import { REEL_STALLED_MS } from "./reel-timing";
import { cancelPrediction, createPrediction, downloadOutput, getPrediction, isDone, noOutput, outputUrls, ReplicateError, runModel, type Prediction, type ReplicateFile } from "./replicate";
import { dropForeignActions, eligiblePair, type SceneLine } from "./scenes";
import { groupNights, type NightChapter } from "./nights";
import { adultKeys, getAdultSettings, type MediaProvider } from "./settings";
import { STAGES } from "./stages";
import { faceReferenceId, NO_STEERING, ratingsFor, steeringFor } from "./steering";

export const VENICE = "https://api.venice.ai/api/v1";
/** Shots in a reel, and how many words a shot can carry (people say about 2.5 words a second). */
export const REEL_SHOTS = 6;
const WORDS_5S = 12;
const WORDS_MAX = 24;
const SHOTS_PER_POLL = 2;
/**
 * A shot Hive couldn't check (busy, rate-limited) waits this long before it's fetched and sent again. Without it, an
 * open page polling every 15s re-sent two 10 MB shots to Hive each time, which kept Hive rate-limiting the whole site
 * (2026-10-19). And a reel still waiting after REEL_GIVE_UP_MS gives up on those shots, so it stops blocking new ones.
 */
export const CHECK_RETRY_MS = 10 * 60 * 1000;
export const REEL_GIVE_UP_MS = 3 * 60 * 60 * 1000;
/**
 * The multi-image edit that draws a shot's keyframe: hosted by Venice itself, uncensored, and it keeps both faces (the
 * bake-off of 2026-10-22: FireRed missed the pose and kept a baseline's lingerie). $0.04 a keyframe.
 */
export const KEYFRAME_MODEL = "qwen-edit-uncensored";
/** Its prompt limit (promptCharacterLimit in Venice's model list). */
const KEYFRAME_PROMPT_MAX = 1500;
/** From "undressing" (stage 4 of 5) on, a keyframe is explicit; before it, they're dressed; from "sex", nude. */
const UNDRESSED_FROM = 3;
export const NUDE_FROM = 4;
/**
 * What they wear in a keyframe, by how far the night had gone, never what their portrait wears (2026-10-22, the first
 * live reel: told to keep each "exactly as in their own picture", Lexi kept her portrait's lingerie through the sex).
 */
const clothesAt = (stage: number) =>
  stage >= NUDE_FROM
    ? "both are nude unless the moment says otherwise"
    : stage >= UNDRESSED_FROM
      ? "they're half undressed, as the moment says"
      : // Clips of 2026-10-22: "dressed as the moment says" still lost the man's shirt in a kiss. Spelled out, it stays on.
        "they're dressed as the moment says, not nude: both fully clothed, shirts and tops on and done up";
/** Between two keyframe checks, and before asking again when Hive couldn't check one: Hive rate-limits a burst. */
const CHECK_PAUSE_MS = 1500;
const CHECK_AGAIN_MS = 5000;
/** A shot with no video queued this long after its reel started was cut off while starting (the POST runs 300 s at most). */
const NEVER_QUEUED_MS = 10 * 60 * 1000;
/** Kokoro's stock voices, by how a character is referred to. */
const VOICES = {
  she: ["af_bella", "af_nicole", "af_sarah", "af_heart", "af_nova", "af_jessica", "af_kore", "af_aoede"],
  he: ["am_onyx", "am_michael", "am_adam", "am_eric", "am_liam", "am_fenrir", "am_echo", "am_puck"],
  they: ["af_river", "am_echo", "af_sky", "am_liam"],
} as const;
/** Models that take our audio in and lip-sync to it; anything else gets the line quoted in its prompt. */
const AUDIO_IN = /^wan-2\.(5|6)|^wan-2-7-(image|text)-to-video/;
/** On every shot: away from anyone young-looking, and from what breaks a shot of two (a third person, a cut). */
const SHOT_NEGATIVE =
  "child, teen, minor, young-looking, cartoon, anime, distorted faces, extra limbs, text, watermark, " +
  "a third person, extra people, a duplicate person, scene cut, scene change, morphing face";

export type ReelShot = {
  line: number;
  who: "a" | "b";
  text: string;
  /** The director's still of the two of them at this line: what the keyframe shows. */
  frame?: string;
  /** What they do next: what the shot shows. */
  motion: string;
  status: "queued" | "ready" | "discarded" | "failed";
  queue_id?: string;
  model?: string;
  /** While queued, the keyframe the shot starts from (an adult_images 'frame' of the two of them); once ready, the shot. */
  media_id?: string;
  reason?: string;
  /** After a check that couldn't run: not fetched or sent to Hive again before this time. */
  retry_at?: string;
  /** Made on Replicate (unset: Venice). Its `queue_id` is then the prediction's id. */
  provider?: "replicate";
  /** On Replicate: the stock voice that says the line, and once the shot is in, that line (an adult_images 'audio'). */
  voice?: string;
  audio_id?: string;
  /** The keyframe it started from, once that passed the check (an adult_images 'frame'): what Keep going carries on from. */
  frame_id?: string;
  /**
   * Who drew its keyframe, and whether the keyframe or the video went to the other provider because the configured one
   * was limited (lib/adult/fallback.ts). A queued video is always collected where it was queued (`provider`).
   */
  frame_provider?: MediaProvider;
  fell_back?: boolean;
  /**
   * In a reel of the whole night (scope "night"), the chapter its line is from: its number, its saved night (null: the
   * running scene's when the reel was made), and the line's index in that chapter (`line` counts across the night).
   */
  chapter?: number | null;
  night_id?: string | null;
  chapter_line?: number;
  /**
   * It starts from one of the night's beat pictures (lib/adult/beats.ts), already in the gallery and checked, instead of
   * a keyframe drawn for it: `media_id` and `frame_id` are that picture.
   */
  from_beat?: boolean;
  /**
   * When it was moved to the Archive (archiveShot): kept, never deleted, and out of every player until it's put back
   * (lib/adult/clip-chains.ts playable).
   */
  archived_at?: string;
  /** Archived by a 👎 on the shot (shotsFollowRating), so taking the 👎 back puts it back; one archived by hand stays. */
  archived_by?: "rating";
  /** Read with the reel for the one watching, never stored in it: their 👍/👎 on the shot and what was off (lib/adult/steering.ts). */
  rating?: 1 | -1 | null;
  tags?: string[];
};
/**
 * A clip (lib/adult/clips.ts): one shot made on request, from the menu's act or the scene's latest moment, and the clip
 * it keeps going from. `label` is what the videos list calls it.
 */
export type ClipMeta = { act: string | null; swap: boolean; from: string | null; stage: number; place: string | null; label: string };
/** A video: a night's reel (`kind` "night", the default) or a clip; `a` and `b` are the pair's ids, lower first. */
export type Reel = {
  id: string;
  status: "making" | "ready" | "failed";
  tokens: number;
  shots: ReelShot[];
  created_at: string;
  kind?: "night" | "clip";
  clip?: ClipMeta | null;
  a?: string;
  b?: string;
  /** A night's reel: one chapter or the whole night, and the chapters it filmed (null: made before it was recorded). */
  scope?: ReelScope | null;
  chapters?: ReelChapter[] | null;
};

type Fetch = typeof fetch;
let testFetch: Fetch | null = null;
export function setReelFetchForTests(f: Fetch | null): void {
  testFetch = f;
}
const doFetch: Fetch = (...a) => (testFetch ?? fetch)(...a);
let pauseScale = 1;
/** Tests run the pauses between Hive checks at no length. */
export function setReelPausesForTests(on: boolean): void {
  pauseScale = on ? 1 : 0;
}
const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms * pauseScale));

/** A character's voice: picked once from their pronouns and id, so it's the same in every reel. */
export function voiceFor(c: Pick<Character, "id" | "pronouns">): string {
  const p = c.pronouns?.toLowerCase() ?? "";
  const list = p.startsWith("she") ? VOICES.she : p.startsWith("he") ? VOICES.he : VOICES.they;
  let h = 0;
  for (const ch of c.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

/** What a line says out loud (its *action* apart), cut to what fits a shot. */
export function spoken(text: string): { speech: string; action: string } {
  const m = text.match(/^\*([^*]+)\*\s*([\s\S]*)$/);
  const words = (m ? m[2] : text).trim().split(/\s+/).filter(Boolean);
  return { speech: words.slice(0, WORDS_MAX).join(" "), action: m ? m[1].trim() : "" };
}

/** One of the two as a shot names them: never by name. */
export type ReelPerson = {
  id: string;
  pronouns: string | null;
  noun: "woman" | "man" | "person";
  /** "the woman"; or, when both are women (or both men), by their hair: "the woman with wild curly copper hair". */
  tag: string;
  /** How they look, dressed as their looks say (lib/adult/media.ts lookWords), for the director. */
  look: string;
  /** The same voice words in every shot, for a model that says the line itself. */
  voice: string;
  /** The words of their name, kept out of anything a picture or video model reads. */
  names: string[];
};

const nounOf = (pronouns: string | null): ReelPerson["noun"] => (pronouns?.startsWith("she") ? "woman" : pronouns?.startsWith("he") ? "man" : "person");
const HAIR = /\b(?:hair|bob|curls|braids|bun|ponytail|locks|afro|dreadlocks|buzz cut|crew cut|undercut|mohawk|bald|shaved head)\b/i;
const NAME_SKIP = new Set(["the", "and", "of", "von", "van", "der", "de", "del", "la", "le", "da"]);
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * What tells someone apart at a glance: their hair, as the look words it ("in her late twenties with pale freckled skin
 * and long auburn hair" → "long auburn hair"), else their skin, else the first thing about them.
 */
export function feature(look: string): string {
  const parts = look.split(/,\s*/).map((p) => p.trim()).filter(Boolean);
  const words = (p: string, re: RegExp) => {
    const m = p.match(re);
    if (m?.index === undefined) return "";
    // The words just before it, back to a "with" or an "and": the ones about it.
    const before = p.slice(0, m.index).split(/\b(?:with|and)\b/i).pop()!.trim().split(/\s+/).filter(Boolean).slice(-5);
    return [...before, m[0]].join(" ");
  };
  for (const p of parts) if (HAIR.test(p)) return words(p, HAIR);
  for (const p of parts) if (/\bskin\b/i.test(p)) return words(p, /\bskin\b/i);
  return parts[0]?.split(/\s+/).slice(0, 6).join(" ") ?? "";
}

/** The same voice words for a character in every shot. */
const voiceWords = (noun: ReelPerson["noun"], age: number) =>
  noun === "man" ? (age >= 35 ? "a deep, warm man's voice" : "a man's voice") : noun === "woman" ? (age >= 35 ? "a low, warm woman's voice" : "a bright woman's voice") : "a soft voice";

/**
 * The two of them as a reel names them: "the woman" and "the man"; two women (or two men) by their hair, so a picture
 * model can tell them apart; and, when even that reads the same, first and second.
 */
export function reelCast(a: Character, b: Character, viewer?: string | null): [ReelPerson, ReelPerson] {
  const one = (c: Character, other: Character): ReelPerson => {
    const noun = nounOf(c.pronouns);
    const f = noun === nounOf(other.pronouns) ? feature(lookWords(c, true, viewer, true)) : "";
    return {
      id: c.id,
      pronouns: c.pronouns,
      noun,
      tag: f ? `the ${noun} with ${f}` : `the ${noun}`,
      look: lookWords(c, false, viewer),
      voice: voiceWords(noun, c.age),
      names: c.name
        .split(/[\s-]+/)
        .map((w) => w.replace(/[^\p{L}'’]/gu, ""))
        .filter((w) => w.length >= 3 && !NAME_SKIP.has(w.toLowerCase()))
        .map(cap),
    };
  };
  const pair: [ReelPerson, ReelPerson] = [one(a, b), one(b, a)];
  if (pair[0].tag === pair[1].tag) {
    pair[0].tag = `the first ${pair[0].noun}`;
    pair[1].tag = `the second ${pair[1].noun}`;
  }
  return pair;
}

/** Their names in anything a picture or video model reads become how they look ("Dex's hands" → "the man's hands"). */
export function withoutNames(text: string, cast: readonly ReelPerson[]): string {
  return cast.reduce((t, p) => p.names.reduce((u, w) => u.replace(new RegExp(`\\b${escapeRe(w)}\\b`, "g"), p.tag), t), text);
}

const POSSESSIVE = { woman: "her", man: "his", person: "their" } as const;
/** A place for a picture: "Lexi's bedroom" (or the stored "Lexis bedroom") is "her bedroom". */
export function placeWords(place: string, cast: readonly ReelPerson[]): string {
  let out = place.replace(/’/g, "'");
  // As written, capitalised: a Rose's name never touches "the rose garden".
  for (const p of cast) for (const w of p.names) out = out.replace(new RegExp(`\\b${escapeRe(w)}(?:'s|s)?\\b`, "g"), POSSESSIVE[p.noun]);
  return out.trim();
}

/** Where the night stood: the scene's (or a saved night's) place and set, the stops it made, its date, and its stage. */
export type ReelWhere = { place: string | null; set: string | null; history: readonly PlaceStop[]; date: string | null; stage: number };

/**
 * What a reel films: one chapter (the running scene's, or one saved chapter), or the whole night, every chapter since
 * it began (lib/adult/nights.ts: the saved chapters filed one after another since the last Start over, then the scene's
 * own). David, 2026-10-23: a video made on chapter 2's eight lines showed nothing of chapter 1, the night's main events.
 */
export type ReelScope = "chapter" | "night";
export const REEL_SCOPES = ["chapter", "night"] as const;

/** One chapter a reel filmed: its number, the saved night it's filed as (null: the running scene's), and its line count. */
export type ReelChapter = NightChapter;

/**
 * The lines a reel films and where each was said. `lines` runs across the chapters in order (a line's index is its
 * place in all of them); `places` and `stages` are each line's own, from its own chapter; `chapterOf` is each line's
 * index in `chapters`. `where` is stitched across them: where the night began, where it is now, every stop between.
 */
export type ReelNight = {
  lines: SceneLine[];
  where: ReelWhere;
  scope: ReelScope;
  chapters: ReelChapter[];
  places: (string | null)[];
  stages: number[];
  chapterOf: number[];
};

type NightPart = {
  id: string | null;
  lines: SceneLine[] | null;
  place: string | null;
  set_place: string | null;
  place_history: PlaceStop[] | null;
  stage: number | null;
  date_setting: string | null;
  chapter: number | null;
  created_at: string | Date;
};
const PART_COLUMNS = "id, lines, place, set_place, place_history, stage, date_setting, chapter, created_at";

/**
 * The night a reel films and where it happened: by default one chapter (the running scene, or one of the pair's saved
 * nights by `nightId`); with scope "night", every chapter of the night that one belongs to (the running scene's: its
 * saved chapters and its own; a saved chapter's: its night's chapters, and the scene's when that night is still
 * running). Read here rather than through openScene, whose lines (the page's copy) leave out `moved_to`, where they
 * went. No lines when the pair has no scene yet; null for a pair outside this person's after dark, or someone else's night.
 */
export async function reelNight(db: Db, ownerId: string, x: string, y: string, nightId?: string | null, scope: ReelScope = "chapter"): Promise<ReelNight | null> {
  const pair = await eligiblePair(db, ownerId, x, y);
  if (!pair) return null;
  const sceneRow = (
    await db.query<NightPart>(
      `select null as id, lines, place, set_place, place_history, stage, null as date_setting, chapter, updated_at as created_at from adult_scenes where owner_id = $1 and character_a = $2 and character_b = $3`,
      [ownerId, ...pair],
    )
  ).rows[0];
  let parts: NightPart[];
  if (scope === "chapter") {
    if (nightId) {
      const row = (await db.query<NightPart>(`select ${PART_COLUMNS} from adult_nights where id = $1 and owner_id = $2 and character_a = $3 and character_b = $4`, [nightId, ownerId, ...pair])).rows[0];
      if (!row) return null;
      parts = [row];
    } else parts = sceneRow ? [sceneRow] : [];
  } else {
    const saved = (await db.query<NightPart & { id: string }>(`select ${PART_COLUMNS} from adult_nights where owner_id = $1 and character_a = $2 and character_b = $3 order by created_at, chapter nulls first, id`, [ownerId, ...pair])).rows;
    const groups = groupNights(saved, sceneRow ? { chapter: sceneRow.chapter ?? 1 } : null);
    const scenePart = sceneRow?.lines?.length ? [sceneRow] : [];
    if (nightId) {
      const g = groups.find((n) => n.rows.some((r) => r.id === nightId));
      if (!g) return null;
      parts = [...g.rows, ...(!g.complete && g === groups.at(-1) ? scenePart : [])];
    } else {
      const latest = groups.at(-1);
      parts = [...(latest && !latest.complete ? latest.rows : []), ...scenePart];
      if (!parts.length && sceneRow) parts = [sceneRow];
    }
  }
  return stitchNight(parts, scope);
}

/** The chapters as one night: their lines in order, each with its own chapter's places and stages; `where` across them. */
function stitchNight(parts: readonly NightPart[], asked: ReelScope): ReelNight {
  const out: ReelNight = { lines: [], where: { place: null, set: null, history: [], date: null, stage: 0 }, scope: "chapter", chapters: [], places: [], stages: [], chapterOf: [] };
  for (const [k, p] of parts.entries()) {
    const lines = (p.lines ?? []).map((l) => ({ ...l, text: dropForeignActions(l.text) }));
    const where: ReelWhere = { place: p.place ?? null, set: p.set_place ?? null, history: p.place_history ?? [], date: p.date_setting ?? null, stage: p.stage ?? 0 };
    out.lines.push(...lines);
    out.places.push(...placesOf(lines, where));
    out.stages.push(...lines.map((l) => l.stage ?? where.stage));
    out.chapterOf.push(...lines.map(() => k));
    out.chapters.push({ chapter: p.chapter ?? null, night_id: p.id ?? null, lines: lines.length });
    // Where it is now is the latest chapter's; the place history carries on across a night's chapters (Start over
    // clears it), so the latest chapter's copy holds every stop since the night began.
    out.where = { ...where, history: where.history.length >= out.where.history.length ? where.history : out.where.history, date: out.where.date ?? where.date };
  }
  out.scope = asked === "night" && out.chapters.length > 1 ? "night" : "chapter";
  return out;
}

/**
 * Where each line was said: where the night began, then wherever a line agreed to go (`moved_to`; that line itself is
 * still where they were). The night began at the place history's stop before its moves, else where they are now.
 */
export function placesOf(lines: readonly SceneLine[], where: ReelWhere): (string | null)[] {
  const moves = lines.filter((l) => l.moved_to).length;
  const before = moves ? where.history[where.history.length - 1 - moves] : undefined;
  let here = (moves ? (before?.set ?? before?.place ?? where.date) : (where.set ?? where.place ?? where.date)) ?? null;
  return lines.map((l) => {
    const at = here;
    if (l.moved_to) here = l.moved_to;
    return at;
  });
}

/** A shot as the director writes it: the line, a still of the two of them at it, and what they do next. */
export type ShotPick = { line: number; frame: string; motion: string };

/** The two of them as far as the night had gone, for a still the director didn't write. */
const STILLS = [
  "standing close together, facing each other, both dressed, talking and smiling",
  "close together, one's hand on the other's waist, both dressed, looking into each other's eyes",
  "kissing, their arms around each other, both dressed",
  "kissing and undressing each other, clothes half off",
  "having sex, their bodies pressed together, both nude",
] as const;
export const stillOf = (cast: readonly ReelPerson[], stage: number) =>
  `${cap(cast[0].tag)} and ${cast[1].tag}, ${STILLS[Math.max(0, Math.min(STILLS.length - 1, stage))]}. Medium shot, both faces visible.`;
export const motionOf = (cast: readonly ReelPerson[], speaker: ReelPerson, action: string) =>
  action ? `${cap(speaker.tag)} ${withoutNames(action[0].toLowerCase() + action.slice(1), cast).replace(/[.!]+$/, "")}, and the other answers it.` : "The two of them stay close, moving together.";

/**
 * The most lines the director is shown. A chapter is filed at about 120 (lib/adult/scenes.ts CHAPTER_LINES), so one
 * chapter is always shown whole; a longer night is cut to this many first, fairly across its chapters.
 */
export const DIRECTOR_MAX_LINES = 160;

/** `k` of `items` spread across them, more of them past the middle where a night peaks (fewer when two land on one). */
function spread<T>(items: readonly T[], k: number): T[] {
  const out: T[] = [];
  for (let j = 0; j < k; j++) {
    const t = k === 1 ? 0.6 : Math.pow(j / (k - 1), 0.8);
    const pick = items[Math.min(items.length - 1, Math.round(t * (items.length - 1)))];
    if (pick !== undefined && !out.includes(pick)) out.push(pick);
  }
  return out;
}

/** Exactly `k` of `items` (all of them when there are no more), spread as `spread` does and kept in order. */
function spreadFull<T>(items: readonly T[], k: number): T[] {
  if (k >= items.length) return [...items];
  const out = spread(items, k);
  // Two landed on one: the rest from the end back, past the middle where it peaks.
  for (let i = items.length - 1; out.length < k && i >= 0; i--) if (!out.includes(items[i])) out.push(items[i]);
  return items.filter((x) => out.includes(x));
}

/**
 * `total` shared out across groups of these sizes, as near their share as it goes and never more than a group has:
 * every group with something in it gets at least one when there's enough to go round (otherwise they go to groups
 * spread across the night, past the middle).
 */
export function shareOut(sizes: readonly number[], total: number): number[] {
  const live = sizes.map((n, k) => ({ n, k })).filter((g) => g.n > 0);
  const out = sizes.map(() => 0);
  const sum = live.reduce((t, g) => t + g.n, 0);
  if (!sum || total <= 0) return out;
  if (total >= sum) return [...sizes];
  if (total < live.length) {
    for (const g of spread(live, total)) out[g.k] = 1;
    return out;
  }
  for (const g of live) out[g.k] = 1;
  const rest = total - live.length;
  let left = rest;
  // The rest by share, then the largest remainders.
  const share = live.map((g) => ({ ...g, share: ((g.n - 1) * rest) / (sum - live.length) }));
  for (const g of share) {
    const whole = Math.min(g.n - 1, Math.floor(g.share));
    out[g.k] += whole;
    left -= whole;
  }
  for (const g of [...share].sort((p, q) => q.share - Math.floor(q.share) - (p.share - Math.floor(p.share)))) {
    if (left > 0 && out[g.k] < g.n) {
      out[g.k]++;
      left--;
    }
  }
  for (const g of share) while (left > 0 && out[g.k] < g.n) (out[g.k]++, left--);
  return out;
}

/** `n` of these, fairly across their chapters (`chapterOf`), spread within each one: no chapter dropped for being early. */
export function acrossChapters<T extends { i: number }>(items: readonly T[], n: number, chapterOf: readonly number[]): T[] {
  const ids = [...new Set(items.map((x) => chapterOf[x.i] ?? 0))].sort((p, q) => p - q);
  const by = ids.map((c) => items.filter((x) => (chapterOf[x.i] ?? 0) === c));
  const quota = shareOut(by.map((g) => g.length), n);
  return by.flatMap((g, k) => (quota[k] ? spreadFull(g, quota[k]) : []));
}

/** What the director needs to know of a night of several chapters: each line's chapter, and the chapters' numbers. */
export type DirectorNight = { chapterOf: readonly number[]; chapters: readonly Pick<ReelChapter, "chapter">[] };

/**
 * The shots a reel is made of: the director's pick of the strongest moments across the night, in order, each written
 * as a still of the two of them and what they do next. Falls back to lines spread across the night, weighted past the
 * middle, with a still from how far the night had gone and the line's own action, when the model's pick can't be read.
 * With `night` (a reel of a whole night of chapters), every line is numbered across the chapters and labelled by its
 * own; a night too long to show whole is cut fairly across its chapters first, and the fallback spreads per chapter.
 */
export async function pickShots(
  db: Db,
  lines: SceneLine[],
  n: number,
  cast: [ReelPerson, ReelPerson],
  places: readonly (string | null)[],
  stages: readonly number[],
  night?: DirectorNight | null,
): Promise<ShotPick[]> {
  const all = lines.map((l, i) => ({ i, ...spoken(l.text) })).filter((l) => l.speech.split(" ").length >= 3);
  if (!all.length) return [];
  const want = Math.min(n, all.length);
  const several = Boolean(night && night.chapters.length > 1);
  const chapterOf = night?.chapterOf ?? lines.map(() => 0);
  const chapterName = (i: number) => {
    const c = night?.chapters[chapterOf[i] ?? 0];
    return typeof c?.chapter === "number" ? `chapter ${c.chapter}` : `part ${(chapterOf[i] ?? 0) + 1}`;
  };
  // Too long to show whole: the same spread, per chapter, so every chapter is still there to pick from.
  const usable = all.length > DIRECTOR_MAX_LINES ? acrossChapters(all, DIRECTOR_MAX_LINES, chapterOf) : all;
  const speaker = (i: number) => cast[lines[i].who === "a" ? 0 : 1];
  try {
    const row = (l: (typeof usable)[number]) =>
      [String(l.i), ...(several ? [chapterName(l.i)] : []), speaker(l.i).tag, places[l.i] ? placeWords(places[l.i]!, cast) : "?", STAGES[stages[l.i]] ?? "?", `${l.action ? `(${l.action}) ` : ""}${l.speech}`].join(" | ");
    const list = usable.map(row).join("\n");
    const spans = several
      ? night!.chapters
          .map((_, k) => {
            const own = all.filter((l) => chapterOf[l.i] === k);
            return own.length ? `${cap(chapterName(own[0].i))} is lines ${own[0].i}–${own[own.length - 1].i}` : "";
          })
          .filter(Boolean)
      : [];
    const each = want >= 4 ? ` (at least ${Math.floor(want / 3)} each)` : "";
    const raw = await (await adultModel(db)).complete(
      [
        { role: "system", content: "You direct a short film cut from a private night between two consenting adults. You pick lines from its script; you never write new dialogue." },
        {
          role: "user",
          content: [
            "The two of them, named only like this, never by name:",
            ...cast.map((p) => `- ${p.tag}: a ${p.noun}${p.look ? `, ${p.look}` : ""}`),
            "",
            ...(several
              ? [
                  `The whole night, in ${night!.chapters.length} chapters one after another, its lines numbered straight through: ${spans.join("; ")}.` +
                    (usable.length < all.length ? " It's long, so only some of each chapter's lines are here." : ""),
                  `One line per row as "index | chapter | who says it | where | how far it's gone | (what they do) what they say":`,
                ]
              : [`The night, one line per row as "index | who says it | where | how far it's gone | (what they do) what they say":`]),
            list,
            "",
            several
              ? `Pick the ${want} lines that make the best short film of the whole night, in order: its strongest moments across all of its chapters, how it opens, how it builds, its peak (the most intense moment, wherever in the night it comes) and how it closes. ` +
                `Take them from across the night${want >= night!.chapters.length ? ", at least one from each chapter" : ""}, not only the latest chapter. Prefer short, vivid spoken lines, and give both of them lines${each}.`
              : `Pick the ${want} lines that make the best short film of this night, in order: how it starts, how it builds, its most intense moment (usually in the middle or later, not at either end) and how it lands. ` +
                `Prefer short, vivid spoken lines, and give both of them lines${each}.`,
            "Every shot shows the two of them together in one frame, doing what the script has them doing at that line: its action, and the lines just before it. For each shot write:",
            `- "frame": one photograph of that moment, in one or two sentences: where they are in the place, where each of them is (one on the left or in front, the other on the right or behind) and how their bodies are posed toward each other, what's touching, what they're wearing or not by then, and the framing (wide, medium or close, varied from shot to shot; lying down, a medium shot from the side with both faces toward the camera, never from above). Both faces visible, two people only.`,
            `- "motion": one sentence: what each of them does over the next few seconds, carrying on from that photograph, as the line is said.`,
            "Concrete and physical, like a shot list: no feelings, no dialogue, no names.",
            'Reply with a JSON object: {"shots": [{"line": 12, "frame": "...", "motion": "..."}]}',
          ].join("\n"),
        },
      ],
      { temperature: 0.4, maxTokens: 300 + 220 * want },
    );
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { shots?: { line?: unknown; frame?: unknown; motion?: unknown }[] };
    const ok = new Set(usable.map((l) => l.i));
    const said = (v: unknown, max: number) => (typeof v === "string" ? withoutNames(v.trim(), cast).slice(0, max) : "");
    const shots = (parsed.shots ?? [])
      .map((s) => ({ line: Number(s.line), frame: said(s.frame, 600), motion: said(s.motion, 300) }))
      .filter((s, k, all) => ok.has(s.line) && all.findIndex((x) => x.line === s.line) === k)
      .map((s) => ({
        line: s.line,
        frame: s.frame || stillOf(cast, stages[s.line] ?? 0),
        motion: s.motion || motionOf(cast, speaker(s.line), spoken(lines[s.line].text).action),
      }))
      .sort((x, y) => x.line - y.line)
      .slice(0, want);
    if (shots.length >= Math.min(3, want)) return shots;
  } catch {
    /* fall through to the spread */
  }
  // Spread across the night, more of them past the middle where it peaks; a night of chapters, within each of them.
  const picks = several ? acrossChapters(all, want, chapterOf) : spread(all, want);
  return picks.map((pick) => ({ line: pick.i, frame: stillOf(cast, stages[pick.i] ?? 0), motion: motionOf(cast, speaker(pick.i), pick.action) }));
}

/**
 * A keyframe's prompt: the two baselines (Pictures 1 and 2) made into one photograph of the director's still, in the
 * place (the drawn set as Picture 3 when there is one), each kept as they are but dressed (or not) for the night's
 * `stage` at that line. Within the edit model's prompt limit.
 */
export function keyframePrompt(
  cast: readonly [ReelPerson, ReelPerson],
  frame: string,
  place: string | null,
  stage: number,
  withSet: boolean,
  opts: { explicit?: boolean; clothes?: string; light?: string } = {},
): string {
  const [a, b] = cast;
  const head = `Make one photograph of the ${a.noun} from Picture 1 and the ${b.noun} from Picture 2 together${withSet ? ", in the place from Picture 3" : ""}.`;
  const where = place ? `The place: ${place}.` : "";
  // A chosen light (the Studio's shoots together, lib/adult/studio.ts) instead of the set's own.
  const light = opts.light ? `Light: ${opts.light}.` : "";
  // What they wear: by how far the night had gone, or a picture's chosen outfit (lib/adult/pictures-menu.ts).
  const keep =
    `Keep each of them as in their own picture, the same face, hair, skin tone and body, but not their clothes: ${opts.clothes ?? clothesAt(stage)}.` +
    `${withSet ? (opts.light ? " Keep the place and its furniture from Picture 3." : " Keep the place, its furniture and its light from Picture 3.") : ""} Two people only, both faces visible.`;
  return fitPrompt([head, whoIsWho(cast)], frame, [where, light, keep, tailAt(stage, opts.explicit ?? true)]);
}

/** Which of them is which picture, when "the woman" and "the man" don't already say it. */
const whoIsWho = ([a, b]: readonly [ReelPerson, ReelPerson]) =>
  a.tag === `the ${a.noun}` && b.tag === `the ${b.noun}` ? "" : `${cap(a.tag)} is the one from Picture 1; ${b.tag} is the one from Picture 2.`;
/**
 * The end of a keyframe's prompt: explicit from undressing on, unless the pair's intensity is below explicit
 * (lib/adult/limits.ts), when it stays sensual and never graphic.
 */
const tailAt = (stage: number, explicit: boolean) =>
  stage < UNDRESSED_FROM ? "Photorealistic. Both are adults." : explicit ? "Explicit, uncensored, photorealistic. Both are adults." : "Sensual and tasteful, nothing graphic, photorealistic. Both are adults.";
/** A keyframe's prompt within the edit model's limit: the middle (the still) is what gets cut short. */
function fitPrompt(before: string[], middle: string, after: string[]): string {
  const room = KEYFRAME_PROMPT_MAX - [...before, ...after].filter(Boolean).join(" ").length - 2;
  const still = middle.length <= room ? middle : middle.slice(0, Math.max(0, room)).replace(/\s+\S*$/, "");
  return [...before, still, ...after].filter(Boolean).join(" ");
}

/**
 * The keyframe for a shot that keeps going from the one before (lib/adult/clips.ts Keep going). There's no ffmpeg on the
 * server any more (#688), so not its last frame: the two baselines (Pictures 1 and 2, the faces) and the shot before's
 * keyframe (Picture 3: the place, the light, the framing, how they're posed and dressed), moved on by what they did in
 * that shot.
 */
export function continuePrompt(cast: readonly [ReelPerson, ReelPerson], after: string, stage: number, opts: { explicit?: boolean } = {}): string {
  const [a, b] = cast;
  const head =
    `Make one photograph of the ${a.noun} from Picture 1 and the ${b.noun} from Picture 2 together, a few seconds after the moment in Picture 3. ` +
    "Picture 3 is the shot just before this one: keep its place, its light, its camera angle and framing, and what each of them is wearing or not, and carry how they're posed on from it, after this:";
  const keep = "Keep each of them as in their own picture, the same face, hair, skin tone and body. Two people only, both faces visible.";
  return fitPrompt([head], after, [whoIsWho(cast), keep, tailAt(stage, opts.explicit ?? true)]);
}

/** A shot's prompt: what they do, both kept as they are, one continuous shot, and who says the line (or that nobody does). */
export function shotPrompt(cast: readonly [ReelPerson, ReelPerson], s: Pick<ReelShot, "who" | "text" | "motion">, audioIn: boolean): string {
  const speaker = cast[s.who === "a" ? 0 : 1];
  const base =
    `${s.motion || "The two of them stay close, moving together."} Two people only: ${cast[0].tag} and ${cast[1].tag}, exactly as in the picture, ` +
    "the same faces and bodies in the same place. One continuous shot, the camera steady: no cuts, nobody else comes in. Realistic motion.";
  // A clip with no line in it (lib/adult/clips.ts, an act from the menu): nobody speaks.
  if (!s.text.trim()) return `${base} Neither of them speaks: only their breathing and the sounds of the room.`;
  return audioIn ? `${base} ${cap(speaker.tag)} is the one speaking, lips moving with the words.` : `${base} ${cap(speaker.tag)}, in ${speaker.voice}, says: "${s.text}"`;
}

/** Kokoro's voices on Replicate (jaaari/kokoro-82m's list, 2026-10-22): all of ours but af_heart, which it lacks. */
const REPLICATE_VOICES = new Set([
  "af_alloy", "af_aoede", "af_bella", "af_jessica", "af_kore", "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky",
  "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx", "am_puck",
]);
/** A character's voice as Replicate's Kokoro has it: af_heart becomes af_alloy, a voice no one else of ours has. */
export function replicateVoice(voice: string): string {
  if (REPLICATE_VOICES.has(voice)) return voice;
  return voice === "af_heart" ? "af_alloy" : voice.startsWith("am_") ? "am_adam" : "af_bella";
}

/** Wan 2.2 on Replicate makes 81 to 121 frames (four to a step, plus one) at 16 a second: about 5 to 7.5 seconds. */
const WAN_FPS = 16;
const WAN_FRAMES = [81, 121] as const;
/**
 * How fast Kokoro talks, about 3 words a second (the live run of 2026-10-23: an 8-word line came back as 2.7 s of WAV,
 * its pauses included), and a breath either side of the line.
 */
const WORDS_PER_SECOND = 3;
const BREATH_S = 0.6;
/**
 * How long a Replicate shot runs, and how fast its line is said: long enough for the line (at least 5 s), and a line
 * too long for the longest shot said a little faster (up to 1.25×) rather than running past its end.
 */
export function replicateTiming(text: string): { frames: number; speed: number } {
  const seconds = text.split(/\s+/).filter(Boolean).length / WORDS_PER_SECOND + BREATH_S;
  const longest = WAN_FRAMES[1] / WAN_FPS - 0.3;
  const speed = seconds > longest ? Math.min(1.25, seconds / longest) : 1;
  const want = Math.ceil((seconds / speed) * WAN_FPS);
  return { frames: Math.min(WAN_FRAMES[1], Math.max(WAN_FRAMES[0], 4 * Math.ceil((want - 1) / 4) + 1)), speed: Math.round(speed * 100) / 100 };
}

/**
 * A keyframe's inputs on Replicate's Qwen-Image-Edit: the same prompt and pictures as on Venice (Pictures 1 and 2,
 * the set as 3), and its safety checker off: what comes back goes through Hive before anything is kept.
 */
export function replicateKeyframeInput(prompt: string, images: string[]): Record<string, unknown> {
  return { prompt, image: images, aspect_ratio: "3:4", output_format: "png", go_fast: true, disable_safety_checker: true };
}

/**
 * A shot's inputs on Replicate's Wan 2.2: its keyframe, the motion with whoever speaks moving their lips (the line
 * itself is said beside it), long enough for the line, 720p like Venice's, and the safety checker off (the shot passes
 * Hive before it's kept). A LoRA: one URL for both of Wan's transformers, or two, high noise then low.
 */
export function replicateShotInput(cast: readonly [ReelPerson, ReelPerson], s: Pick<ReelShot, "who" | "text" | "motion">, image: string, lora: string | null): Record<string, unknown> {
  const [high, low] = (lora ?? "").split(/[\s,]+/).filter(Boolean);
  return {
    prompt: shotPrompt(cast, s, true),
    image,
    num_frames: replicateTiming(s.text).frames,
    resolution: "720p",
    frames_per_second: WAN_FPS,
    go_fast: true,
    disable_safety_checker: true,
    ...(high ? { lora_weights_transformer: high, lora_weights_transformer_2: low ?? high } : {}),
  };
}

/** A shot's line in its character's stock voice, on Replicate's Kokoro. */
export const replicateVoiceInput = (s: Pick<ReelShot, "text" | "voice">): Record<string, unknown> => ({
  text: s.text,
  voice: s.voice ?? "af_bella",
  speed: replicateTiming(s.text).speed,
});

/** Replicate takes a data: URI up to 256 KB; a drawn set bigger than that goes by its public link (/api/sets) instead. */
const DATA_URI_MAX = 256 * 1024;
export function replicateSetImage(dataUri: string, place: string, baseUrl: string): string {
  const bytes = Math.floor(((dataUri.length - dataUri.indexOf(",") - 1) * 3) / 4);
  // The route normalizes the name it's given again, so the link only names this set when that changes nothing.
  const key = normalizeScene(place);
  return bytes <= DATA_URI_MAX || normalizeScene(key) !== key ? dataUri : `${baseUrl.replace(/\/$/, "")}${setPath(place)}`;
}

async function venice(key: string, path: string, body: unknown): Promise<Response> {
  return doFetch(`${VENICE}${path}`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) });
}

/** A line in a stock voice from Venice's Kokoro (MP3): a Replicate shot's voice when Replicate is limited. */
async function veniceSpeech(key: string, text: string, voice: string): Promise<ReplicateFile> {
  const res = await venice(key, "/audio/speech", { model: "tts-kokoro", input: text, voice, response_format: "mp3" });
  if (!res.ok) throw await providerError(res, (status, body) => `Venice ${status}: ${body.slice(0, 120)}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_VOICE_BYTES) throw new Error("Venice returned no usable audio");
  return { bytes, mime: "audio/mpeg" };
}

/** Each one's newest baseline that passed the check: the two faces every keyframe keeps. */
/**
 * The two faces a keyframe keeps: for a viewer, each one's face reference (lib/adult/steering.ts faceReferenceId: the face
 * they picked, else their best-rated baseline, else the admins' newest); with none, each one's newest baseline.
 */
export async function baselines(db: Db, a: string, b: string, viewerId: string | null = null, opts: { nude?: boolean } = {}): Promise<[string, string] | null> {
  if (viewerId) {
    const [pa, pb] = await Promise.all([faceReferenceId(db, viewerId, a, opts), faceReferenceId(db, viewerId, b, opts)]);
    return pa && pb ? [pa, pb] : null;
  }
  const { rows } = await db.query<{ id: string; character_id: string }>(
    `select distinct on (character_id) id, character_id from adult_images
      where status = 'ready' and kind = 'baseline' and character_b is null and character_id in ($1, $2)${opts.nude ? ` and ${nudeSql("adult_images")}` : ""}
      order by character_id, created_at desc`,
    [a, b],
  );
  const of = (c: string) => rows.find((r) => r.character_id === c)?.id;
  const [pa, pb] = [of(a), of(b)];
  return pa && pb ? [pa, pb] : null;
}

/**
 * The two faces an undressed moment (the night at sex: NUDE_FROM) starts from: each one's nude baseline (lib/adult/attire.ts),
 * made first for one who wears something and has none yet, since an edit keeps whatever the pictures it starts from wear.
 * Null when one can't be had: the caller keeps the dressed ones, as before. Hive out stops it like any picture.
 */
export async function nudeBaselines(db: Db, ownerId: string, a: Character, b: Character): Promise<[string, string] | null> {
  try {
    for (const c of [a, b]) await ensureNudeBaseline(db, ownerId, c);
  } catch (err) {
    if (err instanceof HivePausedError) throw err;
    console.log(JSON.stringify({ event: "after_dark_nude_baseline_failed", detail: err instanceof Error ? err.message.slice(0, 200) : "error" }));
  }
  return baselines(db, a.id, b.id, ownerId, { nude: true });
}

/** The drawn sets for the places the shots happen in (lib/sets.ts), as data URIs, by place; null where none is ready. */
export async function setPictures(db: Db, places: readonly (string | null)[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (const place of new Set(places.filter((p): p is string => Boolean(p)))) {
    const key = normalizeScene(place);
    const set = key ? await getSet(db, key).catch(() => null) : null;
    out.set(place, set ? `data:${set.mime};base64,${Buffer.from(set.data).toString("base64")}` : null);
  }
  return out;
}

/**
 * One keyframe from Venice's multi-image edit: it answers with the picture itself. `model` is another edit model (the
 * Studio's picker, lib/adult/studio.ts); the keyframe model by default.
 */
export async function drawKeyframe(key: string, prompt: string, images: string[], model: string = KEYFRAME_MODEL): Promise<{ bytes: Buffer; mime: string }> {
  const res = await venice(key, "/image/multi-edit", { modelId: model, prompt, images, safe_mode: false, aspect_ratio: "3:4", output_format: "png" });
  if (!res.ok) throw await providerError(res, (status, text) => `Venice ${status}: ${text.slice(0, 160)}`);
  if (res.headers.get("x-venice-is-content-violation") === "true") throw new Error("Venice flagged the keyframe as against its terms");
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (type.startsWith("image/")) return { bytes: Buffer.from(await res.arrayBuffer()), mime: type };
  const b64 = ((await res.json().catch(() => ({}))) as { images?: string[] }).images?.[0];
  if (!b64) throw new Error("Venice returned no keyframe");
  return { bytes: Buffer.from(b64.replace(/^data:[^,]*,/, ""), "base64"), mime: "image/png" };
}

/** A picture's video on Venice from its signed link (the Studio's Animate, lib/adult/studio.ts): queued, one shot. */
export async function queueVideo(key: string, v: { model: string; seconds: 5 | 10; image_url: string; prompt: string; negative: string }): Promise<string> {
  const body: Record<string, unknown> = { model: v.model, duration: `${v.seconds}s`, resolution: "720p", prompt: v.prompt, negative_prompt: v.negative, image_url: v.image_url };
  if (!AUDIO_IN.test(v.model)) body.audio = true;
  if (/^wan-3/.test(v.model)) body.aspect_ratio = "adaptive";
  const res = await venice(key, "/video/queue", body);
  if (!res.ok) throw await providerError(res, (status, text) => `Venice ${status}: ${text.slice(0, 160)}`);
  const q = (await res.json()) as { queue_id?: string };
  if (!q.queue_id) throw new Error("Venice returned no queue id");
  return q.queue_id;
}

/** Where a queued video is: still being made, done (its bytes), or failed. Venice keeps it until releaseVideo. */
export async function retrieveVideo(key: string, model: string, queueId: string): Promise<{ state: "making" } | { state: "ready"; bytes: Buffer } | { state: "failed"; reason: string }> {
  const res = await venice(key, "/video/retrieve", { model, queue_id: queueId });
  if (!res.ok) return { state: "failed", reason: `Venice ${res.status}` };
  if (!(res.headers.get("content-type") ?? "").includes("video")) return { state: "making" };
  return { state: "ready", bytes: Buffer.from(await res.arrayBuffer()) };
}

/** Venice's copy of a video, deleted once ours is kept (or it was refused). */
export async function releaseVideo(key: string, model: string, queueId: string): Promise<void> {
  await venice(key, "/video/retrieve", { model, queue_id: queueId, delete_media_on_completion: true }).catch(() => {});
}

/** A picture made larger by Venice's upscaler (the Studio's Upscale, about $0.02): a PNG comes back. */
export async function veniceUpscale(key: string, image: Buffer, scale: 2 | 4 = 2): Promise<{ bytes: Buffer; mime: string }> {
  const res = await venice(key, "/image/upscale", { image: image.toString("base64"), scale });
  if (!res.ok) throw await providerError(res, (status, text) => `Venice ${status}: ${text.slice(0, 160)}`);
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!type.startsWith("image/")) throw new Error("Venice returned no picture");
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_PICTURE_BYTES) throw new Error("Venice returned no usable picture");
  return { bytes, mime: type };
}

/** Hive gave no verdict (busy, down, over its daily limit): a reason to ask again, not a refusal. */
const couldntRun = (v: CheckResult): boolean => !v.ok && v.reason.startsWith("the check couldn't run") && !v.reason.includes("no Hive key");
/** Until when Hive's daily-limit pause runs, when it's why a check didn't run (lib/adult/hive-limit.ts); else null. */
const hiveOut = (v: CheckResult): string | null => (!v.ok && v.paused ? v.paused : null);
/** When a shot Hive couldn't check is asked again: after CHECK_RETRY_MS, or once Hive's daily-limit pause is over. */
const askAgainAt = (v: CheckResult, now: number): string => {
  const until = hiveOut(v);
  return new Date(Math.max(now + CHECK_RETRY_MS, until ? new Date(until).getTime() : 0)).toISOString();
};
/** What a shot Hive couldn't check says: why it didn't run, or until when Hive is out. */
const waitReason = (v: CheckResult): string => {
  const until = hiveOut(v);
  return (until ? hivePausedReason(until) : v.ok ? "" : v.reason).slice(0, 200);
};
/** A keyframe, shot or clip thrown away because Hive was out of its daily allowance: logged, like a refusal. */
const logPaused = (db: Db, ownerId: string, what: string) =>
  db.query(`insert into adult_rejections (id, owner_id, kind, reason) values ($1, $2, 'reel', $3)`, [crypto.randomUUID(), ownerId, what.slice(0, 300)]).catch(() => {});

/** The biggest file a keyframe, a shot or a line's voice may be. */
const MAX_PICTURE_BYTES = 40 * 1024 * 1024;
const MAX_SHOT_BYTES = 100 * 1024 * 1024;
const MAX_VOICE_BYTES = 20 * 1024 * 1024;

/** A reel made on Replicate: its token, the keyframe and video models, and the video LoRA. */
export type ReplicateMedia = { token: string; keyframe: string; video: string; videoLora: string | null };

export type ShotContext = {
  pair: [string, string];
  cast: [ReelPerson, ReelPerson];
  places: readonly (string | null)[];
  stages: readonly number[];
  bases: [string, string];
  /** Venice's key ("" when there's none). */
  venice: string;
  hive: string | null;
  model: string;
  baseUrl: string;
  /** Replicate's token and models, when there's a token; null otherwise. */
  replicate: ReplicateMedia | null;
  /**
   * Where the shots are made (`media_provider`). Unset: Replicate when `replicate` is given, else Venice. A shot goes to
   * the other one when this one is limited (lib/adult/fallback.ts) and the other is given here.
   */
  provider?: MediaProvider;
  /**
   * A clip's own keyframe (lib/adult/clips.ts): its prompt, and the third picture, a keyframe id to carry on from (Keep
   * going) or the place's set. Unset: a night's reel, the director's still in the line's place.
   */
  keyframeFor?: (s: ReelShot, set: string | null, place: string | null) => { prompt: string; continueFrom: string | null; withSet: boolean };
  /** What a shot steers away from on top of SHOT_NEGATIVE: the viewer's video ratings (lib/adult/steering.ts; startShots fills it). */
  avoid?: string;
  /** The faces a shot of the night at sex starts from (nudeBaselines); unset or null, `bases` for every shot. */
  nudeBases?: [string, string] | null;
};

/** One keyframe from Replicate's edit model, its bytes downloaded at once. */
export async function drawReplicateKeyframe(r: ReplicateMedia, prompt: string, images: string[]): Promise<ReplicateFile> {
  const file = await runModel(r.token, r.keyframe, replicateKeyframeInput(prompt, images), { maxBytes: MAX_PICTURE_BYTES, timeoutMs: 120_000 });
  if (!file.mime.startsWith("image/")) throw new Error("Replicate returned no keyframe");
  return file;
}

/** Queues one shot's video on Replicate from its keyframe: the prediction's id is the shot's queue id. */
async function queueReplicateShot(ctx: Pick<ShotContext, "cast" | "baseUrl" | "replicate">, s: ReelShot): Promise<void> {
  const r = ctx.replicate!;
  s.voice = replicateVoice(voiceFor(ctx.cast[s.who === "a" ? 0 : 1]));
  // Stopped if it's still going in half an hour: nobody will collect it by then.
  const p = await createPrediction(r.token, r.video, replicateShotInput(ctx.cast, s, signedMediaUrl(s.media_id!, ctx.baseUrl), r.videoLora), { cancelAfter: "30m" });
  s.queue_id = p.id;
  s.model = r.video;
}

/**
 * Starts the shots: every keyframe is drawn at once (on Venice, or Replicate), then each is checked (one at a time:
 * Hive rate-limits a burst; a check that couldn't run is asked once more after a pause) and kept, and its video
 * queued. A keyframe gets the age question only (lib/adult/check.ts "keyframe"): it starts its shot and nothing else
 * until that shot has passed moderation. A shot whose keyframe can't be drawn or doesn't pass is dropped, and its share
 * of the tokens comes back when the reel settles. A shot starting from a beat picture (`from_beat`) has nothing drawn
 * or checked here: its video is queued from that picture.
 */
export async function startShots(db: Db, ownerId: string, shots: ReelShot[], ctxIn: ShotContext): Promise<void> {
  // What this viewer's ratings of the pair's videos said was off (lib/adult/steering.ts), into each shot's negative prompt.
  const steer = await steeringFor(db, ownerId, ctxIn.pair).catch(() => NO_STEERING);
  const ctx: ShotContext = { ...ctxIn, avoid: ctxIn.avoid ?? (steer.video.join(", ") || undefined) };
  const configured: MediaProvider = ctx.provider ?? (ctx.replicate ? "replicate" : "venice");
  const providers = { configured, available: (p: MediaProvider) => (p === "replicate" ? Boolean(ctx.replicate) : Boolean(ctx.venice)) };
  const sets = await setPictures(db, shots.map((s) => ctx.places[s.line] ?? null));
  // Undressed (the night at sex), a shot starts from their nude baselines: an edit keeps what its pictures wear.
  const facesAt = (stage: number) => (stage >= NUDE_FROM && ctx.nudeBases ? ctx.nudeBases : ctx.bases).map((id) => signedMediaUrl(id, ctx.baseUrl));
  const drawn = await Promise.all(
    shots.map(async (s) => {
      const faces = facesAt(ctx.stages[s.line] ?? 0);
      // A beat picture to start from: nothing to draw, and it passed the full check when it was kept.
      if (s.from_beat && s.media_id) return { reused: true as const };
      const place = ctx.places[s.line] ?? null;
      const drawnSet = place ? (sets.get(place) ?? null) : null;
      const own = ctx.keyframeFor?.(s, drawnSet, place);
      const set = own ? (own.withSet ? drawnSet : null) : drawnSet;
      const prompt = own?.prompt ?? keyframePrompt(ctx.cast, s.frame ?? "", place ? placeWords(place, ctx.cast) : null, ctx.stages[s.line] ?? 0, Boolean(set));
      // Keep going: the shot before's keyframe is the third picture, in the set's place.
      const third = own?.continueFrom ? signedMediaUrl(own.continueFrom, ctx.baseUrl) : null;
      try {
        // A keyframe is one job: drawn on the other provider when this one is limited.
        const made = await runMedia(
          db,
          "keyframe",
          (p) =>
            p === "replicate"
              ? drawReplicateKeyframe(ctx.replicate!, prompt, third ? [...faces, third] : set && place ? [...faces, replicateSetImage(set, place, ctx.baseUrl)] : faces)
              : drawKeyframe(ctx.venice, prompt, third ? [...faces, third] : set ? [...faces, set] : faces),
          providers,
        );
        return { prompt, file: made.value, provider: made.provider, fell_back: made.fell_back };
      } catch (err) {
        Object.assign(s, { status: "failed", reason: err instanceof Error ? err.message.slice(0, 200) : "error" });
        return null;
      }
    }),
  );
  let checked = 0;
  // Once Hive is out of its daily allowance (lib/adult/hive-limit.ts), the rest aren't sent: until when.
  let paused: string | null = null;
  for (const [k, s] of shots.entries()) {
    const d = drawn[k];
    if (!d) continue;
    if (!("reused" in d)) {
      if (paused) {
        // Drawn before the pause began, and can't be checked now: discarded, never stored, its share of tokens back.
        Object.assign(s, { status: "failed", reason: hivePausedReason(paused).slice(0, 200) });
        await logPaused(db, ownerId, `keyframe: ${hivePausedReason(paused)}`);
        continue;
      }
      if (checked++) await pause(CHECK_PAUSE_MS);
      const media = { base64: d.file.bytes.toString("base64"), mime: d.file.mime };
      // The age question alone: this keyframe's moderation comes with its shot's (lib/adult/check.ts "keyframe").
      let verdict = await checkMedia(db, media, "keyframe", { owner: ownerId });
      // Asked once more after a pause when Hive was busy or down; never when it's out for the day.
      if (couldntRun(verdict) && !hiveOut(verdict)) {
        await pause(CHECK_AGAIN_MS);
        verdict = await checkMedia(db, media, "keyframe", { owner: ownerId });
      }
      if (!verdict.ok) {
        // Never stored either way; only a refusal is logged as one, and a keyframe thrown away because Hive was out.
        paused = hiveOut(verdict);
        if (paused) {
          Object.assign(s, { status: "failed", reason: waitReason(verdict) });
          await logPaused(db, ownerId, `keyframe: ${verdict.reason}`);
          continue;
        }
        const busy = couldntRun(verdict);
        Object.assign(s, { status: busy ? "failed" : "discarded", reason: verdict.reason.slice(0, 200) });
        if (!busy) {
          await db.query(`insert into adult_rejections (id, owner_id, kind, reason) values ($1, $2, 'reel', $3)`, [crypto.randomUUID(), ownerId, `keyframe: ${verdict.reason}`.slice(0, 300)]).catch(() => {});
        }
        continue;
      }
      // Kept, out of the gallery (a 'frame'), as the shot's start: shown on its own only once the shot has passed.
      const id = crypto.randomUUID();
      const kept = await keepBytes("after-dark", id, d.file.bytes, d.file.mime);
      await db.query(
        `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, object_key, status, provider, fell_back) values ($1, $2, $3, $4, 'frame', $5, $6, $7, $8, 'ready', $9, $10)`,
        [id, ownerId, ctx.pair[0], ctx.pair[1], d.prompt, d.file.mime, kept.data, kept.object_key, d.provider, d.fell_back],
      );
      s.media_id = id;
      s.frame_id = id;
      s.frame_provider = d.provider;
      if (d.fell_back) s.fell_back = true;
    }
    // Queuing its video is a new job too (nothing is running yet), so it may go to the other provider; once queued, it's
    // collected where it went (`provider`), never switched.
    try {
      const queued = await runMedia(db, "video", (p) => (p === "replicate" ? queueReplicateShot(ctx, s) : queueShot(ctx, s)), providers);
      if (queued.provider === "replicate") s.provider = "replicate";
      else delete s.provider;
      if (queued.fell_back) s.fell_back = true;
    } catch (err) {
      Object.assign(s, { status: "failed", reason: err instanceof Error ? err.message.slice(0, 200) : "error" });
    }
  }
}

/**
 * Who made a reel or clip: the provider its shots' videos were queued on ("mixed" when it was both; null when none got
 * that far), and whether any part of it went to the fallback provider. Kept on the adult_reels row.
 */
export function reelMadeOn(shots: readonly ReelShot[]): { provider: string | null; fell_back: boolean } {
  const on = new Set(shots.filter((s) => s.queue_id).map((s) => (s.provider === "replicate" ? "replicate" : "venice")));
  return { provider: on.size === 1 ? [...on][0] : on.size ? "mixed" : null, fell_back: shots.some((s) => s.fell_back === true) };
}

/** Queues one shot's video from its keyframe. */
async function queueShot(ctx: Pick<ShotContext, "cast" | "venice" | "model" | "baseUrl" | "avoid">, s: ReelShot): Promise<void> {
  const audioIn = AUDIO_IN.test(ctx.model);
  const body: Record<string, unknown> = {
    model: ctx.model,
    duration: s.text.split(" ").length <= WORDS_5S ? "5s" : "10s",
    resolution: "720p",
    prompt: shotPrompt(ctx.cast, s, audioIn),
    negative_prompt: ctx.avoid ? `${SHOT_NEGATIVE}, ${ctx.avoid}` : SHOT_NEGATIVE,
    image_url: signedMediaUrl(s.media_id!, ctx.baseUrl),
  };
  if (audioIn && s.text.trim()) {
    // Our voice, so the words are exact and the voice is theirs every time; the model lip-syncs to it.
    const tts = await venice(ctx.venice, "/audio/speech", { model: "tts-kokoro", input: s.text, voice: voiceFor(ctx.cast[s.who === "a" ? 0 : 1]), response_format: "mp3" });
    if (!tts.ok) throw await providerError(tts, (status) => `voice ${status}`);
    body.audio_url = `data:audio/mpeg;base64,${Buffer.from(await tts.arrayBuffer()).toString("base64")}`;
  } else if (!audioIn) {
    body.audio = true;
  }
  if (/^wan-3/.test(ctx.model)) body.aspect_ratio = "adaptive";
  const res = await venice(ctx.venice, "/video/queue", body);
  if (!res.ok) throw await providerError(res, (status, text) => `Venice ${status}: ${text.slice(0, 160)}`);
  const q = (await res.json()) as { queue_id?: string };
  if (!q.queue_id) throw new Error("Venice returned no queue id");
  s.queue_id = q.queue_id;
  s.model = ctx.model;
}

/** The reel holding the one-at-a-time slot, for the refusal: which pair, how far along, and whether it looks stuck. */
export type BusyReel = { id: string; a: string; b: string; names: [string, string]; done: number; shots: number; minutes: number; stalled: boolean };

export type MakeReelResult = { ok: true; reel: Reel } | { ok: false; status: number; error: string; message: string; busy?: BusyReel };

/** What the refusal says about the reel in the way: the pair's names, progress, and, once it's stuck, what to do. */
export function busyMessage(r: BusyReel): string {
  const of = `${r.done} of ${r.shots} shots`;
  const age = r.minutes < 1 ? "just now" : r.minutes < 90 ? `${r.minutes} min ago` : `${Math.round(r.minutes / 60)} hours ago`;
  const what = `A video of ${r.names[0]} and ${r.names[1]} is still being made (${of}, started ${age}).`;
  return r.stalled
    ? `${what} That's much longer than usual, so it looks stuck: stop it to get its tokens back, then make a new one.`
    : `${what} One video at a time, and they usually take a few minutes.`;
}

/**
 * The owner's reel (or clip, lib/adult/clips.ts) still making, if any, after giving up on any past REEL_GIVE_UP_MS (no
 * provider is called). One video at a time, either kind: Hive rate-limits a burst.
 */
export async function busyReel(db: Db, ownerId: string): Promise<BusyReel | null> {
  const { rows } = await db.query<{ id: string; character_a: string; character_b: string; shots: ReelShot[]; created_at: string | Date; a_name: string | null; b_name: string | null }>(
    `select r.id, r.character_a, r.character_b, r.shots, r.created_at, ca.name as a_name, cb.name as b_name
       from adult_reels r left join characters ca on ca.id = r.character_a left join characters cb on cb.id = r.character_b
      where r.owner_id = $1 and r.status = 'making' order by r.created_at`,
    [ownerId],
  );
  for (const r of rows) {
    const age = Date.now() - new Date(r.created_at).getTime();
    if (age > REEL_GIVE_UP_MS) {
      await stopReel(db, ownerId, r.id, "gave up waiting");
      continue;
    }
    const first = (n: string | null) => (n ?? "them").split(/\s+/)[0];
    return {
      id: r.id,
      a: r.character_a,
      b: r.character_b,
      names: [first(r.a_name), first(r.b_name)],
      done: r.shots.filter((s) => s.status !== "queued").length,
      shots: r.shots.length,
      minutes: Math.floor(age / 60_000),
      stalled: age > REEL_STALLED_MS,
    };
  }
  return null;
}

/**
 * Stops a reel still being made: its shots still out are given up, the ones already in are kept (a reel with any is
 * ready), and the share of tokens for the rest comes back. Anything else is left as it is.
 */
export async function stopReel(db: Db, ownerId: string, id: string, reason = "stopped"): Promise<Reel | null> {
  const row = (await db.query<{ owner_id: string; status: string; shots: ReelShot[] }>(`select owner_id, status, shots from adult_reels where id = $1`, [id])).rows[0];
  if (!row || row.owner_id !== ownerId) return null;
  if (row.status !== "making") return getReel(db, id);
  const shots = row.shots.map((s) => (s.status === "queued" ? { ...s, status: "failed" as const, reason } : s));
  await db.query(`update adult_reels set shots = $2::jsonb, updated_at = now() where id = $1 and status = 'making'`, [id, JSON.stringify(shots)]);
  // A shot still running on Replicate is stopped there too, so it doesn't go on billing for a video nobody collects.
  const running = row.shots.filter((s) => s.status === "queued" && s.provider === "replicate" && s.queue_id);
  if (running.length) {
    const { replicate } = await adultKeys(db).catch(() => ({ replicate: null }));
    if (replicate) await Promise.all(running.map((s) => cancelPrediction(replicate, s.queue_id!)));
  }
  return settleIfDone(db, id);
}

/**
 * Starts a reel of a night: spends the tokens (admins free), has the director pick and write the shots, and draws,
 * checks and queues each one's keyframe. `lines` is the night (the running scene, or a saved one); `where` is where it
 * happened, for each shot's place. `night` is what reelNight read (pass it whole): a reel of several chapters takes each
 * line's place and stage from its own chapter, and the row records its scope and chapters.
 */
export async function makeReel(
  db: Db,
  ownerId: string,
  x: string,
  y: string,
  lines: SceneLine[],
  baseUrl: string,
  opts: { shots?: number; where?: ReelWhere; night?: Pick<ReelNight, "scope" | "chapters" | "places" | "stages" | "chapterOf"> } = {},
): Promise<MakeReelResult> {
  const pair = await eligiblePair(db, ownerId, x, y);
  if (!pair) return { ok: false, status: 404, error: "not_found", message: "Pick two characters who are in after dark." };
  const [a, b] = pair;
  const settings = await getAdultSettings(db);
  const keys = await adultKeys(db);
  // Made where After Dark's media is made: Venice, or Replicate as the backup.
  const onReplicate = settings.media_provider === "replicate";
  if (!(onReplicate ? keys.replicate : keys.venice) || !keys.hive) {
    return { ok: false, status: 409, error: "not_set_up", message: `Videos need the ${onReplicate ? "Replicate" : "Venice"} and Hive keys in After Dark's settings.` };
  }
  if (lines.length < 6) return { ok: false, status: 409, error: "too_short", message: "Let the night run a little longer first: a video needs at least six lines." };
  // Hive over its daily limit (lib/adult/hive-limit.ts): refused before anything is drawn or spent.
  const gate = await hiveGate(db, keys.hive);
  if (!gate.ok) {
    await logPaused(db, ownerId, gate.reason);
    return { ok: false, status: 503, error: "hive_paused", message: gate.message };
  }
  const busy = await busyReel(db, ownerId);
  if (busy) return { ok: false, status: 409, error: "busy", message: busyMessage(busy), busy };
  const pays = !(await isAdmin(db, ownerId));
  const price = settings.reel_tokens;
  if (pays && !(await spendBoughtTokens(db, ownerId, price))) {
    return { ok: false, status: 402, error: "needs_tokens", message: `A video of the night costs ${price} tokens. Get more on the shop page.` };
  }
  const id = crypto.randomUUID();
  try {
    const [ca, cb] = await Promise.all([loadCharacter(db, a), loadCharacter(db, b)]);
    if (!ca || !cb) throw new Error("one of them is missing");
    // Each one's baseline, a portrait of them alone that passed the check: the faces every keyframe keeps. Made now if
    // they have none.
    for (const c of [ca, cb]) await ensureBaseline(db, ownerId, c);
    const bases = await baselines(db, a, b, ownerId);
    if (!bases) throw new Error("a picture of each of them is needed first");
    const where = opts.where ?? { place: null, set: null, history: [], date: null, stage: 0 };
    const cast = reelCast(ca, cb, ownerId);
    // Each line where it was said and how far the night had gone by then, from its own chapter.
    const night = opts.night && opts.night.places.length === lines.length ? opts.night : null;
    const places = night?.places ?? placesOf(lines, where);
    const stages = night?.stages ?? lines.map((l) => l.stage ?? where.stage);
    const whole = night?.scope === "night" && night.chapters.length > 1 ? night : null;
    const picks = await pickShots(db, lines, Math.min(12, Math.max(2, opts.shots ?? settings.reel_shots)), cast, places, stages, whole);
    // Where each chapter starts in the night's lines, for a shot's line in its own chapter.
    const starts = (night?.chapters ?? []).map((_, k, all) => all.slice(0, k).reduce((t, c) => t + c.lines, 0));
    const shots: ReelShot[] = [];
    for (const p of picks) {
      const l = lines[p.line];
      const { speech } = spoken(l.text);
      // Every word that will be spoken, and every direction, is held to David's lines first.
      if (!checkAdultText({ speech, frame: p.frame, motion: p.motion }).ok || crossesTaboo(`${speech} ${p.frame} ${p.motion}`)) continue;
      const k = whole?.chapterOf[p.line];
      const from = k === undefined ? null : { chapter: whole!.chapters[k].chapter, night_id: whole!.chapters[k].night_id, chapter_line: p.line - starts[k] };
      shots.push({ line: p.line, who: l.who, text: speech, frame: p.frame, motion: p.motion, status: "queued", ...(onReplicate ? { provider: "replicate" as const } : {}), ...(from ?? {}) });
    }
    if (!shots.length) throw new Error("no usable lines");
    // A shot whose moment already has a beat picture starts from it (lib/adult/beats.ts): the video looks like the pictures.
    if (night) await reuseBeatPictures(db, ownerId, [a, b], shots, night, starts, places, stages);
    // What it filmed: one chapter, or the whole night and its chapters.
    const scope: ReelScope = whole ? "night" : "chapter";
    const chapters = night?.chapters ?? null;
    await db.query(`insert into adult_reels (id, owner_id, character_a, character_b, status, tokens, shots, scope, chapters) values ($1, $2, $3, $4, 'making', $5, $6::jsonb, $7, $8::jsonb)`, [
      id,
      ownerId,
      a,
      b,
      pays ? price : 0,
      JSON.stringify(shots),
      scope,
      chapters ? JSON.stringify(chapters) : null,
    ]);
    // Both providers' details when both are set up: a shot goes to the other when the configured one is limited.
    const replicate = keys.replicate
      ? { token: keys.replicate, keyframe: settings.replicate_keyframe_model, video: settings.replicate_video_model, videoLora: settings.replicate_video_lora }
      : null;
    // A shot of the night at sex starts from their nude baselines (made now for one who wears something and has none).
    const nudeBases = shots.some((s) => !s.from_beat && (stages[s.line] ?? 0) >= NUDE_FROM) ? await nudeBaselines(db, ownerId, ca, cb) : null;
    await startShots(db, ownerId, shots, { pair: [a, b], cast, places, stages, bases, nudeBases, venice: keys.venice ?? "", hive: keys.hive, model: settings.reel_model, baseUrl, replicate, provider: settings.media_provider });
    const made = reelMadeOn(shots);
    await db.query(`update adult_reels set shots = $2::jsonb, provider = $3, fell_back = $4 where id = $1`, [id, JSON.stringify(shots), made.provider, made.fell_back]);
    return { ok: true, reel: await settleIfDone(db, id) };
  } catch (err) {
    if (pays) await refundBoughtTokens(db, ownerId, price);
    await db.query(`delete from adult_reels where id = $1`, [id]).catch(() => {});
    // A baseline made first found Hive out (lib/adult/hive-limit.ts): the pause's own message.
    if (err instanceof HivePausedError) return { ok: false, status: 503, error: "hive_paused", message: hivePausedErrorMessage(err, pays && price > 0) };
    return { ok: false, status: 502, error: "not_started", message: `The video couldn't start (${err instanceof Error ? err.message : "error"}). Your tokens are back.` };
  }
}

/**
 * Each shot's beat picture, where its chapter has one at or before its line at the same stage and place (beatPictureFor),
 * each picture used once: the shot then starts from it, not from a keyframe drawn for it.
 */
export async function reuseBeatPictures(
  db: Db,
  ownerId: string,
  pair: readonly [string, string],
  shots: ReelShot[],
  night: Pick<ReelNight, "chapters" | "chapterOf">,
  starts: readonly number[],
  places: readonly (string | null)[],
  stages: readonly number[],
): Promise<void> {
  const used = new Set<string>();
  for (const s of shots) {
    const k = night.chapterOf[s.line] ?? 0;
    const part = night.chapters[k];
    if (!part) continue;
    const pic = await beatPictureFor(db, ownerId, pair, part, s.line - (starts[k] ?? 0), stages[s.line] ?? 0, places[s.line] ?? null).catch(() => null);
    if (!pic || used.has(pic)) continue;
    used.add(pic);
    Object.assign(s, { media_id: pic, frame_id: pic, from_beat: true });
  }
}

const failShot = (s: ReelShot, reason: string) => Object.assign(s, { status: "failed", reason: reason.slice(0, 200) });

/**
 * Collects one Replicate shot once its prediction is done: the video downloaded at once (Replicate deletes it within
 * the hour), checked by Hive, and only then stored; then its line said by the character's stock voice (Wan 2.2 is
 * silent), stored beside it. "checked": it went to Hive; "busy": Hive couldn't check it (it's asked again later);
 * "waiting": still being made, or failed without reaching Hive.
 */
async function collectReplicateShot(
  db: Db,
  ownerId: string,
  pair: { character_a: string; character_b: string },
  s: ReelShot,
  keys: { replicate: string; hive: string | null; venice?: string | null },
  voiceModel: () => Promise<string>,
  now: number,
): Promise<"checked" | "busy" | "waiting"> {
  let p: Prediction;
  try {
    p = await getPrediction(keys.replicate, s.queue_id!);
  } catch (err) {
    // Busy, or a moment's trouble at Replicate: asked again next poll. Anything else (a refused key, no such
    // prediction) won't get better.
    const status = err instanceof ReplicateError ? err.status : undefined;
    if (status === undefined || status === 429 || status >= 500) return "waiting";
    failShot(s, err instanceof Error ? err.message : "error");
    return "waiting";
  }
  if (!isDone(p)) return "waiting";
  const missing = noOutput(p);
  if (missing) {
    failShot(s, missing);
    return "waiting";
  }
  let file: ReplicateFile;
  try {
    file = await downloadOutput(outputUrls(p.output)[0], keys.replicate, MAX_SHOT_BYTES);
  } catch (err) {
    // A moment's trouble (the network, Replicate's side): next poll. Gone after its hour, or unusable: failed.
    if (!(err instanceof ReplicateError) || (err.status !== undefined && err.status >= 500)) return "waiting";
    failShot(s, err.status === 403 || err.status === 404 || err.status === 410 ? "Replicate no longer has the video (it deletes what a model made an hour after)" : err.message);
    return "waiting";
  }
  const verdict = await checkMedia(db, { base64: file.bytes.toString("base64"), mime: "video/mp4" }, "video");
  if (!verdict.ok && couldntRun(verdict)) {
    s.retry_at = askAgainAt(verdict, now);
    s.reason = waitReason(verdict);
    return "busy";
  }
  if (!verdict.ok) {
    s.status = "discarded";
    s.reason = verdict.reason.slice(0, 200);
    await db.query(`insert into adult_rejections (id, owner_id, kind, reason) values ($1, $2, 'reel', $3)`, [crypto.randomUUID(), ownerId, verdict.reason.slice(0, 300)]).catch(() => {});
    return "checked";
  }
  const mediaId = crypto.randomUUID();
  const kept = await keepBytes("after-dark", mediaId, file.bytes, "video/mp4");
  await db.query(
    `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, object_key, status, source_image, provider, fell_back) values ($1, $2, $3, $4, 'video', $5, 'video/mp4', $6, $7, 'ready', $8, 'replicate', $9)`,
    [mediaId, ownerId, pair.character_a, pair.character_b, `Reel shot: ${s.text}`.slice(0, 500), kept.data, kept.object_key, s.media_id ?? null, s.fell_back === true],
  );
  s.status = "ready";
  s.media_id = mediaId;
  delete s.retry_at;
  delete s.reason;
  // A clip with no line in it (an act from the menu) stays silent.
  if (!s.text.trim()) return "checked";
  // Its line, in their voice: the words were held to the two lines when the reel started (makeReel). A voice that
  // doesn't come leaves the shot silent, with its caption, rather than losing it.
  try {
    // The voice is a job of its own: on Venice's Kokoro when Replicate is limited (the video stays where it was made).
    const said = await runMedia(
      db,
      "voice",
      async (p) =>
        p === "replicate"
          ? runModel(keys.replicate, await voiceModel(), replicateVoiceInput(s), { maxBytes: MAX_VOICE_BYTES, timeoutMs: 60_000 })
          : veniceSpeech(keys.venice!, s.text, s.voice ?? "af_alloy"),
      { configured: "replicate", available: (p) => p === "replicate" || Boolean(keys.venice) },
    );
    const voice = said.value;
    if (!voice.mime.startsWith("audio/")) throw new Error("Replicate returned no audio");
    const audioId = crypto.randomUUID();
    const kept = await keepBytes("after-dark", audioId, voice.bytes, voice.mime);
    await db.query(
      `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, object_key, status, source_image, provider, fell_back) values ($1, $2, $3, $4, 'audio', $5, $6, $7, $8, 'ready', $9, $10, $11)`,
      [audioId, ownerId, pair.character_a, pair.character_b, `Reel line: ${s.text}`.slice(0, 500), voice.mime, kept.data, kept.object_key, mediaId, said.provider, said.fell_back],
    );
    s.audio_id = audioId;
    if (said.fell_back) s.fell_back = true;
  } catch (err) {
    s.reason = `no voice: ${err instanceof Error ? err.message : "error"}`.slice(0, 200);
  }
  return "checked";
}

/** Checks a reel's queued shots once: stores each finished one that passes Hive, discards the rest. */
export async function advanceReel(db: Db, ownerId: string, id: string): Promise<Reel | null> {
  const row = (await db.query<{ owner_id: string; status: string; shots: ReelShot[]; character_a: string; character_b: string; created_at: string | Date }>(`select owner_id, status, shots, character_a, character_b, created_at from adult_reels where id = $1`, [id])).rows[0];
  if (!row || row.owner_id !== ownerId) return null;
  if (row.status !== "making") return getReel(db, id);
  const keys = await adultKeys(db);
  const shots = row.shots;
  // A couple of finished shots per poll: Hive rate-limits a burst (429), and the next poll takes the rest.
  let checked = 0;
  const now = Date.now();
  const age = now - new Date(row.created_at).getTime();
  for (const s of shots) {
    if (s.status !== "queued") continue;
    // Waited long enough: shots still unchecked are given up (their share of tokens comes back), so the reel settles.
    if (age > REEL_GIVE_UP_MS) Object.assign(s, { status: "failed", reason: s.reason ?? "gave up waiting" });
    // Its start was cut off before its video was queued (makeReel stopped partway): it's never coming.
    else if (!s.queue_id && age > NEVER_QUEUED_MS) Object.assign(s, { status: "failed", reason: s.reason ?? "never started" });
  }
  // Replicate's voice model, read once a poll and only when a Replicate shot needs it.
  let voiceModel: string | null = null;
  const voiceModelOf = async () => (voiceModel ??= (await getAdultSettings(db)).replicate_voice_model);
  // Hive over its daily limit (lib/adult/hive-limit.ts): nothing is fetched or sent to Hive; the shots wait where they
  // were made, unchecked, until the pause is over, and say so.
  const paused = await hivePausedUntil(db);
  if (paused) {
    for (const s of shots) {
      if (s.status !== "queued" || !s.queue_id) continue;
      if (!s.retry_at || s.retry_at < paused) s.retry_at = paused;
      s.reason = hivePausedReason(paused).slice(0, 200);
    }
  }
  for (const s of shots) {
    if (paused) break;
    if (s.status !== "queued" || !s.queue_id || !s.model || checked >= SHOTS_PER_POLL) continue;
    if (s.retry_at && now < new Date(s.retry_at).getTime()) continue;
    if (s.provider === "replicate") {
      if (!keys.replicate) continue;
      const got = await collectReplicateShot(db, ownerId, row, s, { replicate: keys.replicate, hive: keys.hive, venice: keys.venice }, voiceModelOf, now);
      if (got === "checked") checked++;
      // Hive couldn't check it: nothing more goes to Hive this poll.
      if (got === "busy") break;
      continue;
    }
    if (!keys.venice) continue;
    // Venice keeps the file until we've stored our own (a check that can't run yet is tried again next poll).
    const res = await venice(keys.venice, "/video/retrieve", { model: s.model, queue_id: s.queue_id });
    if (!res.ok) {
      s.status = "failed";
      s.reason = `Venice ${res.status}`;
      continue;
    }
    if (!(res.headers.get("content-type") ?? "").includes("video")) continue; // still being made
    const bytes = Buffer.from(await res.arrayBuffer());
    checked++;
    const verdict = await checkMedia(db, { base64: bytes.toString("base64"), mime: "video/mp4" }, "video");
    // The check couldn't run (Hive busy, down, or out for the day): not a refusal yet. Try again after a wait (or once
    // the pause is over), and send nothing more to Hive this poll.
    if (!verdict.ok && couldntRun(verdict)) {
      s.retry_at = askAgainAt(verdict, now);
      s.reason = waitReason(verdict);
      break;
    }
    if (!verdict.ok) {
      s.status = "discarded";
      s.reason = verdict.reason.slice(0, 200);
      await db.query(`insert into adult_rejections (id, owner_id, kind, reason) values ($1, $2, 'reel', $3)`, [crypto.randomUUID(), ownerId, verdict.reason.slice(0, 300)]).catch(() => {});
      continue;
    }
    const mediaId = crypto.randomUUID();
    const kept = await keepBytes("after-dark", mediaId, bytes, "video/mp4");
    await db.query(
      `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, object_key, status, source_image, provider, fell_back) values ($1, $2, $3, $4, 'video', $5, 'video/mp4', $6, $7, 'ready', $8, 'venice', $9)`,
      [mediaId, ownerId, row.character_a, row.character_b, `Reel shot: ${s.text}`.slice(0, 500), kept.data, kept.object_key, s.media_id ?? null, s.fell_back === true],
    );
    s.status = "ready";
    s.media_id = mediaId;
    delete s.retry_at;
    delete s.reason;
    // Ours now: Venice's copy can go.
    await venice(keys.venice, "/video/retrieve", { model: s.model, queue_id: s.queue_id, delete_media_on_completion: true }).catch(() => {});
  }
  await db.query(`update adult_reels set shots = $2::jsonb, updated_at = now() where id = $1`, [id, JSON.stringify(shots)]);
  return settleIfDone(db, id);
}

/** Once no shot is still being made: ready if any came through, and the share of tokens for the ones that didn't, back. */
export async function settleIfDone(db: Db, id: string): Promise<Reel> {
  const r = (await db.query<{ owner_id: string; status: string; tokens: number; shots: ReelShot[] }>(`select owner_id, status, tokens, shots from adult_reels where id = $1`, [id])).rows[0];
  if (r.status === "making" && !r.shots.some((s) => s.status === "queued")) {
    const good = r.shots.filter((s) => s.status === "ready").length;
    const status = good ? "ready" : "failed";
    const refund = r.tokens - Math.ceil((r.tokens * good) / r.shots.length);
    const done = await db.query(`update adult_reels set status = $2, updated_at = now() where id = $1 and status = 'making' returning 1`, [id, status]);
    if (done.rows.length && refund > 0) await refundBoughtTokens(db, r.owner_id, refund);
  }
  return (await getReel(db, id))!;
}

type ReelRow = {
  id: string;
  status: Reel["status"];
  tokens: number;
  shots: ReelShot[];
  created_at: string | Date;
  kind: string | null;
  clip: ClipMeta | null;
  character_a: string;
  character_b: string;
  scope: string | null;
  chapters: ReelChapter[] | null;
};
const REEL_COLUMNS = "id, status, tokens, shots, created_at, kind, clip, character_a, character_b, scope, chapters";
const reelOf = (r: ReelRow): Reel => ({
  id: r.id,
  status: r.status,
  tokens: r.tokens,
  shots: r.shots,
  created_at: new Date(r.created_at).toISOString(),
  kind: r.kind === "clip" ? "clip" : "night",
  clip: r.clip ?? null,
  a: r.character_a,
  b: r.character_b,
  scope: r.scope === "night" || r.scope === "chapter" ? r.scope : null,
  chapters: r.chapters ?? null,
});

export async function getReel(db: Db, id: string): Promise<Reel | null> {
  const r = (await db.query<ReelRow>(`select ${REEL_COLUMNS} from adult_reels where id = $1`, [id])).rows[0];
  return r ? reelOf(r) : null;
}

/** The pair's reels and clips for this person, newest first: the last 20 reels and the last 40 clips. */
export async function listReels(db: Db, ownerId: string, x: string, y: string): Promise<Reel[]> {
  const pair = await eligiblePair(db, ownerId, x, y);
  if (!pair) return [];
  const { rows } = await db.query<ReelRow>(
    `(select ${REEL_COLUMNS} from adult_reels where owner_id = $1 and character_a = $2 and character_b = $3 and coalesce(kind, 'night') <> 'clip' order by created_at desc limit 20)
     union all
     (select ${REEL_COLUMNS} from adult_reels where owner_id = $1 and character_a = $2 and character_b = $3 and kind = 'clip' order by created_at desc limit 40)`,
    [ownerId, ...pair],
  );
  return withRatings(db, ownerId, rows.map(reelOf).sort((p, q) => q.created_at.localeCompare(p.created_at)));
}

/** Each shot that came through with the viewer's 👍/👎 on it (lib/adult/steering.ts), for the page's rating buttons. */
export async function withRatings(db: Db, viewerId: string, reels: Reel[]): Promise<Reel[]> {
  const ids = reels.flatMap((r) => r.shots.filter((s) => s.status === "ready" && s.media_id).map((s) => s.media_id!));
  const rated = await ratingsFor(db, viewerId, ids);
  return reels.map((r) => ({
    ...r,
    shots: r.shots.map((s) => {
      const got = s.media_id ? rated.get(s.media_id) : undefined;
      return s.status === "ready" ? { ...s, rating: got?.rating ?? null, tags: got?.tags ?? [] } : s;
    }),
  }));
}

export type ArchiveResult = { ok: true; reel: Reel } | { ok: false; status: number; error: string; message: string };

/**
 * Moves one shot that came through out of its video and into the Archive, or puts it back (David, 2026-10-24: "allow a
 * user to remove a clip from the larger video (in case it fails) which should put it in a section called archive, dont
 * delete tho"). Nothing is deleted: the shot stays in its reel, marked `archived_at`, and plays nowhere but the Archive
 * (lib/adult/clip-chains.ts playable) until it's put back. Theirs only, and not while the video is still being made
 * (its poll rewrites the shots).
 */
/**
 * A 👎 on a shot takes it out of its video of the night, and taking the 👎 back (or a 👍) puts it back (David,
 * 2026-10-24: "if the user downvotes a clip we should remove it from the highlight reel"). It's archived like
 * archiveShot does (kept, never deleted, out of every player), marked archived_by: "rating" so only these come back on
 * their own; a shot archived by hand stays archived. Reels still being made are left alone. Returns how many changed.
 */
export async function shotsFollowRating(db: Db, ownerId: string, mediaId: string, rating: 1 | -1 | 0): Promise<number> {
  const rows = (
    await db.query<{ id: string; shots: ReelShot[] }>(
      `select id, shots from adult_reels where owner_id = $1 and status <> 'making' and shots @> $2::jsonb`,
      [ownerId, JSON.stringify([{ media_id: mediaId }])],
    )
  ).rows;
  let changed = 0;
  for (const r of rows) {
    let touched = false;
    for (const shot of r.shots) {
      if (shot.media_id !== mediaId || shot.status !== "ready") continue;
      if (rating === -1 && !shot.archived_at) {
        shot.archived_at = new Date().toISOString();
        shot.archived_by = "rating";
        touched = true;
      } else if (rating !== -1 && shot.archived_by === "rating") {
        delete shot.archived_at;
        delete shot.archived_by;
        touched = true;
      }
    }
    if (!touched) continue;
    await db.query(`update adult_reels set shots = $2::jsonb, updated_at = now() where id = $1 and status <> 'making'`, [r.id, JSON.stringify(r.shots)]);
    changed++;
  }
  return changed;
}

export async function archiveShot(db: Db, ownerId: string, reelId: string, mediaId: string, archived: boolean): Promise<ArchiveResult> {
  const row = (await db.query<{ owner_id: string; status: string; shots: ReelShot[] }>(`select owner_id, status, shots from adult_reels where id = $1`, [reelId])).rows[0];
  if (!row || row.owner_id !== ownerId) return { ok: false, status: 404, error: "not_found", message: "There's no video of yours with that id." };
  if (row.status === "making") return { ok: false, status: 409, error: "still_making", message: "That video is still being made. Try again once it's done." };
  const shot = row.shots.find((s) => s.status === "ready" && s.media_id === mediaId);
  if (!shot) return { ok: false, status: 404, error: "not_found", message: "That video has no such shot." };
  if (archived) shot.archived_at ??= new Date().toISOString();
  else delete shot.archived_at;
  // Archived or put back by hand: no longer the rating's to undo.
  delete shot.archived_by;
  await db.query(`update adult_reels set shots = $2::jsonb, updated_at = now() where id = $1 and status <> 'making'`, [reelId, JSON.stringify(row.shots)]);
  const [reel] = await withRatings(db, ownerId, [(await getReel(db, reelId))!]);
  return { ok: true, reel };
}
