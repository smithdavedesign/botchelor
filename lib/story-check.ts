/**
 * The story check (December wave A, 2026-11-16; docs/story-check.md). The home page once featured a date whose last
 * lines were "Neither have I. Same channel next time?" and whose ending was "A disaster": the engine had called a
 * disaster from the start and the writer played it warm. The engine alone decides how a date ends (lib/engine.ts) and
 * nothing here moves an ending, a line or a score. This reads aired dates afterwards, judges whether a viewer would feel
 * the lines and the outcome agree, mends only the recap's finale when the record allows, and keeps the dates that still
 * don't make sense off every featured surface (lib/story-check-gate.ts).
 *
 * - **The judge**: one call on the show's paid model per date (no thinking, real room for the answer), handed only what
 *   the episode page shows a stranger once it has aired (getEpisodeView with no viewer), answering JSON
 *   {verdict, reason}. Three ways to pass: consistent (the lines and the recap set the ending up), hidden_truth (the
 *   lines read warm, but a private thought, a see-again answer or a confessional the viewer sees explains it), reversal
 *   (the final action explains it: the finale or the twist, who left first, a walk-out or a ghosting); else
 *   contradicts. With no paid model, or when the call fails twice, `rulesVerdict` decides for $0: contradicts only for
 *   the glaring shape, consistent otherwise; the row says model 'rules'. Never the free tier (a background sweep on the
 *   free quota once caused an outage).
 * - **The repair** (STORY_CHECK_REPAIR, on unless "0"): a contradicting public date's recap finale, and nothing else, is
 *   rewritten from facts on record (the ending and its kind, who left first, the box score's weak spot, a private
 *   thought or a see-again answer the page shows). The new finale must pass the PG check (lib/safety.ts), must not
 *   contradict the ending (lib/house-scenes.ts checkEnding), and a second judgement must pass it; only then is it
 *   written, and story_checks.finale_before keeps the one it replaced. Otherwise the date keeps its finale and stays
 *   contradicts, off the featured places.
 * - **The sweep** (STORY_CHECK, on unless "0"): the hourly lobby job checks aired public dates with no row yet, the
 *   featured ones first (the home clips, the dates the home page's standout list picks from), then the newest, back
 *   STORY_CHECK_BACKFILL_DAYS (30); at most STORY_CHECK_PER_HOUR (30) a pass, within a time budget. Each row keeps its
 *   model, tokens and cost, and each pass logs a `story_check` analytics event with its counts and cost.
 */
import { track } from "./analytics";
import type { Db } from "./db";
import { getEpisodeView, STANDOUT_DAYS, STANDOUT_LIMIT, STANDOUT_SCORE_SQL, type EpisodeView } from "./game";
import { CLIP_FRESH_DAYS } from "./home-clip";
import { checkEnding } from "./house-scenes";
import { getFrontierModel, ModelError, type ChatMessage, type Model, type Usage } from "./model";
import { priceFor } from "./pricing";
import { dramaAnswerLabel, endingLabel, REPORT_HIDE_THRESHOLD, type Ending, type EndingDetail } from "./rules";
import { checkShowText } from "./safety";
import { clearSharedCache } from "./shared-cache";
import { isStoryVerdict, storyCheckOn, type StoryVerdict } from "./story-check-gate";
import { venueName } from "./venues";

// The gate's helpers, so a surface (the season page) can import everything story-check from one place.
export { featurableFlag, featurableSql, isFeaturable, isStoryVerdict, storyCheckOn, storyPassedSql, STORY_VERDICTS, type StoryVerdict } from "./story-check-gate";

type Env = Record<string, string | undefined>;

/** Stored on each row: a change to the prompts below bumps it, so the counts can tell the judges apart. */
export const STORY_CHECK_PROMPT_VERSION = "story-check-1";
/** The last act the judge reads: the date's last spoken lines. */
export const LAST_ACT_LINES = 8;
/** A line handed to the judge is cut here (a newer date's line can run to a paragraph), and a thought here. */
const LINE_MAX = 400;
const THOUGHT_MAX = 240;
/** The private thoughts from before the last act the judge reads, at most (the latest). */
const EARLIER_THOUGHTS_MAX = 10;
/**
 * The paid model reasons before it answers unless told not to, and the reasoning counts against max_tokens (a small
 * cap comes back empty, billed: lib/import-history-reader.ts). So the first try asks for no thinking with room for the
 * JSON and slack; the second lets it think (a model that can't switch thinking off refuses the first with a 400), with
 * room for both.
 */
const NO_THINKING = { reasoning: { effort: "none" } };
export const JUDGE_ANSWER_TOKENS = 600;
export const JUDGE_THINKING_TOKENS = 4000;
export const REPAIR_ANSWER_TOKENS = 800;
/** A finale is one or two sentences: the longest the repair may write. */
export const FINALE_MAX_CHARS = 300;
export const FINALE_MAX_WORDS = 50;
const REASON_MAX = 240;
/** A pass stops starting checks after this long (the lobby job has other work and a 300 s limit). */
export const SWEEP_BUDGET_MS = 40_000;
/** Checks in flight at once: each waits on the model, so three keep a pass short without crowding the pool. */
const SWEEP_CONCURRENCY = 3;

/** STORY_CHECK_REPAIR (on unless "0", and only while STORY_CHECK is on): rewrite a contradicting date's finale. */
export function storyRepairOn(env: Env = process.env): boolean {
  return storyCheckOn(env) && env.STORY_CHECK_REPAIR?.trim() !== "0";
}

