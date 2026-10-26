/**
 * Deterministic guards on what a scene step writes (David, 2026-10-21: "Chad", a misnamed Chud, joined Chud × Star's
 * two-person scene, and the same speaker spoke twice in a row). Free, no model, run on every step by lib/adult/scenes.ts
 * writeSceneStep:
 *
 *  - names (guardNames): a near-miss of one of the pair's names ("Chad" for "Chud": the same first two letters, a letter
 *    or two apart) is put right; a line naming another character on the show is dropped. As in #544's crowd repair
 *    (scripts/loop/crowd.mjs fixNames), only a word used as a name counts: addressed ("Oh, Chad"), possessive ("Chad's"),
 *    capitalised mid-sentence, or the subject of what follows ("*Chad pulls her close*"); an everyday word never does
 *    ("Stay with me" isn't "Star", "Race you there" isn't "Rafe").
 *  - alternation (guardAlternation): within a reply, the same speaker twice in a row is merged into one line (speech only,
 *    short enough) or the second is dropped. A reply's first line by whoever spoke last is kept and counted, not dropped:
 *    dropping it would drop a proposal with it, and a move needs both halves (lib/adult/continuity.ts); prompt v2 tells
 *    the model who starts instead.
 *  - fragments (repairFragments, v2.4): a line the model started on a dangling "'s" gets its word back, the speaker's
 *    name in an action, "That" in what they say.
 *  - self-address (withoutSelfAddress, 2026-10-26): what someone says never calls out their own name ("Fuck... Coco."
 *    from Coco, a line the model gave the wrong one of them); the name goes, the rest stays.
 */
import { shortName } from "../names";
import { EVERYDAY_WORDS } from "../quality";
import type { DroppedLine, SceneLine } from "./scenes";

/** Words that are never anyone's name in a line, even capitalised: everyday words, pet names, exclamations, the calendar. */
const COMMON = new Set([
  ...EVERYDAY_WORDS,
  ...(
    "the a an and but or so if then when while because i you he she we they it this that these those my your his her our their its there here what who " +
    "how why where which yes no not oh ah mm mmm hmm hey god gods lord jesus christ heaven hell damn please wait stop stay come go look listen tell let " +
    "lets maybe just well now okay ok sure fine right good great nice sweet perfect baby babe darling honey sweetheart sweetie love dear angel sir madam " +
    "miss mister chef boss captain doctor trouble gorgeous beautiful handsome sexy tiger kitten princess prince queen king sunshine star stars moon sun " +
    "monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december " +
    "mercy wow whoa yeah yep nope fuck shit thank thanks hello hi bye goodnight morning evening tonight tomorrow yesterday again always never " +
    // Words a scene opens a sentence with that people also name characters after ("*Rain lashes the window*").
    "rain storm thunder river ocean sea sky snow frost winter summer spring autumn fall dawn dusk ember flame blaze ash smoke rose lily ivy sage " +
    "jade ruby pearl amber coral ginger cherry candy grace faith joy glory harmony melody serenity destiny heaven luna echo silk velvet"
  ).split(/\s+/),
]);

/** The name a character goes by: the first word of their name that isn't a title ("Odalys" for "Captain Odalys Reyes"). */
export const givenName = (name: string): string => shortName(name).split(/\s+/).pop() ?? "";

