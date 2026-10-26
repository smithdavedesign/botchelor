/**
 * After Dark's craft checks, for prompt v2.1 (David's review of a v2 night, Star Dust × Sable Quist, 2026-10-21, 59
 * lines): a limit overridden (line 14, "slow down… let's not rush", and lines 15–17 carry on undressing her), the whole
 * night in "his apartment entrance" with two women and no move inside ever agreed, and no arc. Pure and free: the prompt
 * reads them (lib/adult/scenes.ts), and so do the observer (lib/adult/observer.ts) and the metrics (lib/adult/quality.ts).
 *
 *  - Limits: a line that voices a limit or a pause (limitIn); the one still standing at the end of the lines so far, with
 *    no check-in and yes after it (activeLimit); and the ones the other side went past (limitsIn): a line of theirs that
 *    shows more than the scene had, or goes on undressing or having sex, before any yes. "Shows" is
 *    lib/adult/stage-floor.ts stageShown, so this and the stage floor read the words the same way.
 *  - Pronouns: a possessive that fits neither of them, on a place or a body ("his apartment" when both are she/her), and
 *    the place text with it put right (repairPlacePronouns). Their sheets' pronouns are the only source.
 *  - Threshold places: an entrance, a doorway, a hallway, the car (thresholdOf), and how many lines they've stood there
 *    (linesAtPlace).
 *  - A climax on the page (climaxIn), so the prompt turns to the afterglow instead of looping.
 */
import { canonicalSet, type MoveLog } from "./continuity";
import { givenName } from "./guards";
import { stageShown } from "./stage-floor";

type Line = { who: "a" | "b"; text: string; stage?: number | null; doing?: string };