const intEnv = (raw: string | undefined, fallback: number, min: number, max: number): number => {
  const n = Number(raw?.trim());
  return raw?.trim() && Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback;
};
/** STORY_CHECK_PER_HOUR: the most dates one pass judges (default 30; "0" checks none). */
export const storyCheckPerHour = (env: Env = process.env): number => intEnv(env.STORY_CHECK_PER_HOUR, 30, 0, 500);
/** STORY_CHECK_BACKFILL_DAYS: how far back the sweep reaches for dates aired before it existed (default 30). */
export const storyCheckBackfillDays = (env: Env = process.env): number => intEnv(env.STORY_CHECK_BACKFILL_DAYS, 30, 0, 365);

const oneLine = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();
const clip = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, max - 1).replace(/\s+\S*$/, "")}…`);
const squash = (s: string): string => oneLine(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "");

/* ------------------------------------------------ the facts ------------------------------------------------ */

export type ActLine = {
  side: "a" | "b";
  who: string;
  emotion: string;
  interest: number | null;
  text: string;
  action: string;
  /** The speaker's private thought on this line, when the page shows it once aired (lib/inner-life.ts innerForViewer). */
  thought: string | null;
  walked_out: boolean;
};

/** One aired date as a stranger reads it on its page: everything the judge and the repair may use, and nothing else. */
export type StoryFacts = {
  names: [string, string];
  place: string | null;
  setting: string;
  ending: Ending;
  /** "A disaster", "A third date": the ending as the page says it. */
  ending_label: string;
  kind: EndingDetail | null;
  kind_label: string | null;
  /** The drama question's answer, when it was "who leaves first?": a name, or "They leave together". */
  left_first: string | null;
  /** When it was "who gets rejected?": a name, or "Nobody". */
  rejected: string | null;
  /** Who walked out on a line, by its mark. */
  walked_out: string | null;
  /** The box score's own line on why it ended so (lib/why.ts), without the arithmetic. */
  why: string | null;
  acts: string[];
  last_act: ActLine[];
  /** The private thoughts the page shows on lines before the last act (the latest EARLIER_THOUGHTS_MAX). */
  earlier_thoughts: { who: string; thought: string }[];
  /** Each side's answer to "see them again?", with its reason when the page shows it. */
  choices: { who: string; see_again: "yes" | "maybe" | "no"; reason: string | null }[];
  confessionals: { who: string; line: string }[];
  twist: string;
  finale: string;
};

/** The box score's why line (EpisodeJson.why) without its general note and its arithmetic: what explains this ending. */
export function shortWhy(why: string | null | undefined): string | null {
  if (!why) return null;
  const kept = oneLine(why)
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .filter((s) => !/^(?:Endings read where|By the numbers:|This one came out)/.test(s));
  return kept.join(" ").trim() || null;
}

/**
 * The facts of an aired date from its stranger's view (getEpisodeView(db, id, null)): only what its page shows anyone
 * once it has aired (a private thought only on the sides the page shows them for). Null before it airs.
 */
export function storyFacts(view: EpisodeView): StoryFacts | null {
  if (!view.revealed || !view.ending) return null;
  const [a, b] = view.characters;
  const nameOf = (side: "a" | "b") => (side === "a" ? a.name : b.name);
  const byId = (id: string) => (id === a.id ? a.name : id === b.id ? b.name : "");
  const transcript = view.transcript ?? [];
  const thoughts = view.inner?.thoughts ?? [];
  const spoken = transcript.map((t, i) => ({ t, i })).filter(({ t }) => oneLine(t.dialogue));
  const act = spoken.slice(-LAST_ACT_LINES);
  const inAct = new Set(act.map(({ i }) => i));
  const earlier_thoughts = transcript
    .flatMap((t, i) => (thoughts[i] && !inAct.has(i) ? [{ who: nameOf(t.side), thought: clip(oneLine(thoughts[i]), THOUGHT_MAX) }] : []))
    .slice(-EARLIER_THOUGHTS_MAX);
  const last_act: ActLine[] = act.map(({ t, i }) => ({
    side: t.side,
    who: nameOf(t.side),
    emotion: oneLine(t.emotion),
    interest: typeof t.interest === "number" && Number.isFinite(t.interest) ? t.interest : null,
    text: clip(oneLine(t.dialogue), LINE_MAX),
    action: clip(oneLine(t.action), 160),
    thought: thoughts[i] ? clip(oneLine(thoughts[i]), THOUGHT_MAX) : null,
    walked_out: t.walked_out === true,
  }));
  const walker = transcript.find((t) => t.walked_out === true);
  const answer = view.drama_question && view.drama_answer ? dramaAnswerLabel(view.drama_question, view.drama_answer, [a.name, b.name]) : null;
  return {
    names: [a.name, b.name],
    place: view.venue ? venueName(view.venue) : null,
    setting: oneLine(view.setting),
    ending: view.ending,
    ending_label: endingLabel(view.ending, view.date_number),
    kind: view.ending_detail ?? null,
    kind_label: view.ending_detail_label ?? null,
    left_first: view.drama_question === "leaves_first" ? answer : null,
    rejected: view.drama_question === "rejected" ? answer : null,
    walked_out: walker ? nameOf(walker.side) : null,
    why: shortWhy(view.why),
    acts: (view.scenes ?? []).map(oneLine).filter(Boolean),
    last_act,
    earlier_thoughts,
    choices: (view.inner?.choices ?? []).map((c) => ({ who: byId(c.character_id), see_again: c.see_again, reason: c.reason ? oneLine(c.reason) : null })),
    confessionals: (view.confessionals ?? view.diary ?? []).map((c) => ({ who: byId(c.character_id), line: oneLine(c.line) })).filter((c) => c.line),
    twist: oneLine(view.twist),
    finale: oneLine(view.finale),
  };
}

const lineText = (l: ActLine): string =>
  `- ${l.who}${l.emotion ? ` (${l.emotion})` : ""}: "${l.text}"${l.action ? ` [${l.action}]` : ""}${l.walked_out ? " [walks out]" : ""}${l.thought ? ` (privately thinks: ${l.thought})` : ""}`;

/** The facts as the judge and the repair read them. */
export function factsText(f: StoryFacts): string {
  const out: string[] = [`The date: ${f.names[0]} and ${f.names[1]}${f.place ? `, ${f.place}` : ""}.${f.setting ? ` ${f.setting}` : ""}`];
  out.push(`How it ended: ${f.ending_label}${f.kind_label ? ` (${f.kind_label})` : ""}.`);
  if (f.left_first) out.push(`Who left first: ${f.left_first}.`);
  if (f.rejected) out.push(`Who got rejected: ${f.rejected}.`);
  if (f.walked_out) out.push(`${f.walked_out} walked out.`);
  if (f.why) out.push(`The box score's own why: ${f.why}`);
  if (f.acts.length) out.push("The recap's acts:", ...f.acts.map((s, i) => `${i + 1}. ${s}`));
  if (f.earlier_thoughts.length) out.push("Private thoughts earlier in the date:", ...f.earlier_thoughts.map((t) => `- ${t.who}: ${t.thought}`));
  if (f.last_act.length) out.push(`The last ${f.last_act.length} lines:`, ...f.last_act.map(lineText));
  if (f.choices.length) out.push('Their answers to "see them again?":', ...f.choices.map((c) => `- ${c.who}: ${c.see_again}${c.reason ? ` (${c.reason})` : ""}`));
  if (f.confessionals.length) out.push("Confessionals:", ...f.confessionals.map((c) => `- ${c.who}: ${c.line}`));
  if (f.twist) out.push(`The recap's twist: ${f.twist}`);
  out.push(`The recap's finale: ${f.finale || "(none)"}`);
  return out.join("\n");
}