/** Every word of a name, lower-cased ("captain", "odalys", "reyes"): all of them belong in the scene. */
const nameWords = (name: string): string[] =>
  name
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .split(/[^\p{L}\p{N}'-]+/u)
    .filter(Boolean);

/** Whether a given name could be someone else in a line: long enough, and not an everyday word. */
export const castableName = (given: string): boolean => given.length >= 3 && !COMMON.has(given.toLowerCase());

/** Levenshtein distance (#544's crowd repair uses the same). */
export function editDistance(x: string, y: string): number {
  const row = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[y.length];
}

/** A misspelling of a name ("Chad" for "Chud"): the same first two letters, at most one letter off (two for a long name). */
export function nearMiss(word: string, name: string): boolean {
  const w = word.toLowerCase();
  const n = name.toLowerCase();
  if (w === n || w.length < 4 || n.length < 4 || w.slice(0, 2) !== n.slice(0, 2) || Math.abs(w.length - n.length) > 2) return false;
  return editDistance(w, n) <= (n.length >= 7 ? 2 : 1);
}

const CAP_WORD = /\b[A-Z][a-zà-ÿ'’-]{2,}\b/g;
/** Where a sentence or an action starts: the line's start, after a full stop, inside an opening asterisk, quote or dash. */
const STARTS = /(?:^|[.!?…]["”’)]*\s+|[*"“‘(]\s*|[—–]\s*|\n\s*)$/;
const INTERJECTION = /\b(?:oh|ah|hey|mm+|god|yes|please|thanks|thank you)\s+$/i;
/** What follows a name that's the subject: a verb ("pulls", "grinned", "would"), "and", or "&". Plurals slip in; a cost. */
const SUBJECT_FOLLOWS =
  /^\s+(?:and\b|&|[a-z]+(?:s|ed)\b|(?:said|was|is|has|had|can|could|would|will|did|does|just|never|always|got|made|came|went|took|gave|knew|thought|told|felt|saw|sat|stood|ran|slid|bit|held|kept|let|put|drew|drove|threw|wore|woke|lay|laid|taught|brought|bought|caught|found|left|lost|met|paid|sent|spent|won|wrote|swore|grew|fell|hid|shook)\b)/;

/**
 * Whether a capitalised word is used as a name where it stands. `strict` (a repair) wants a clear name use; a sentence
 * that merely starts with the word counts only as an action's subject ("*Chad pulls…*"), since a sentence in speech may
 * start with any word ("Race you there").
 */
function usedAsName(text: string, offset: number, word: string, strict: boolean): boolean {
  const before = text.slice(0, offset);
  const after = text.slice(offset + word.length);
  if (/['’]s$/.test(word)) return true;
  if (/,\s*$/.test(before) || /^\s*,/.test(after) || INTERJECTION.test(before)) return true;
  if (!STARTS.test(before)) return true;
  const inAction = (before.match(/\*/g) ?? []).length % 2 === 1;
  return (inAction || !strict) && SUBJECT_FOLLOWS.test(after);
}

export type NameContext = { a: string; b: string; /** Every other character's given name, lower-cased (lib/adult/voice.ts castNames). */ cast: ReadonlySet<string> };
export type NameGuard = { text: string; repairs: { from: string; to: string }[]; stranger: string | null };

/** A line with its near-misses of the pair's names put right, and the first other character it names (or null). */
export function guardNames(text: string, ctx: NameContext): NameGuard {
  const inScene = new Set([...nameWords(ctx.a), ...nameWords(ctx.b)]);
  const targets = [givenName(ctx.a), givenName(ctx.b)].filter((t) => t.length >= 4);
  const repairs: NameGuard["repairs"] = [];
  let stranger: string | null = null;
  const out = text.replace(CAP_WORD, (word: string, offset: number) => {
    const base = word.replace(/['’]s$/, "");
    const low = base.toLowerCase();
    if (inScene.has(low) || COMMON.has(low)) return word;
    const to = targets
      .filter((t) => nearMiss(base, t))
      .sort((x, y) => editDistance(low, x.toLowerCase()) - editDistance(low, y.toLowerCase()))[0];
    if (to && usedAsName(text, offset, word, true)) {
      repairs.push({ from: base, to });
      return `${to}${word.slice(base.length)}`;
    }
    if (ctx.cast.has(low) && usedAsName(text, offset, word, false)) stranger ??= base;
    return word;
  });
  return { text: out, repairs, stranger };
}

/** A possessive or "is" left without its word ("'s movements", "’s the server migration", "'S okay"). */
const DANGLING = /^(['’])[sS]\s+/;
/** The same, starting a sentence inside what's said ("Yes. That. 'S quieter now."). */
const DANGLING_IN = /([.!?…]["”’)]*\s+)(['’])[sS]\s+/g;

/**
 * A line the model started without its first word (v2.4; Chud × Juniper on prod, 2026-10-23, DeepSeek V3.1): "*'s
 * movements become more deliberate and intense* 's the server migration I've been waiting for all week." The reply's
 * "who" already says who, so the name went and its "'s" stayed. A leading action that starts with "'s" gets the
 * speaker's given name in front ("*Chud's movements…*"), and a sentence of what's said that starts with it gets "That"
 * ("That's the server migration…"), at the start or after another sentence, "'S" as well (the real-model check of
 * 2026-10-23: "'S the only command I needed.", "Yes. That. 'S quieter now."). A line that really starts with an
 * apostrophe ("'Cause", "'Twas", "'Smarter than the gulls'") is left as it is. Returns the line and how many fragments
 * it put right.
 */
export function repairFragments(text: string, given: string): { text: string; repairs: number } {
  const lead = /^(\s*\*\s*)([^*]*)(\*\s*)([\s\S]*)$/.exec(text);
  let action = lead ? lead[2] : "";
  let said = lead ? lead[4] : text;
  let repairs = 0;
  if (lead && given && DANGLING.test(action)) {
    action = action.replace(DANGLING, (_m, q: string) => `${given}${q}s `);
    repairs++;
  }
  if (DANGLING.test(said)) {
    said = said.replace(DANGLING, (_m, q: string) => `That${q}s `);
    repairs++;
  }
  said = said.replace(DANGLING_IN, (_m, end: string, q: string) => {
    repairs++;
    return `${end}That${q}s `;
  });
  return repairs ? { text: lead ? `${lead[1]}${action}${lead[3]}${said}` : said, repairs } : { text, repairs: 0 };
}

/** The name a line gets wrong, for the metrics: another character it names, or a near-miss of the pair's. */
export function strangerIn(text: string, ctx: NameContext): string | null {
  const g = guardNames(text, ctx);
  return g.stranger ?? g.repairs[0]?.from ?? null;
}

/** Two lines by the same speaker merged this long at most (three sentences, about). */
export const MERGE_MAX = 400;

const merge = (x: SceneLine, y: SceneLine): SceneLine => ({
  ...x,
  text: `${x.text.trim()} ${y.text.trim()}`,
  ...(x.why || y.why ? { why: x.why || y.why } : {}),
  ...("memory" in x || "memory" in y ? { memory: x.memory ?? y.memory ?? null } : {}),
});

/** A line that answers the one before it ("Yes…", "That's…", "Lead the way"): with that one gone, it doesn't read alone. */
const ANSWERS =
  /^(?:(?:it|that|this|those|these|which|so|and|but|or|because|yes|yeah|yep|no|nope|well|also|same|exactly|right|okay|ok|sure|fine|deal|then|good|really|me too|neither|either|ditto|you too|after you|lead the way|show me)\b|mm+|ha+\b)/i;
const actionAndWords = (text: string) => {
  const m = /^\s*\*([^*]+)\*\s*([\s\S]*)$/.exec(text);
  return { action: m ? m[1].trim() : "", said: (m ? m[2] : text).trim() };
};

/**
 * v2.1 (the A/B of 2026-10-21: four lines a run lost to cascades): a line by the same speaker as the line before it,
 * when the partner's line between them was dropped, kept by joining it to the one before, if what it says reads on its
 * own (it doesn't answer the dropped line) and the two fit MERGE_MAX. Its action leads when the first line has none,
 * else goes (the theater shows one action a line). Null when it can't be kept.
 */
function keepReply(prev: SceneLine, l: SceneLine): SceneLine | null {
  const p = actionAndWords(prev.text);
  const n = actionAndWords(l.text);
  if (!n.said || ANSWERS.test(n.said) || n.said.includes("*")) return null;
  const said = `${p.said} ${n.said}`.trim();
  const action = p.action || n.action;
  const text = action ? `*${action}* ${said}` : said;
  if (text.length > MERGE_MAX) return null;
  return { ...merge(prev, l), text };
}

/**
 * The lines with the turn-taking kept: a line by the same speaker as the one before it in this reply is merged into it
 * when it's only speech and the two fit MERGE_MAX, else dropped (with `keepReplies`, v2.1, kept by joining when it reads
 * on its own: keepReply). `last` is who spoke last before the reply; a first line by them is kept and counted in
 * `boundary`.
 */
export function guardAlternation(
  lines: readonly SceneLine[],
  last: "a" | "b" | null,
  opts: { keepReplies?: boolean } = {},
): { kept: SceneLine[]; merged: number; dropped: DroppedLine[]; boundary: number } {
  const kept: SceneLine[] = [];
  const dropped: DroppedLine[] = [];
  let merged = 0;
  let boundary = 0;
  for (const l of lines) {
    const prev = kept.at(-1);
    const joined = prev && prev.who === l.who && opts.keepReplies ? keepReply(prev, l) : null;
    if (!prev) {
      if (l.who === last) boundary++;
      kept.push(l);
    } else if (l.who !== prev.who) kept.push(l);
    else if (!l.text.includes("*") && prev.text.trim().length + 1 + l.text.trim().length <= MERGE_MAX) {
      kept[kept.length - 1] = merge(prev, l);
      merged++;
    } else if (joined) {
      kept[kept.length - 1] = joined;
      merged++;
    } else dropped.push({ who: l.who, text: l.text, reason: "the same speaker twice in a row" });
  }
  return { kept, merged, dropped, boundary };
}

/**
 * What a line says without the speaker calling out their own name (Coco × Sweet, line 93: Coco said "Fuck... Coco.").
 * Only an address in the spoken words counts (the name alone, or after a pause or a comma and closing a sentence); the
 * actions, and a name the other one shares, are left alone. Null when nothing would be left.
 */
export function withoutSelfAddress(text: string, own: string, other: string): string | null {
  const name = givenName(own);
  if (name.length < 2 || name.toLowerCase() === givenName(other).toLowerCase()) return text;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The name as an address: at the start, or after a pause or a comma, and closing a sentence (its punctuation with it).
  const vocative = new RegExp(`(^\\s*|[.!?…—–-]\\s*|,\\s*)${esc}(\\s*[.!?…—–-]+|\\s*$)`, "g");
  let changed = false;
  const out = text
    .split(/(\*[^*]*\*)/)
    .map((part) =>
      part.startsWith("*")
        ? part
        : part.replace(vocative, (_m, lead: string, after: string) => {
            changed = true;
            // A line that opens on it loses it; "Yes, Coco. Right there." keeps the full stop after it; "Fuck... Coco." the pause before.
            if (!lead.trim()) return lead;
            if (lead.trim() === ",") return `${after.trim()} `;
            return `${lead.trimEnd()} `;
          }),
    )
    .join("");
  // Only a line that lost the name is tidied (2026-10-26: tidying every line turned each "..." into ".").
  if (!changed) return text;
  const tidy = out.replace(/\s{2,}/g, " ").replace(/\s+([.!?…])/g, "$1").trim();
  return /\p{L}/u.test(tidy) ? tidy : null;
}