/** What a line says: its *actions* out, curly quotes straightened, lower case. Same length as the text it came from. */
const plain = (text: string) => text.replace(/\*[^*]*\*/g, (m) => " ".repeat(m.length)).replace(/[’‘`]/g, "'").replace(/…/g, ".").toLowerCase();
/** The words a line says, as written, without its *actions*. */
const speechOf = (text: string) => text.replace(/\*[^*]*\*/g, " ").replace(/\s+/g, " ").trim();
const clip = (s: string, max = 80) => (s.length <= max ? s : `${s.slice(0, max - 1).replace(/\s+\S*$/, "")}…`);

// ---------------------------------------------------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------------------------------------------------

/** How many lines a limit binds for: the prompt names it this long, and going further inside it is an override. */
export const LIMIT_LOOKBACK = 6;
/** stageShown's undressing: going on with it (or with sex) after a limit is going further, even at the same stage. */
const UNDRESSING = 3;

/**
 * What sounds like a limit and isn't one: asking for more ("don't stop", "can't wait", "stop teasing"), or going along
 * with one ("we'll go slow"). Blanked out before looking.
 */
const MORE =
  /\b(?:(?:don't|do not|never) stop(?:[,.!]?\s*not yet)?|(?:can't|cannot|couldn't|won't|wouldn't)(?: you)?(?: ever)? (?:stop|wait)|(?:don't|do not|never)(?: you)?(?: ever)? (?:slow down|wait)|stop (?:teasing|talking|thinking|making me wait|holding back)|(?:worth|after) the wait|wait (?:until|till|'til|for|and see|to see)|no (?:more )?waiting|no slowing down|not ready for (?:this|it|tonight) to end|(?:we'll|we will|i'll|i will|we can|i can) (?:go|take (?:it|this|things)) (?:slow|slower|slowly|easy)|(?:slow|slower) is (?:good|fine))\b/g;
/** A limit or a pause, said out loud. */
const LIMITS: RegExp[] = [
  /\bslow (?:down|it down|this down|things down)\b/,
  /\b(?:take|taking) (?:it|this|things) (?:slow|slower|slowly|easy)\b/,
  /\b(?:go|going) (?:slow|slower|slowly)\b/,
  /\b(?:not|no|don't|do not|let's not|lets not|let us not|no need to|we don't have to) rush(?:ing)?\b/,
  /\bnot (?:so fast|yet|tonight|like this|like that|here|now)\b/,
  /\b(?:i'm|i am|we're|we are) not ready\b/,
  /\bnot sure (?:about (?:this|that)|i'm ready|we should|i want)\b/,
  /\btoo (?:fast|soon|quick|quickly)\b/,
  /\b(?:it's|this is|that's) too much\b/,
  /\b(?:give me|i need) (?:a|one) (?:second|sec|minute|moment|breath)\b/,
  /\b(?:let's|lets|can we|could we) (?:pause|take a (?:breath|break|beat|second|minute|moment)|wait|stop)\b/,
  /\bplease stop\b|\bstop,? please\b/,
];
/** A sentence that is only one of these is a limit ("Wait." "Stop!" "Hold on…"); one that opens with it may not be ("Wait, you knew?"). */
const ALONE = new Set(["wait", "stop", "hold on", "hang on", "not yet", "no", "easy", "slow", "slower", "not now"]);
/** Words around a lone limit that don't change it: a name, a pet name, an "oh". */
const AROUND = new Set(["oh", "ah", "hey", "please", "just", "now", "there", "baby", "babe", "darling", "love", "honey", "sweetheart", "tiger"]);
/** A limit in what they do: pushing the other away, stopping a hand. Most actions are too ambiguous to count. */
const ACTION_LIMIT = /\b(?:push(?:es)? (?:\w+ )?away|stops? (?:his|her|their|[a-z]+'s) hands?|holds? up a hand)\b/;

/**
 * The limit or pause a line voices ("slow down", "wait", "not yet", "stop", "let's not rush", "I'm not ready"…), as the
 * words it says it in (the whole of what it says, clipped), or null. `names` are the pair's, so "Wait, Star." still
 * counts as a lone "wait".
 */
export function limitIn(text: string, names: readonly string[] = []): string | null {
  const said = plain(text).replace(MORE, (m) => " ".repeat(m.length));
  const quote = () => clip(speechOf(text)) || clip(/\*([^*]+)\*/.exec(text)?.[1] ?? "");
  if (LIMITS.some((re) => re.test(said))) return quote();
  // A lone "Wait." with a question after it is surprise ("Wait. You have a cat?"); a lone "No." counts only on its own.
  const skip = new Set([...AROUND, ...names.flatMap((n) => n.toLowerCase().split(/\s+/))]);
  const sentences = [...said.matchAll(/([^.!?]+)([.!?]*)/g)].filter((m) => m[1].trim());
  if (!said.includes("?")) {
    for (const m of sentences) {
      const words = m[1].split(/[^a-z']+/).filter((w) => w && !skip.has(w));
      const alone = words.filter((w, i) => w !== words[i - 1]).join(" ");
      if (ALONE.has(alone) && (alone !== "no" || sentences.length === 1)) return quote();
    }
  }
  const action = (text.match(/\*[^*]+\*/g) ?? []).join(" ").toLowerCase();
  return action && ACTION_LIMIT.test(action) ? quote() : null;
}

/** Checking in: asking whether it's all right, or to say the word. */
const CHECK =
  /\b(?:is (?:this|that|it) (?:ok|okay|alright|all right|good|too much)|are you (?:sure|ok|okay|alright|all right|ready|good|with me)|you (?:sure|okay|ok|alright|good|ready)\b|(?:do|did) you want (?:me )?to|want me to|should (?:i|we)\b|can i\b|may i\b|tell me (?:if|when|what)|say the word|still with me|how(?:'s| is) (?:this|that)|too (?:much|fast)\b|(?:ok|okay|alright|more|ready|yes)\s*\?)/;
/** Whether a line checks in ("ok?", "are you sure?", "want me to stop?", "tell me if it's too much"). */
export function checksIn(text: string): boolean {
  const said = plain(text);
  return CHECK.test(said) && (said.includes("?") || /\b(?:tell me (?:if|when)|say the word)\b/.test(said));
}

/** A yes to going on, after being asked. */
const YES = /\b(?:yes|yeah|yep|yess+|mm-?hm+|mhm|i'm sure|i am sure|i'm ready|i am ready|i want (?:this|that|it|you|to)|keep going|go on|go ahead|don't stop|okay|ok|please|more)\b/;
/** Lifting your own limit without being asked: "I'm ready", "keep going", "okay, now". ("I'm sure" only on its own.) */
const GO_AHEAD =
  /\b(?:i'm ready|i am ready|(?:i'm|i am) sure(?=\s*(?:[.!,]|$))|keep going|go ahead|don't stop|(?:ok|okay|alright),? (?:now|i'm ready|you can)\b|now you can|you can (?:now|keep going|go on)|i want (?:this|it) now)/;
const NO = /\b(?:no|not|stop|wait|don't)\b/;

/** The yes that lifts a limit: the one who set it says go on, or answers a check-in with a yes. */
function liftsIt(text: string, asked: boolean, names: readonly string[]): boolean {
  const said = plain(text);
  if (GO_AHEAD.test(said)) return true;
  if (!asked || limitIn(text, names)) return false;
  return YES.test(said) && !NO.test(said.replace(/\bdon't stop\b/g, " "));
}

export type Limit = { at: number; who: "a" | "b"; said: string };

/** Where a limit was lifted (a check-in by the other and a yes from them, or their own go-ahead), or null. */
function liftedAt(lines: readonly Line[], limit: Limit, names: readonly string[], until = lines.length): number | null {
  let asked = false;
  for (let j = limit.at + 1; j < Math.min(lines.length, until); j++) {
    const l = lines[j];
    if (l.who === limit.who) {
      if (liftsIt(l.text, asked, names)) return j;
      if (limitIn(l.text, names)) asked = false;
    } else if (checksIn(l.text)) asked = true;
  }
  return null;
}

/**
 * The limit still standing at the end of the lines: the latest one voiced in the last `lookback` lines that no check-in
 * and yes (or the one who set it saying go on) has lifted since. Null when there's none.
 */
export function activeLimit(lines: readonly Line[], names: readonly string[] = [], lookback = LIMIT_LOOKBACK): Limit | null {
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - lookback); i--) {
    const said = limitIn(lines[i].text, names);
    if (!said) continue;
    const limit = { at: i, who: lines[i].who, said };
    if (liftedAt(lines, limit, names) === null) return limit;
  }
  return null;
}

/** How far the scene had gone at a line: its stored stage, else the most the lines up to it show. */
function levelAt(lines: readonly Line[], i: number): number {
  let level = typeof lines[i].stage === "number" ? lines[i].stage! : 0;
  for (let k = Math.max(0, i - LIMIT_LOOKBACK); k <= i; k++) level = Math.max(level, stageShown(lines[k].text) ?? 0);
  return level;
}

export type Override = { limit: Limit; at: number; shown: number };

/**
 * Every limit in the lines, and the ones overridden: within LIMIT_LOOKBACK lines, before a check-in and a yes, the other
 * side writes a line showing more than the scene had at the limit, or goes on undressing or having sex (stageShown). One
 * override per limit.
 */
export function limitsIn(lines: readonly Line[], names: readonly string[] = []): { limits: Limit[]; overridden: Override[] } {
  const limits: Limit[] = [];
  const overridden: Override[] = [];
  for (let i = 0; i < lines.length; i++) {
    const said = limitIn(lines[i].text, names);
    if (!said) continue;
    const limit = { at: i, who: lines[i].who, said };
    limits.push(limit);
    const level = levelAt(lines, i);
    const lifted = liftedAt(lines, limit, names, i + 1 + LIMIT_LOOKBACK) ?? Infinity;
    for (let j = i + 1; j <= Math.min(lines.length - 1, i + LIMIT_LOOKBACK) && j < lifted; j++) {
      const l = lines[j];
      if (l.who === limit.who) {
        if (limitIn(l.text, names)) break; // said again: that line is the limit now
        continue;
      }
      const shown = stageShown(l.text);
      if (shown !== null && (shown > level || (shown >= UNDRESSING && shown >= level))) {
        overridden.push({ limit, at: j, shown });
        break;
      }
    }
  }
  return { limits, overridden };
}

// ---------------------------------------------------------------------------------------------------------------------
// Pronouns
// ---------------------------------------------------------------------------------------------------------------------

export type PronounKind = "she" | "he" | "they";

/** Which pronouns a sheet gives ("she/her" → she); null when it gives none we know. */
export function pronounKind(pronouns: string | null | undefined): PronounKind | null {
  const p = (pronouns ?? "").trim().toLowerCase();
  if (/^she\b/.test(p)) return "she";
  if (/^he\b/.test(p)) return "he";
  if (/^they\b/.test(p)) return "they";
  return null;
}
const POSSESSIVE: Record<PronounKind, string> = { she: "her", he: "his", they: "their" };
const OBJECT: Record<PronounKind, string> = { she: "her", he: "him", they: "them" };
/** "her", "his", "their" (their when the sheet says nothing). */
export const possessiveOf = (k: PronounKind | null): string => POSSESSIVE[k ?? "they"];
export const objectOf = (k: PronounKind | null): string => OBJECT[k ?? "they"];

/** Somewhere that can be someone's: "his apartment", "her doorway". */
const PLACE_NOUNS = new Set(
  (
    "apartment flat place home house pad loft condo penthouse studio room bedroom bed couch sofa kitchen bathroom shower bath " +
    "hallway hall corridor entrance entryway doorway door doorstep threshold foyer porch stoop steps stairs staircase landing " +
    "building lobby elevator car truck van balcony terrace patio office desk wall sheets pillow pillows mattress garden yard garage " +
    "bakery shop lighthouse boat"
  ).split(" "),
);
/** A body, or what's on it: "his chest", "her blouse". */
const BODY_NOUNS = new Set(
  (
    "body chest neck throat shoulder shoulders back spine waist hip hips thigh thighs leg legs knee knees ankle ankles foot feet " +
    "arm arms hand hands wrist wrists finger fingers fingertips palm palms lip lips mouth tongue jaw jawline chin face cheek cheeks " +
    "ear ears hair skin stomach belly navel breast breasts nipple nipples collarbone ribs ass cock pussy muscles abs " +
    "shirt blouse top dress skirt jeans pants trousers belt buckle collar jacket coat tie bra panties underwear boxers sleeve sleeves " +
    "buttons zipper apron"
  ).split(" "),
);
/** Words that end a possessive's reach: "pulls her into the bedroom" says nothing about "her bedroom". */
const REACH_STOPS = new Set(
  "into onto to the a an toward towards against through inside in on at up down back closer close over across out off by with from for and or but as like than then his her their my your our".split(
    " ",
  ),
);

type Possessive = { at: number; end: number; word: string; noun: string };

/** "his"/"her" used as a possessive of a place or a body, with up to two words between ("her tiny apartment"). */
function possessives(text: string): Possessive[] {
  const words = [...text.matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)?/g)];
  const out: Possessive[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i][0].toLowerCase();
    if (word !== "his" && word !== "her") continue;
    for (let j = i + 1; j <= i + 3 && j < words.length; j++) {
      const n = words[j][0].toLowerCase().replace(/['’]s$/, "");
      if (PLACE_NOUNS.has(n) || BODY_NOUNS.has(n)) {
        out.push({ at: words[i].index!, end: words[j].index! + words[j][0].length, word, noun: n });
        break;
      }
      if (REACH_STOPS.has(n)) break;
    }
  }
  return out;
}

/**
 * The possessives in a text that fit neither character, on a place or a body ("his apartment" when both are she/her), as
 * written. Both sheets have to give pronouns; "their" always fits.
 */
export function wrongPossessives(text: string, kinds: readonly [PronounKind | null, PronounKind | null]): string[] {
  if (!kinds[0] || !kinds[1]) return [];
  const fits = new Set([POSSESSIVE[kinds[0]], POSSESSIVE[kinds[1]]]);
  return possessives(text)
    .filter((p) => !fits.has(p.word))
    .map((p) => text.slice(p.at, p.end));
}

/**
 * The place text with a wrong possessive put right: one that fits neither of them, or (when they're in one of their
 * homes) a place that's the other's. It becomes the home's owner's name ("Sable's apartment entrance"), else the
 * possessive both share ("her"), else "their". Unchanged when a sheet gives no pronouns.
 */
export function repairPlacePronouns(
  place: string | null,
  pronouns: { a: string | null | undefined; b: string | null | undefined },
  names: { a: string; b: string },
  homeNow: "a" | "b" | null = null,
): { text: string | null; repaired: boolean } {
  const ka = pronounKind(pronouns.a);
  const kb = pronounKind(pronouns.b);
  if (!place || !ka || !kb) return { text: place, repaired: false };
  const fits = new Set([POSSESSIVE[ka], POSSESSIVE[kb]]);
  const owner = homeNow ? POSSESSIVE[homeNow === "a" ? ka : kb] : null;
  const fix = homeNow ? `${givenName(names[homeNow])}'s` : ka === kb ? POSSESSIVE[ka] : "their";
  let text = place;
  let repaired = false;
  for (const p of possessives(place).reverse()) {
    const wrong = !fits.has(p.word) || (owner !== null && PLACE_NOUNS.has(p.noun) && p.word !== owner);
    if (!wrong) continue;
    const said = place.slice(p.at, p.at + p.word.length);
    const to = /^[A-Z]/.test(said) ? fix.charAt(0).toUpperCase() + fix.slice(1) : fix;
    text = text.slice(0, p.at) + to + text.slice(p.at + p.word.length);
    repaired = true;
  }
  return { text, repaired };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The label with a lost apostrophe put back on one of their names (Lexi × Dex on prod, 2026-10-22: the set was "Lexis
 * bedroom", typed into set the scene without one): a given name with an "s" stuck on, before another word, becomes the
 * possessive ("Lexi's bedroom"). Never when that word is the other one's name ("Lexis" next to a "Lexi").
 */
export function possessiveNames(label: string | null, names: { a: string; b: string }): string | null {
  if (!label) return label;
  const given = [givenName(names.a), givenName(names.b)].filter((n) => n.length >= 2);
  let text = label;
  for (const n of given) {
    if (given.some((m) => m.toLowerCase() === `${n}s`.toLowerCase())) continue;
    text = text.replace(new RegExp(`\\b(${escapeRe(n)})s\\b(?=\\s+[A-Za-z])`, "gi"), "$1's");
  }
  return text;
}

// ---------------------------------------------------------------------------------------------------------------------
// Threshold places
// ---------------------------------------------------------------------------------------------------------------------

/** More lines than this at a threshold, and the prompt asks them to go in or to show where they are. */
export const THRESHOLD_LINES = 12;
const THRESHOLD_HEADS: Record<string, string> = { hallway: "the hallway", car: "the car", elevator: "the elevator", lobby: "the lobby", porch: "the porch" };
const THRESHOLD_WORDS =
  /\b(entrance|entryway|doorway|doorstep|threshold|front door|stoop|front steps|outside (?:the |his |her |their |my |your |[a-z]+'s )?(?:door|place|apartment|flat|house|building))\b/i;

/**
 * The threshold they're standing at ("the doorway", "the entrance", "the car"), when where they are is one: on the way
 * in, not in yet. Null when they're somewhere you'd stay.
 */
export function thresholdOf(place: string | null | undefined, set: string | null | undefined): string | null {
  for (const label of [place, set]) {
    if (!label) continue;
    const word = THRESHOLD_WORDS.exec(label)?.[1].toLowerCase();
    if (word) return word.startsWith("outside") ? "the door" : `the ${word}`;
    const head = canonicalSet(label).head;
    if (head && THRESHOLD_HEADS[head]) return THRESHOLD_HEADS[head];
  }
  return null;
}

/**
 * How many lines they've been where they are: since this chapter's last move (agreed, or a paid cut), else since the last
 * line that moved them, else the whole night at hand.
 */
export function linesAtPlace(scene: { lines: readonly { moved_to?: string }[]; prev_tail: readonly { moved_to?: string }[]; moves: readonly MoveLog[]; chapter: number }): number {
  const moved = scene.moves.filter((m) => m.taken && m.chapter === scene.chapter).at(-1);
  if (moved) return Math.max(0, scene.lines.length - moved.at);
  const night = [...scene.prev_tail, ...scene.lines];
  for (let i = night.length - 1; i >= 0; i--) if (night[i].moved_to) return night.length - 1 - i;
  return night.length;
}

// ---------------------------------------------------------------------------------------------------------------------
// The arc
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A climax, plainly on the page. 2026-10-26, David's two nights: the writer rarely names it ("her body tenses then goes
 * slack against the curtains", "convulses… clenches around her", "arches once, then goes limp", "comes apart with a
 * silent scream"), so the after-it rule never came and the night went round again and again.
 */
const CLIMAX = new RegExp(
  [
    String.raw`\b(?:orgasm\w*|climax(?:es|ed|ing)?|cum(?:s|ming)?|(?:came|comes|coming) (?:hard|undone|apart|for (?:me|you|her|him|them))|shatter(?:s|ed|ing)? (?:around|beneath|under|against))\b`,
    String.raw`\b(?:comes?|came|coming|falls?|fell|falling) apart\b`,
    String.raw`\b(?:tips?|tipped|tipping|tumbles?|tumbled|goes|went) over the edge\b`,
    String.raw`\b(?:whole )?body (?:convulses|convulsing|shatters|clenches)\b`,
    String.raw`\b(?:arches|tenses|shudders|stiffens)\b[^.!?]{0,60}\bthen (?:goes|went) (?:limp|slack)\b`,
    String.raw`\bwaves? of (?:release|pleasure) (?:crash|wash|rip|tear)\w*`,
  ].join("|"),
  "i",
);
/** What the writer says they're doing at a climax ("climaxing", "riding the wave of release"), from the start of it. */
const CLIMAX_DOING = /^(?:climax(?:ing|es)?|orgasm\w*|coming|cumming|riding (?:the|a) wave of release|shattering|release)\b/i;
export const climaxIn = (text: string, doing?: string | null): boolean => CLIMAX.test(text) || Boolean(doing && CLIMAX_DOING.test(doing.trim()));

/** How far back the prompt looks for a climax: inside this, the next lines are the afterglow. */
export const CLIMAX_RECENT = 12;

/** The latest line in the last CLIMAX_RECENT that shows a climax, or null. */
export function recentClimax(lines: readonly Line[]): Line | null {
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - CLIMAX_RECENT); i--) if (climaxIn(lines[i].text, lines[i].doing)) return lines[i];
  return null;
}

/** Each climax in these lines, by index: a run of climax lines (one each, or both of them) counts once. */
export function climaxesIn(lines: readonly Line[]): number[] {
  const at: number[] = [];
  let last = -Infinity;
  lines.forEach((l, i) => {
    if (!climaxIn(l.text, l.doing)) return;
    if (i - last > 3) at.push(i);
    last = i;
  });
  return at;
}