/* ------------------------------------------------ the rules ($0) ------------------------------------------------ */

/** Emotions that read warm on a line, in the actors' own words ("dryly amused" reads as amused, "dry, warm" doesn't). */
const WARM = new Set(
  (
    "warm amused delighted playful charmed fond tender excited smitten content hopeful giddy gleeful eager pleased soft " +
    "happy moved affectionate softened thrilled elated glad cheerful teasing flirty flirtatious intrigued curious earnest " +
    "cheeky bright relaxed easy sincere mischievous smug smirking confident glowing grinning joyful sweet adoring enchanted " +
    "captivated besotted beaming radiant touched grateful keen enthusiastic romantic"
  ).split(" "),
);
const QUALIFIERS = new Set(["dryly", "quietly", "softly", "very", "a", "bit", "little", "slightly", "openly", "shyly", "warmly"]);
export function isWarmEmotion(emotion: string): boolean {
  const words = emotion.toLowerCase().split(/[^a-z]+/).filter((w) => w && !QUALIFIERS.has(w));
  return words.length > 0 && words.every((w) => WARM.has(w));
}
const warmLine = (l: ActLine): boolean => isWarmEmotion(l.emotion) && (l.interest ?? 0) >= 0.5;

/** Said warmly at the end of a disaster, these promise a next time the ending took away. */
const COMING_BACK = /\b(?:next time|again|in love|see you soon|same (?:time|place|channel|table|floor) next|(?:another|second|third|next) date|date me)\b/i;
/** Said at the end of "Just friends", these promise more than friendship. */
const ROMANCE = /\b(?:in love|fall(?:ing)? for you|(?:another|second|third|next) date|date me|be mine|marry (?:me|you)|kiss(?:ed|es|ing)?)\b/i;

/** The finale says, in so many words, how it ended (rulesVerdict's last escape). */
const STATES: Record<"disaster" | "friends", RegExp> = {
  disaster:
    /\b(?:disast\w*|catastroph\w*|went (?:badly|south|wrong|sideways)|goes (?:badly|wrong)|badly|neither (?:of them )?(?:wants?|wanted|asks?|asked)|(?:no|not a|not another|without a) (?:second |third |another |next )?date|(?:do|does|did)(?: not|n'?t) want (?:another|a second|to see)|won'?t see|never see|turn(?:s|ed)? (?:\w+ )?down|declin\w+|refus\w+|reject\w*|walk(?:s|ed)? (?:off|out)|storm(?:s|ed)? off|part(?:s|ed)? ways|for good|no spark|fizzl\w+|never again|alone|apart|separately)\b/i,
  friends: /\b(?:friends?|friendship|friendly|platonic|no romance|nothing more|not romantic|unromantic|pals|mates)\b/i,
};
export const finaleStatesEnding = (finale: string, ending: Ending): boolean => ending === "second_date" || STATES[ending].test(finale);

/**
 * The $0 fallback (no paid model, or the call failed twice): contradicts only for the glaring shape, consistent
 * otherwise. Glaring: the ending is a disaster whose last act is all warm (warm emotion, interest 0.5 or more), or whose
 * closing lines warmly promise a next time; or it is "Just friends" whose closing lines warmly promise romance. And
 * nothing on record explains it: no "no" to "see them again?" (or a "maybe", for friends), no walk-out or ghosting, no
 * rejection, and the finale doesn't say the ending itself. A second date is never glaring here (the model judges those).
 */
export function rulesVerdict(f: StoryFacts): { verdict: "consistent" | "contradicts"; reason: string } {
  const pass = (reason: string) => ({ verdict: "consistent" as const, reason });
  if (f.ending === "second_date") return pass("Rules: a second date is never the glaring shape.");
  if (f.kind === "walked_out" || f.kind === "ghosted" || f.walked_out) return pass("Rules: a walk-out or a ghosting explains it.");
  if (f.rejected && f.rejected !== "Nobody") return pass(`Rules: ${f.rejected} was turned down.`);
  const cool = f.ending === "friends" ? ["no", "maybe"] : ["no"];
  const answered = f.choices.find((c) => cool.includes(c.see_again));
  if (answered) return pass(`Rules: ${answered.who} answered ${answered.see_again} to seeing them again.`);
  if (finaleStatesEnding(f.finale, f.ending)) return pass("Rules: the finale says how it ended.");
  const closing = f.last_act.slice(-2);
  if (f.ending === "disaster") {
    if (f.last_act.length && f.last_act.every(warmLine)) return { verdict: "contradicts", reason: "Rules: a disaster whose whole last act is warm, and nothing on record turns it." };
    const promise = closing.find((l) => warmLine(l) && COMING_BACK.test(l.text));
    if (promise) return { verdict: "contradicts", reason: `Rules: a disaster that closes on ${promise.who} warmly promising a next time.` };
    return pass("Rules: the last act doesn't read warm.");
  }
  const romance = f.last_act.slice(-3).find((l) => (l.interest ?? 0) >= 0.5 && ROMANCE.test(l.text));
  if (romance) return { verdict: "contradicts", reason: `Rules: "Just friends" after ${romance.who} talks of romance, and nothing on record says why.` };
  return pass("Rules: warm lines suit just friends.");
}

/* ------------------------------------------------ the model ------------------------------------------------ */

export type StoryModels = { quick: Model; thinking: Model };

/** The show's paid model, asked without thinking first and with it second; null when none is configured. Never the free tier. */
export function storyModels(): StoryModels | null {
  const quick = getFrontierModel(NO_THINKING);
  const thinking = getFrontierModel();
  return quick && thinking ? { quick, thinking } : null;
}

/** A JSON object out of a model's reply (a fenced or chatty one too), or null. */
function jsonObject(raw: string): Record<string, unknown> | null {
  const text = raw.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v: unknown = JSON.parse(text.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The judge's answer, or null when it isn't one: a known verdict and a one-line reason. */
export function parseVerdict(raw: string): { verdict: StoryVerdict; reason: string } | null {
  const o = jsonObject(raw);
  const verdict = typeof o?.verdict === "string" ? o.verdict.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  if (!isStoryVerdict(verdict)) return null;
  return { verdict, reason: clip(oneLine(typeof o?.reason === "string" ? o.reason : ""), REASON_MAX) };
}

/** The repair's answer: the new finale's text, or null. */
export function parseFinale(raw: string): string | null {
  const o = jsonObject(raw);
  return typeof o?.finale === "string" && oneLine(o.finale) ? oneLine(o.finale) : null;
}

type Asked<T> = { value: T; model: string } | { value: null; error: unknown };

/** Two tries, the second thinking with room; each reply parsed, a failure of either kind leading to the next. */
async function askTwice<T>(models: StoryModels, messages: ChatMessage[], parse: (raw: string) => T | null, temperature: number, firstTokens: number, usage: Usage[]): Promise<Asked<T>> {
  let error: unknown = null;
  for (const [model, maxTokens] of [
    [models.quick, firstTokens],
    [models.thinking, JUDGE_THINKING_TOKENS],
  ] as const) {
    let served = "";
    try {
      const raw = await model.complete(messages, { temperature, maxTokens, onUsage: (u) => usage.push(u), onModel: (id) => (served = id) });
      const value = parse(raw);
      if (value !== null) return { value, model: served || process.env.FRONTIER_LLM_MODEL || "frontier" };
      error = new Error("unusable answer");
    } catch (err) {
      error = err;
      console.warn("[story-check] a model call failed:", err instanceof Error ? err.message.slice(0, 160) : "unknown");
    }
  }
  return { value: null, error };
}

const JUDGE_SYSTEM = [
  "You check one aired episode of Botchelor, an AI dating show, for whether its ending makes sense to a viewer.",
  "The show's engine decided the ending from the box score before the lines were written; writers wrote the lines and the recap. Nothing you say changes the episode: you only say whether a viewer who watched the date and read the recap would feel that the story and the outcome agree.",
  "Pick one verdict:",
  '- "consistent": the lines and the recap set the ending up.',
  '- "hidden_truth": the lines read warmer (or colder) than the ending, but something the viewer sees on the episode explains it: a private thought, a "see them again?" answer, or a confessional.',
  '- "reversal": the final action explains it: the recap\'s twist or finale, who left first, a walk-out or a ghosting turns an apparently good date bad, or an apparently bad one good.',
  '- "contradicts": none of these; a viewer would feel the writer and the outcome disagree.',
  'Be fair to the writer. "Just friends" fits warm lines and plans to meet again as friends. A disaster can follow a warm date when something on record turns it. Say "contradicts" only when a viewer would be confused: for example the last lines plan the next date or say "in love", the recap ends happy, and nothing on record explains "A disaster".',
  'Answer only with JSON: {"verdict": "consistent" | "hidden_truth" | "reversal" | "contradicts", "reason": "one short sentence naming what decided it"}',
].join("\n");

export function judgeMessages(f: StoryFacts): ChatMessage[] {
  return [
    { role: "system", content: JUDGE_SYSTEM },
    { role: "user", content: factsText(f) },
  ];
}

export type Judgement = { verdict: StoryVerdict; reason: string; model: string };

/** A provider that refused for rate or credit: the rest of a pass would fail the same way, so the sweep stops. */
const providerBusy = (err: unknown): boolean => err instanceof ModelError && (err.status === 429 || err.status === 402);

/** The model's verdict, or (no model, or two failed calls) the rules'. `busy`: the provider refused for rate or credit. */
export async function judgeStory(f: StoryFacts, models: StoryModels | null, usage: Usage[]): Promise<Judgement & { busy?: true }> {
  if (models) {
    const asked = await askTwice(models, judgeMessages(f), parseVerdict, 0.2, JUDGE_ANSWER_TOKENS, usage);
    if (asked.value) return { ...asked.value, model: asked.model };
    const rules = rulesVerdict(f);
    return { ...rules, model: "rules", ...(providerBusy(asked.error) ? { busy: true as const } : {}) };
  }
  return { ...rulesVerdict(f), model: "rules" };
}

/* ------------------------------------------------ the repair ------------------------------------------------ */

const REPAIR_SYSTEM = [
  "You are the narrator of Botchelor, an AI dating show. Each episode's recap ends with a finale: one or two sentences in the narrator's voice (third person, present tense, plain and a little wry).",
  "This date's finale doesn't fit how it ended, so a viewer is left confused. Rewrite ONLY the finale so that the ending makes sense: as a reversal (the final action turns the night) or a hidden truth (what one of them privately thought or answered), built strictly from the facts listed under ON THE RECORD.",
  "Rules: never invent an event, a feeling, a secret, a line of dialogue, a person or a place that isn't on the record. You may keep the old finale's image and add the turn. Say the ending plainly, as the user message asks. One or two sentences, at most 40 words, no quotation marks, PG, nothing romantic beyond what the record says.",
  'Answer only with JSON: {"finale": "..."}',
].join("\n");

/** What the new finale must make plain, in words lib/house-scenes.ts checkEnding reads as that ending. */
const SAY_ENDING: Record<Ending, string> = {
  disaster: "there is no next date: it ended badly",
  friends: "they part as friends, and nothing more",
  second_date: "they will see each other again",
};

/**
 * What the repair may build the finale from, and nothing else: the ending and its kind, who left first (or was turned
 * down, or walked out), the box score's weak spot, a private thought and a see-again answer the page shows.
 */
export function recordLines(f: StoryFacts): string[] {
  const out = [`- The ending: ${f.ending_label}${f.kind_label ? ` (${f.kind_label})` : ""}.`];
  if (f.left_first) out.push(`- Who left first: ${f.left_first}.`);
  if (f.rejected) out.push(`- Who got rejected: ${f.rejected}.`);
  if (f.walked_out) out.push(`- ${f.walked_out} walked out.`);
  if (f.why) out.push(`- Why, by the box score: ${f.why}`);
  for (const t of f.earlier_thoughts) out.push(`- ${t.who} privately thought: ${t.thought}`);
  for (const l of f.last_act) if (l.thought) out.push(`- ${l.who} privately thought: ${l.thought}`);
  for (const c of f.choices) out.push(`- ${c.who} answered "see them again?" with ${c.see_again}${c.reason ? ` (${c.reason})` : ""}.`);
  return out;
}

export function repairMessages(f: StoryFacts): ChatMessage[] {
  return [
    { role: "system", content: REPAIR_SYSTEM },
    {
      role: "user",
      content: `${factsText(f)}\n\nON THE RECORD (use only these):\n${recordLines(f).join("\n")}\n\nThe new finale must make plain that ${SAY_ENDING[f.ending]}.\nThe old finale: ${f.finale || "(none)"}`,
    },
  ];
}

const sentenceCount = (t: string): number => (t.match(/[.!?](?=\s|$)/g) ?? []).length || 1;

/** A capitalised word mid-sentence that appears nowhere on the record: a person or a place the repair made up. */
function newName(text: string, f: StoryFacts): string | null {
  const known = squash(
    [
      f.names.join(" "),
      f.place,
      f.setting,
      f.acts.join(" "),
      f.earlier_thoughts.map((t) => t.thought).join(" "),
      f.last_act.map((l) => `${l.text} ${l.thought ?? ""}`).join(" "),
      f.choices.map((c) => c.reason ?? "").join(" "),
      f.confessionals.map((c) => c.line).join(" "),
      f.twist,
      f.finale,
      f.why,
      f.ending_label,
      f.kind_label,
    ]
      .filter(Boolean)
      .join(" "),
  );
  const words = text.split(/\s+/);
  for (let i = 1; i < words.length; i++) {
    if (/[.!?:;]$/.test(words[i - 1])) continue; // a new sentence or clause may start with a capital
    const w = words[i].replace(/^[^\p{L}]+/u, "").replace(/['’]s\b.*$/u, "").replace(/[^\p{L}'’-]+$/u, "");
    if (w.length < 2 || !/^\p{Lu}/u.test(w)) continue;
    if (!known.includes(squash(w))) return w;
  }
  return null;
}

/**
 * Why a rewritten finale can't stand, or null when it can: one or two sentences at most, no quoted speech, not the old
 * one again, PG (lib/safety.ts checkShowText), not contradicting the ending (lib/house-scenes.ts checkEnding), and no
 * name or place that isn't on the record.
 */
export function finaleRefusal(text: string, f: StoryFacts): string | null {
  const t = oneLine(text);
  if (t.length < 12) return "empty";
  if (t.length > FINALE_MAX_CHARS || t.split(" ").length > FINALE_MAX_WORDS || sentenceCount(t) > 2) return "too_long";
  if (/["“”]/.test(t)) return "quoted";
  if (squash(t) === squash(f.finale)) return "unchanged";
  if (!checkShowText({ finale: t }).ok) return "not_pg";
  if (checkEnding(t, { ending: f.ending }) === "contradicts") return "contradicts_ending";
  if (newName(t, f)) return "new_name";
  return null;
}

/** A new finale from the model that passes every check, or null. */
export async function writeFinale(f: StoryFacts, models: StoryModels, usage: Usage[]): Promise<string | null> {
  const asked = await askTwice(models, repairMessages(f), (raw) => {
    const finale = parseFinale(raw);
    return finale && !finaleRefusal(finale, f) ? finale : null;
  }, 0.7, REPAIR_ANSWER_TOKENS, usage);
  return asked.value;
}

/* ------------------------------------------------ one date ------------------------------------------------ */

export type StoryCheckRow = {
  episode_id: string;
  verdict: StoryVerdict;
  reason: string;
  repaired: boolean;
  finale_before: string | null;
  model: string | null;
  prompt_version: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  checked_at: string;
};
type RawRow = Omit<StoryCheckRow, "cost_usd" | "checked_at"> & { cost_usd: string | number | null; checked_at: string | Date };
const toRow = (r: RawRow): StoryCheckRow => ({ ...r, cost_usd: r.cost_usd === null ? null : Number(r.cost_usd), checked_at: new Date(r.checked_at).toISOString() });

/** What the calls cost: the provider's own figure when it gives one (OpenRouter does), else list price, else unknown. */
export function usageCost(usage: readonly Usage[], at: Date = new Date()): { input_tokens: number; output_tokens: number; cost_usd: number | null } {
  let cost = 0;
  let priced = true;
  for (const u of usage) {
    const p = priceFor(u.model, at);
    if (typeof u.cost === "number") cost += u.cost;
    else if (p) cost += (u.input * p.input + u.output * p.output) / 1e6;
    else priced = false;
  }
  return {
    input_tokens: usage.reduce((n, u) => n + u.input, 0),
    output_tokens: usage.reduce((n, u) => n + u.output, 0),
    cost_usd: !usage.length ? 0 : priced ? Math.round(cost * 1e6) / 1e6 : null,
  };
}

export type CheckRefusal = "episode_not_found" | "not_public" | "not_aired";

/** Only a public date between public characters, aired and not hidden by reports, is judged (the stranger's view). */
export function checkRefusal(view: EpisodeView | null): CheckRefusal | null {
  if (!view) return "episode_not_found";
  if (view.visibility !== "public" || view.hidden || view.characters.some((c) => c.private)) return "not_public";
  if (!view.revealed || !view.ending) return "not_aired";
  return null;
}

export type CheckOptions = {
  /** The judge's models; null: none (the rules). Default: the show's paid model, when configured. */
  models?: StoryModels | null;
  /** Rewrite a contradicting finale (default STORY_CHECK_REPAIR). */
  repair?: boolean;
  now?: Date;
};

/**
 * Judges one aired public date as a stranger reads it, repairs its finale when it contradicts and the record allows,
 * and keeps the row (one per date: a second check replaces the verdict, and keeps the first finale_before). `busy`: the
 * provider refused for rate or credit, so a sweep stops there.
 */
export async function checkEpisode(db: Db, episodeId: string, opts: CheckOptions = {}): Promise<{ row: StoryCheckRow; busy: boolean } | { error: CheckRefusal }> {
  const now = opts.now ?? new Date();
  const view = await getEpisodeView(db, episodeId, null);
  const refusal = checkRefusal(view);
  if (refusal) return { error: refusal };
  const facts = storyFacts(view!)!;
  const models = opts.models !== undefined ? opts.models : storyModels();
  const before = (await db.query<{ verdict: string; finale_before: string | null }>(`select verdict, finale_before from story_checks where episode_id = $1`, [episodeId])).rows[0] ?? null;
  const usage: Usage[] = [];
  const first = await judgeStory(facts, models, usage);
  let verdict: Judgement = first;
  let repaired = false;
  let finaleBefore: string | null = null;
  if (first.verdict === "contradicts" && first.model !== "rules" && models && (opts.repair ?? storyRepairOn())) {
    const finale = await writeFinale(facts, models, usage);
    // Judged again by the model alone: a repair stands only on the model's word, never on the rules'.
    const again = finale ? await askTwice(models, judgeMessages({ ...facts, finale }), parseVerdict, 0.2, JUDGE_ANSWER_TOKENS, usage) : null;
    if (finale && again?.value && again.value.verdict !== "contradicts") {
      // Only the finale, only while it is still the one judged, and only on a date that is still public and aired.
      const written = await db.query(
        `update episodes set finale = $2 where id = $1 and finale = $3 and visibility = 'public' and revealed_at is not null returning id`,
        [episodeId, finale, view!.finale ?? ""],
      );
      if (written.rows.length) {
        repaired = true;
        finaleBefore = before?.finale_before ?? view!.finale ?? "";
        verdict = { verdict: again.value.verdict, reason: clip(`${first.reason} Repaired: ${again.value.reason}`, REASON_MAX * 2), model: again.model };
      }
    }
  }
  const spent = usageCost(usage, now);
  const { rows } = await db.query<RawRow>(
    `insert into story_checks (episode_id, verdict, reason, repaired, finale_before, model, prompt_version, input_tokens, output_tokens, cost_usd, checked_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     on conflict (episode_id) do update set verdict = excluded.verdict, reason = excluded.reason,
       repaired = story_checks.repaired or excluded.repaired, finale_before = coalesce(story_checks.finale_before, excluded.finale_before),
       model = excluded.model, prompt_version = excluded.prompt_version, input_tokens = excluded.input_tokens,
       output_tokens = excluded.output_tokens, cost_usd = excluded.cost_usd, checked_at = excluded.checked_at
     returning episode_id, verdict, reason, repaired, finale_before, model, prompt_version, input_tokens, output_tokens, cost_usd, checked_at`,
    [episodeId, verdict.verdict, verdict.reason, repaired, finaleBefore, verdict.model, STORY_CHECK_PROMPT_VERSION, spent.input_tokens, spent.output_tokens, spent.cost_usd, now.toISOString()],
  );
  // The featured places read from a few seconds' shared copy (lib/shared-cache.ts): a date taken off them, put back, or
  // given a new finale shows at once.
  if (repaired || verdict.verdict === "contradicts" || before?.verdict === "contradicts") clearSharedCache();
  return { row: toRow(rows[0]), busy: first.busy === true };
}

/**
 * An admin's undo of a repair: the finale it replaced goes back, and the date is contradicts again (what it was judged
 * before the repair), so it stays off the featured places and the sweep leaves it alone.
 */
export async function undoRepair(db: Db, episodeId: string): Promise<{ ok: true; finale: string } | { error: "not_repaired" }> {
  const row = (await db.query<{ finale_before: string | null }>(`select finale_before from story_checks where episode_id = $1 and repaired`, [episodeId])).rows[0];
  if (row?.finale_before == null) return { error: "not_repaired" };
  await db.query(`update episodes set finale = $2 where id = $1`, [episodeId, row.finale_before]);
  await db.query(
    `update story_checks set verdict = 'contradicts', repaired = false, finale_before = null, reason = 'The repair was undone by an admin: the original finale is back.', checked_at = now() where episode_id = $1`,
    [episodeId],
  );
  clearSharedCache();
  return { ok: true, finale: row.finale_before };
}

/* ------------------------------------------------ the sweep ------------------------------------------------ */

/**
 * The aired public dates with no row yet that the sweep checks next, at most `limit`, and how many there are in all.
 * First what is featured or about to be: the dates with a fresh home clip (the newest clip first: the one home plays),
 * then the home page's standout list in its own order (its top `standoutLimit` of the last STANDOUT_DAYS, best first:
 * the hero's excerpt and the 18+ gate pick from it); then the newest, back `backfillDays` (never less than the
 * standout list's week, so a new date is always checked). A date whose lines aren't all in yet (none, or only the
 * start: lib/backfill.ts writes the rest later) waits until they are.
 */
export async function storyCheckCandidates(db: Db, now: Date, limit: number, backfillDays: number, standoutLimit: number = STANDOUT_LIMIT): Promise<{ ids: string[]; total: number }> {
  const { rows } = await db.query<{ id: string; total: number }>(
    `with pool as (
       select e.id, e.revealed_at,
              (select max(c.created_at) from home_clips c where c.episode_id = e.id and c.created_at > $1::timestamptz - make_interval(days => $5::int)) as clip_at,
              e.revealed_at > $1::timestamptz - make_interval(days => $3::int) as recent,
              ${STANDOUT_SCORE_SQL} as score,
              exists (select 1 from story_checks sc where sc.episode_id = e.id) as checked
         from episodes e
         join characters a on a.id = e.character_a
         join characters b on b.id = e.character_b
        where e.status = 'ready' and e.visibility = 'public' and e.revealed_at is not null and e.revealed_at <= $1::timestamptz
          and a.visibility = 'public' and b.visibility = 'public'
          and (select count(*) from reports r where r.episode_id = e.id) < $2::int
          and (case when jsonb_typeof(e.transcript) = 'array' then jsonb_array_length(e.transcript) else 0 end) > 0
          and not coalesce((e.generated_with->>'transcript_partial')::boolean, false)
          and (e.revealed_at > $1::timestamptz - make_interval(days => greatest($6::int, $3::int))
               or exists (select 1 from home_clips c where c.episode_id = e.id and c.created_at > $1::timestamptz - make_interval(days => $5::int)))
     ),
     ranked as (
       select id, revealed_at, clip_at, checked,
              case when recent then row_number() over (partition by recent order by score desc, revealed_at desc, id) end as standout
         from pool
     )
     select id, (count(*) over ())::int as total
       from ranked
      where not checked
      order by clip_at desc nulls last, case when standout <= $4::int then standout end asc nulls last, revealed_at desc, id
      limit $7`,
    [now.toISOString(), REPORT_HIDE_THRESHOLD, STANDOUT_DAYS, standoutLimit, CLIP_FRESH_DAYS, backfillDays, limit],
  );
  return { ids: rows.map((r) => r.id), total: rows[0]?.total ?? 0 };
}

export type SweepResult = {
  checked: number;
  consistent: number;
  hidden_truth: number;
  reversal: number;
  contradicts: number;
  repaired: number;
  /** Judged by the $0 rules (no paid model, or two failed calls). */
  by_rules: number;
  failed: number;
  /** Unchecked dates still in the window after this pass. */
  left: number;
  /** The provider refused for rate or credit: the pass stopped early; the rest wait for the next. */
  stopped: boolean;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
  ms: number;
};

export type SweepOptions = { limit?: number; backfillDays?: number; budgetMs?: number; concurrency?: number; models?: StoryModels | null; repair?: boolean; env?: Env };

/**
 * One pass of the story check (the hourly lobby job; POST /api/admin/story-check {backfill}). Off with STORY_CHECK=0.
 * Judges at most STORY_CHECK_PER_HOUR dates (featured first), a few at a time, and starts none after `budgetMs`.
 */
export async function storyCheckSweep(db: Db, now: Date = new Date(), opts: SweepOptions = {}): Promise<SweepResult | { off: true }> {
  const env = opts.env ?? process.env;
  if (!storyCheckOn(env)) return { off: true };
  const started = Date.now();
  const limit = opts.limit ?? storyCheckPerHour(env);
  const budgetMs = opts.budgetMs ?? SWEEP_BUDGET_MS;
  const { ids, total } = limit > 0 ? await storyCheckCandidates(db, now, limit, opts.backfillDays ?? storyCheckBackfillDays(env)) : { ids: [], total: 0 };
  const models = opts.models !== undefined ? opts.models : ids.length ? storyModels() : null;
  const out: SweepResult = { checked: 0, consistent: 0, hidden_truth: 0, reversal: 0, contradicts: 0, repaired: 0, by_rules: 0, failed: 0, left: 0, stopped: false, input_tokens: 0, output_tokens: 0, cost_usd: 0, ms: 0 };
  const queue = [...ids];
  const worker = async () => {
    while (queue.length && !out.stopped && Date.now() - started < budgetMs) {
      const id = queue.shift()!;
      try {
        const done = await checkEpisode(db, id, { models, now, repair: opts.repair ?? storyRepairOn(env) });
        if ("error" in done) {
          out.failed++;
          continue;
        }
        const r = done.row;
        out.checked++;
        out[r.verdict]++;
        if (r.repaired && r.verdict !== "contradicts") out.repaired++;
        if (r.model === "rules") out.by_rules++;
        out.input_tokens += r.input_tokens ?? 0;
        out.output_tokens += r.output_tokens ?? 0;
        out.cost_usd = out.cost_usd === null || r.cost_usd === null ? null : out.cost_usd + r.cost_usd;
        if (done.busy) out.stopped = true;
      } catch (err) {
        out.failed++;
        console.warn("[story-check] a check failed:", err instanceof Error ? err.message.slice(0, 160) : "unknown");
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? SWEEP_CONCURRENCY, ids.length)) }, worker));
  out.left = Math.max(0, total - out.checked);
  out.cost_usd = out.cost_usd === null ? null : Math.round(out.cost_usd * 1e6) / 1e6;
  out.ms = Date.now() - started;
  // Counts and cost only, never a date or its words (docs/analytics.md).
  if (ids.length) track("story_check", { ...out });
  return out;
}

/* ------------------------------------------------ the counts ------------------------------------------------ */

export type StoryCounts = {
  days: number;
  /** Aired public dates between public characters in the window. */
  aired: number;
  checked: number;
  consistent: number;
  hidden_truth: number;
  reversal: number;
  /** Still contradicting: kept off the featured places. */
  contradicts: number;
  /** Contradicting as written and mended (their verdict is the one after the repair). */
  repaired: number;
  by_rules: number;
  /** The writer's share: contradicting as written (still, or before a repair) of those checked; null with none checked. */
  written_contradicts_share: number | null;
  cost_usd: number;
};

/** The verdicts on the dates aired in the last `days` (by when they aired, so a writer change shows in its own week). */
export async function storyCountsFor(db: Db, days: number, now: Date = new Date()): Promise<StoryCounts> {
  const r = (
    await db.query<Record<string, number | string | null>>(
      `select count(*)::int as aired, count(sc.episode_id)::int as checked,
              count(*) filter (where sc.verdict = 'consistent')::int as consistent,
              count(*) filter (where sc.verdict = 'hidden_truth')::int as hidden_truth,
              count(*) filter (where sc.verdict = 'reversal')::int as reversal,
              count(*) filter (where sc.verdict = 'contradicts')::int as contradicts,
              count(*) filter (where sc.repaired and sc.verdict <> 'contradicts')::int as repaired,
              count(*) filter (where sc.verdict = 'contradicts' or sc.repaired)::int as written,
              count(*) filter (where sc.model = 'rules')::int as by_rules,
              coalesce(sum(sc.cost_usd), 0)::float8 as cost_usd
         from episodes e
         join characters a on a.id = e.character_a
         join characters b on b.id = e.character_b
         left join story_checks sc on sc.episode_id = e.id
        where e.status = 'ready' and e.visibility = 'public' and e.revealed_at is not null
          and e.revealed_at > $1::timestamptz - make_interval(days => $2::int) and e.revealed_at <= $1::timestamptz
          and a.visibility = 'public' and b.visibility = 'public'`,
      [now.toISOString(), days],
    )
  ).rows[0];
  const n = (k: string) => Number(r?.[k] ?? 0);
  return {
    days,
    aired: n("aired"),
    checked: n("checked"),
    consistent: n("consistent"),
    hidden_truth: n("hidden_truth"),
    reversal: n("reversal"),
    contradicts: n("contradicts"),
    repaired: n("repaired"),
    by_rules: n("by_rules"),
    written_contradicts_share: n("checked") ? Math.round((n("written") / n("checked")) * 1000) / 1000 : null,
    cost_usd: Math.round(n("cost_usd") * 1e6) / 1e6,
  };
}

export type StoryCheckCounts = { on: boolean; repair: boolean; last_7: StoryCounts; last_30: StoryCounts };

export async function storyCheckCounts(db: Db, now: Date = new Date(), env: Env = process.env): Promise<StoryCheckCounts> {
  const [last_7, last_30] = await Promise.all([storyCountsFor(db, 7, now), storyCountsFor(db, 30, now)]);
  return { on: storyCheckOn(env), repair: storyRepairOn(env), last_7, last_30 };
}
