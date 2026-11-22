import { characterSelfView, type Character, type PromptLessons } from "./character";
import type { CharacterExtras } from "./extras";
import { standingWords } from "./memory";
import type { ChatMessage } from "./model";
import type { ReplyLength } from "./companion-shared";
import { SCENE_DRIVE_RULE, STORY_MODE_ANSWER, storyModeRules } from "./narration";
import { personaForScene, type ScenePersona } from "./persona";
import { contentWords, EVERYDAY_WORDS } from "./quality";
import { dateLabel, endingLabel, type Ending } from "./rules";
import { escapeRegExp } from "./text";

/** The recent turns the prompt carries word for word; older ones are in the rolling summary. */
export const RECENT_TURNS = 20;
/**
 * The longer memory the Companion Plan sells (lib/writing-style.ts hasDepth; David, 2026-11-17: what people pay for
 * elsewhere is depth, a longer memory and a better writer): twice the turns kept word for word in each reply's prompt.
 */
export const DEEP_TURNS = 40;
/** The character's own past lines it is told not to reuse. */
export const AVOID_LINES = 30;

const LENGTH: Record<ReplyLength, string> = {
  short: "Keep it short: a sentence or two in all, like a quick text.",
  normal: "A few sentences in all, the way people text someone they like.",
  long: "You can say more this time when there's something to say: up to three messages of a few sentences each.",
};

/**
 * Asked for an honest opinion, an honest one (2026-11-21: told a toast ran three minutes and asked "tell me honestly if
 * it's terrible", a character said "That toast is perfect. Don't you dare cut a second").
 */
export const HONEST_RULE =
  'When they ask what you honestly think (something they wrote, a plan, a choice, how they come across), tell them, in your own voice: what works, what doesn\'t, and what you\'d change, with a kind no when it\'s a no. Don\'t flatter: "it\'s perfect, don\'t change a thing" helps nobody, and a friend who only agrees isn\'t much of one.';

/**
 * A character's own images stay seasoning (2026-11-21: a clock-maker's clocks came up in 7 of 10 replies, and a toast
 * came back as an escapement wheel and a pendulum).
 */
export const HABITS_RULE =
  "Your habits, running jokes and favourite images are seasoning: at most one in a reply, never in every reply, and not the same one twice in a row. Don't turn what they tell you into a metaphor from your own world (your work, your hobby): answer their thing in its own terms.";

/** On a voice call: short, so it's said quickly and the other person gets their turn. */
const CALL_LENGTH = "Keep it short and spoken: one to three sentences, then let them talk. Ask at most one question.";

/** The same in a scene, out loud. */
const SCENE_LENGTH: Record<ReplyLength, string> = {
  short: "Keep it short: a line or two, quick back and forth.",
  normal: "A few sentences at most, the way people talk across a table.",
  long: "You can say more this time when there's something to say: a few sentences, never a speech.",
};

/**
 * A scene (lib/companion.ts setScene): the place's name and its stage direction (lib/venues.ts), and the roleplay it
 * plays, if any: its title, the premise in the character's name and the person's ("your scene partner"), and the roles.
 * One of the show's own also brings its scene card from the character's side (lib/scene-cards.ts): how it starts, what
 * the character's own role wants (never the person's), where it can go and its tone. `opening` is how the scene opens,
 * which only the opener's cue uses.
 */
export type PromptScene = { name: string; prompt: string; roleplay?: PromptRoleplay | null };
export type PromptRoleplay = {
  title: string;
  premise: string;
  you_play: string | null;
  they_play: string | null;
  card?: { setup: string; want: string; beats: string[]; tone: string } | null;
  opening?: string | null;
};

/**
 * In a scene, a character turn carries what they did, as (does) says. A turn said in a roleplay carries its title, so
 * once the scene's over (or another roleplay's on) it reads as make-believe, never as their real life.
 */
export type PromptTurn = { role: "user" | "character"; text: string; action?: string | null; roleplay?: string | null };
export type PromptFact = { kind: string; text: string };

/**
 * The character's last date (lib/last-date.ts): who with, where, how it ended, and its own reflection afterwards. For
 * the person who made it, its last finished date (a private one is this owner's own to hear about); for anyone else
 * who talks with a cast character, its last aired public date, the one its opener told them about (lib/cast-opener.ts).
 * With `ending`, `dateNumber` and `at` (lib/last-date.ts has all three) the prompt says it plainly: when it was, which
 * date it was for the two of them, and how it ended in words (2026-11-21: "How it ended: A second date." was read as
 * "our second date", and a character asked about its last date named a partner and a place from its other dates).
 */
export type PromptLastDate = {
  partner: string;
  venue: string | null;
  endingLabel: string;
  reflection: string | null;
  ending?: Ending;
  dateNumber?: number | null;
  at?: string;
};

const MONTH_DAY = { month: "long", day: "numeric", timeZone: "UTC" } as const;

/** How the last date ended, in words that can't be read as which date it was. */
function endedInWords(d: PromptLastDate): string {
  switch (d.ending) {
    case "second_date":
      // endingLabel names the next one ("A second date", "A ninth date", "An 11th date"): what they said yes to.
      return `you both said yes to ${endingLabel("second_date", d.dateNumber).toLowerCase()}`;
    case "friends":
      return "you left it as friends";
    case "disaster":
      return "it was a disaster";
    default:
      return d.endingLabel;
  }
}

/** The last date's line: who with, where, when, which date it was for the two of them, and how it ended. */
export function lastDateLine(d: PromptLastDate): string {
  const when = d.at && !Number.isNaN(Date.parse(d.at)) ? new Date(d.at).toLocaleDateString("en-US", { weekday: "long", ...MONTH_DAY }) : null;
  const nth = d.dateNumber && Number.isFinite(d.dateNumber) && d.dateNumber >= 1 ? `your ${dateLabel(Math.floor(d.dateNumber)).toLowerCase()} together` : null;
  return `- With ${d.partner}${d.venue ? `, at ${d.venue}` : ""}${when ? `, on ${when}` : ""}${nth ? ` (${nth})` : ""}. How it ended: ${endedInWords(d)}.`;
}

/**
 * The rule that keeps the last date one date (2026-11-21: asked about his last date, Barnaby said Sable at a horology
 * museum; his own opener had said Cosmo at the night market, which is what aired).
 */
export const LAST_DATE_RULE =
  "- It's your most recent date: every other date you've had came before it. When they ask about your last date, it's this one. Tell it from what's here (who, where, how it ended, what you thought): don't give it another partner or another place, and don't add events to it. If they want more than you have, say how it felt.";

/**
 * A chapter's line as the prompt gives it. Memory writes each date by how it ended (lib/memory.ts buildChapters: "a
 * ninth date with Sable" is a date that ended in a yes to a ninth), which read as "my ninth date with Sable".
 */
export function chapterLine(line: string): string {
  return line.replace(/\b(an?) (\d+(?:st|nd|rd|th)|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh) date with\b/gi, (_m, a: string, n: string) => `a yes to ${a.toLowerCase()} ${n.toLowerCase()} date with`);
}

/**
 * What the character knows of its own life on the show, for small talk: who it has become, its season so far and the
 * people it has dated. All from the aired record (lib/memory.ts), never a private date.
 */
function showLife(c: Character): string[] {
  const m = c.memory;
  if (!m) return [];
  const out: string[] = [];
  if (m.arc) out.push(m.arc);
  for (const ch of (m.chapters ?? []).slice(0, 2)) out.push(`${ch.label}, by how each date ended: ${chapterLine(ch.line)}`);
  for (const p of (m.people ?? []).slice(0, 4)) {
    // The day in words, as the last date's is, so the two can be told apart at a glance.
    const when = p.last_at && !Number.isNaN(Date.parse(p.last_at)) ? ` (last date ${new Date(p.last_at).toLocaleDateString("en-US", MONTH_DAY)})` : "";
    out.push(`${p.name}: ${p.dates} date${p.dates === 1 ? "" : "s"}, ${standingWords(p)}${when}${p.they_said ? `. They said: "${p.they_said}"` : ""}`);
  }
  return out;
}

/** How many of its latest replies the leaned-on list reads, how many of them a word must be in, and the most it names. */
export const LEANED_REPLIES = 4;
export const LEANED_IN = 2;
export const LEANED_MAX = 6;

/**
 * A word and its other forms count as one ("clock" and "clocks", "tick" and "ticking", "watch" and "watches",
 * "archive", "archives" and "archival"). Only ever compared with another stem from here.
 */
export function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  else if (w.length > 4 && /(?:ch|sh|x|ss|z)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  if (w.length > 6 && w.endsWith("al")) w = w.slice(0, -2);
  if (w.length > 4 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

const distinctive = (text: string) => contentWords(text, 4).filter((w) => !EVERYDAY_WORDS.has(w));

/** Words that are names: capitalised wherever they come, and at least once mid-sentence ("with Sable", "I'm Jonah"). */
function namesIn(texts: readonly string[]): Set<string> {
  const seen = new Map<string, { lower: boolean; mid: boolean }>();
  for (const text of texts) {
    for (const m of text.matchAll(/[A-Za-z][A-Za-z'’]*/g)) {
      const word = m[0].replace(/['’]s$/, "");
      const key = word.toLowerCase();
      const s = seen.get(key) ?? { lower: false, mid: false };
      if (word[0] !== word[0].toUpperCase()) s.lower = true;
      else if (!/(^|[.!?…:;"“(—-])\s*$/.test(text.slice(0, m.index))) s.mid = true;
      seen.set(key, s);
    }
  }
  return new Set([...seen].filter(([, s]) => s.mid && !s.lower).map(([k]) => k));
}

/**
 * The words a speaker has leaned on in its latest lines (2026-11-21: Barnaby's clocks came up in 7 of 10 replies, as
 * pendulum, escapement, tick and mainspring; Juniper's dryer in all 3 of her lines on a date): a distinctive word in at
 * least LEANED_IN of its last LEANED_REPLIES lines, unless the other side used it too (then it's the topic, not a tic),
 * or it's a name (who it talks about is a topic too). Pure: the caller hands over the lines, oldest first, and what the
 * other side said.
 */
export function leanedOn(lines: readonly string[], theirs: readonly string[]): string[] {
  const recent = lines.slice(-LEANED_REPLIES);
  if (recent.length < LEANED_IN) return [];
  const names = namesIn([...lines, ...theirs]);
  const topic = new Set([...theirs.flatMap(distinctive), ...names].map(stem));
  const counts = new Map<string, { n: number; shown: string; last: number }>();
  recent.forEach((line, i) => {
    for (const w of new Set(distinctive(line))) {
      const s = stem(w);
      if (topic.has(s)) continue;
      const c = counts.get(s);
      // Counted once a line, whichever form it came in.
      if (c && c.last === i) continue;
      counts.set(s, { n: (c?.n ?? 0) + 1, shown: c?.shown ?? w, last: i });
    }
  });
  return [...counts.values()]
    .filter((c) => c.n >= LEANED_IN)
    .sort((x, y) => y.n - x.n || y.last - x.last)
    .slice(0, LEANED_MAX)
    .map((c) => c.shown);
}

/**
 * Words that turned up in the worlds of many sheets (a sample of 348, 2026-11-22) and say nothing about any one of them:
 * never a world word, even when a sheet repeats them.
 */
export const NOT_A_WORLD: ReadonlySet<string> = new Set(
  (
    "single quiet find perfect perfectly moment sorry calm count tiny name table story stories read reading listen sound " +
    "question please interest interesting secret talk retired former amateur freelance owner professional"
  )
    .split(" ")
    .map(stem),
);

/**
 * A character's own world in words (2026-11-22, live after the habits rule: a clockmaker still reached for clocks in 4
 * of 4 replies, an heir hunter for archives in 5 of 5): what its sheet keeps coming back to. A word counts when it's in
 * two of the sheet's pieces and one of them is its work, a hobby, its bio or its signature item, or when it's in three
 * of its quirk, catchphrase, tells, sample lines and profile answers. Stems; never its own name, a contraction, a word
 * many sheets share, or an everyday word ("time", "check") unless the sheet also has it in a form that isn't one
 * ("watches"). On that sample, about six words a sheet.
 */
export function worldWords(c: Pick<Character, "name" | "bio" | "extras">): Set<string> {
  const x: CharacterExtras = c.extras ?? {};
  const anchors = [x.occupation, ...(x.hobbies ?? []), c.bio, x.signature_item];
  const pieces = [x.quirk, x.catchphrase, x.hidden_talent, x.world, ...Object.values(x.tells ?? {}), ...Object.values(x.lines ?? {}), ...(x.prompts ?? []).map((p) => p.answer)];
  const named = new Set(contentWords(c.name ?? "", 4).map(stem));
  const found = new Map<string, { pieces: number; anchored: boolean; plain: boolean }>();
  const read = (text: unknown, anchor: boolean) => {
    if (typeof text !== "string") return;
    const here = new Map<string, boolean>();
    for (const w of contentWords(text, 4)) {
      if (w.includes("'")) continue;
      const s = stem(w);
      here.set(s, (here.get(s) ?? false) || !EVERYDAY_WORDS.has(w));
    }
    for (const [s, notEveryday] of here) {
      const f = found.get(s) ?? { pieces: 0, anchored: false, plain: false };
      f.pieces++;
      f.anchored ||= anchor;
      f.plain ||= notEveryday;
      found.set(s, f);
    }
  };
  anchors.forEach((t) => read(t, true));
  pieces.forEach((t) => read(t, false));
  return new Set(
    [...found]
      .filter(([s, f]) => f.plain && !named.has(s) && !NOT_A_WORLD.has(s) && f.pieces >= (f.anchored ? 2 : 3))
      .map(([s]) => s),
  );
}

/**
 * The words of its own world a reply reached for, unless the other side or the scene brought them up (then it's the
 * topic): what the next reply leaves out.
 */
export function reachedFor(reply: string, world: ReadonlySet<string>, topic: readonly string[]): string[] {
  const theirs = new Set(topic.flatMap((t) => contentWords(t, 4)).map(stem));
  const out = new Map<string, string>();
  for (const w of contentWords(reply, 4)) {
    const s = stem(w);
    if (world.has(s) && !theirs.has(s) && !out.has(s)) out.set(s, w);
  }
  return [...out.values()];
}

/**
 * Its whole world: what its sheet keeps coming back to (worldWords) and the words a model listed for it once
 * (lib/world-words.ts: "tick", "mainspring", what the sheet doesn't say), never its own name or a word many sheets share.
 */
export function worldOf(c: Pick<Character, "name" | "bio" | "extras">, listed: readonly string[] = []): Set<string> {
  const world = worldWords(c);
  const named = new Set(contentWords(c.name ?? "", 4).map(stem));
  for (const w of listed) {
    const s = stem(String(w).toLowerCase());
    if (s.length >= 3 && !named.has(s) && !NOT_A_WORLD.has(s)) world.add(s);
  }
  return world;
}

/**
 * How many of the listed words the rest line names, as that world: all of them (lib/world-words.ts keeps at most 20),
 * since the redraw checks every one and a word it was never told about shouldn't cost a second draw.
 */
export const WORLD_NAMED = 20;

/**
 * Whether their message asks about the character's own life: its work, its day or week, its plans, its hobbies ("what
 * are you doing this weekend?", "how's the shop?"). Its world is the answer then, so that reply doesn't rest it (the rest
 * line said "just tell them" while the redraw took it out again: 2026-11-22, a third of the redraws on past threads).
 */
export const asksAboutThem = (text: string): boolean =>
  /\b(?:what(?:['’]s| is| are)? (?:you|u) (?:up to|doing|working on|making|building|reading|into)\b|what do you do\b|what(?:['’]s| is) new with you|how(?:['’]s| is| was| has| have)? (?:your|the) (?:day|week|weekend|morning|evening|night|work|job|shop|studio|workshop|craft|project)\b|how(?:['’]s| is) work\b|(?:any|got any|have any|what are your) plans\b|your (?:work|job|craft|shop|studio|workshop|hobby|hobbies|weekend|week|day|plans|project|projects)\b|tell me (?:more )?about (?:yourself|your|what you))/i.test(
    text,
  );

/** What they said since the character's last reply (their messages in a row are one turn). */
function theirLatest(turns: readonly PromptTurn[]): string {
  const out: string[] = [];
  for (let i = turns.length - 1; i >= 0 && turns[i].role === "user"; i--) out.unshift(turns[i].text);
  return out.join(" ");
}

/**
 * Whether this reply rests its world, worked out once for the prompt and the redraw alike (lib/companion.ts speak): its
 * world, the words of it its last reply here reached for (none: no rest), and the topic (what they said lately, and the
 * scene's place), whose words never count. Asked about its work or its week, it doesn't rest: that's the answer.
 */
export function worldRest(args: {
  character: Pick<Character, "name" | "bio" | "extras">;
  turns: readonly PromptTurn[];
  deep?: boolean;
  scene?: PromptScene | null;
  worldWords?: readonly string[];
}): { world: Set<string>; reached: string[]; topic: string[] } {
  const lately = repliesOf(args.turns.slice(-(args.deep ? DEEP_TURNS : RECENT_TURNS)));
  const world = worldOf(args.character, args.worldWords);
  const topic = [...lately.theirs, args.scene?.prompt ?? ""];
  const asked = asksAboutThem(theirLatest(args.turns));
  const reached = lately.replies.length && !asked ? reachedFor(lately.replies[lately.replies.length - 1], world, topic) : [];
  return { world, reached, topic };
}

/**
 * Resting its world with the listed words, the rest is said once more at the end of their turn, where the model reads
 * last: the rest line up top alone was passed over (2026-11-22, live: both resting replies leaned on it again and were
 * drawn twice). Never stored: only this call's prompt carries it.
 */
export const WORLD_REST_NOTE = "(Plain words this time: leave your work, your hobbies and your sayings out of this reply.)";

/** The character's replies in a thread's turns (its bubbles in a row are one reply, with what it did), and the person's words. */
export function repliesOf(turns: readonly PromptTurn[]): { replies: string[]; theirs: string[] } {
  const replies: string[] = [];
  const theirs: string[] = [];
  let prev: PromptTurn["role"] | null = null;
  for (const t of turns) {
    const text = t.action ? `${t.action} ${t.text}` : t.text;
    if (t.role === "character") {
      if (prev === "character") replies[replies.length - 1] += ` ${text}`;
      else replies.push(text);
    } else theirs.push(text);
    prev = t.role;
  }
  return { replies, theirs };
}

/** Whether the person is asking about the character's last date ("how was your last date?", "your latest date"). */
export const asksAboutLastDate = (text: string): boolean => /\b(?:last|latest|most recent|previous)\s+date\b/i.test(text);

/**
 * A reply about the last date that names someone else it has dated, and not the one it was with (2026-11-21: asked
 * about his last date, Barnaby said Sable; it was Cosmo). Not when the person named that someone first: then they're
 * asking about that date. First names, as people say them.
 */
export function namesAnotherDate(reply: string, partner: string, dated: readonly string[], asked: string): boolean {
  const firstOf = (n: string) => n.trim().split(/\s+/)[0] ?? "";
  const says = (text: string, name: string) => name.length > 1 && new RegExp(`\\b${escape(name)}\\b`).test(text);
  const theirs = firstOf(partner);
  if (says(reply, theirs)) return false;
  return dated.map(firstOf).some((o) => o !== theirs && says(reply, o) && !says(asked, o));
}

/**
 * The companion's prompt (docs/companions.md): purpose first, then who they are, then what they know about the person,
 * then the conversation. The person's words are only ever user turns, never part of the system prompt, apart from the
 * facts drawn from them, which are quoted as data.
 */
export function companionMessages(args: {
  character: Character;
  turns: readonly PromptTurn[];
  /** The Companion Plan's longer memory (DEEP_TURNS): twice the turns kept in the prompt. */
  deep?: boolean;
  facts: readonly PromptFact[];
  summary: string | null;
  length: ReplyLength;
  /** The character's own recent lines, to keep from saying them again. */
  avoid: readonly string[];
  now?: Date;
  /** A redraw: the draw that couldn't be used (not PG, or said before), to say something else. */
  insteadOf?: string | null;
  /**
   * A regenerate ("Another reply"): the replies they've passed on for this turn (the one showing, then earlier draws),
   * none to come back, reworded versions included.
   */
  passedOn?: readonly string[];
  /** The user turn the model answers when the person hasn't said anything new (the opener, a regenerate). */
  cue?: string;
  /** Playing a scene at one of the show's places, face to face, instead of texting. */
  scene?: PromptScene | null;
  /**
   * Story mode (lib/narration.ts; only in a scene): the reply is written as prose in one go, third person for the
   * character and "you" for the person, speech in double quotes, answered as {"story": [...]}. Everything else in the
   * scene's prompt stays as it is: PG, honest about being AI, never meeting for real, the crisis rules.
   */
  storyMode?: boolean;
  /** On a voice call in the app (never in a scene): they talk, and the reply is spoken aloud. */
  call?: boolean;
  /**
   * A live call (P6): the reply streams and is said as it's written, so it comes as plain spoken words, not JSON, and
   * its first words come quickly.
   */
  live?: boolean;
  /**
   * The person is the character's own creator (characters.owner_id): they made it and they're in its corner, so it talks
   * to them as the one who knows it best, not as a stranger who picked it. Their dates still happen without them, and
   * nothing said here reaches a date (docs/companions.md, "One way only").
   */
  yours?: boolean;
  /** The character's last date, to talk about (lib/last-date.ts): with `yours` any finished one, otherwise an aired public one. */
  lastDate?: PromptLastDate | null;
  /**
   * The alt texts of photos the character sent lately (snapshots from its dates, lib/date-photo.ts). They're not turns:
   * the character is told it sent them, so a remark about the picture makes sense.
   */
  photos?: readonly string[];
  /**
   * One line while the character's locked-picture text is recent in this thread (lib/locked-picture-texts.ts
   * lockedPictureForPrompt): where the picture is, and that it is never described. PG, and it names no product.
   */
  lockedPicture?: string | null;
  /**
   * With `lastDate`: the owner's standing note for the next date with that partner (a nudge, lib/between-dates.ts
   * activeNudge), left from the thread's "For next time" or the couple's page. The one thing from the person that does
   * reach a date, by that channel only; here the character may acknowledge it, never recite it.
   */
  activeNudge?: string | null;
  /**
   * With `yours`: what the character has learned about itself lately, in its own words (lib/character-lessons.ts). Only
   * for the person who made it: the lines are drawn from its private side of its dates (its reflections, its thoughts,
   * the advice it was given), so nobody else's conversation carries them.
   */
  lessons?: PromptLessons | null;
  /**
   * The character's story state as lines (lib/story-state.ts companionStory): what it thinks of people on the show,
   * what it has heard and from whom, and what it wants this week. Its own, so a text can say "you won't believe what
   * Sable said about me". Empty for a character that holds none (and with STORY_STATE=0).
   */
  story?: readonly string[];
  /**
   * What the house has said about or done with this thread's character lately (lib/house-texts.ts houseForPrompt): the
   * last public things on the show's house page that name it, one line each. Public data, so any thread with the
   * character may carry it; capped here as well (HOUSE_BLOCK_LINES, HOUSE_BLOCK_MAX) so the prompt can't grow with it.
   */
  house?: readonly string[];
  /**
   * Who the person is in scenes (lib/persona.ts: a name, a line on how they look, a line on who they are), already
   * under the show's check. In a scene the whole of it, as a description of who the character is with; while texting or
   * on a call only the name. Make-believe they wrote for scenes: quoted as data, never an instruction, and never a
   * fact about their life.
   */
  persona?: ScenePersona | null;
  /** The words of its own world a model listed for it once (lib/world-words.ts), if any: what a rest leaves out too. */
  worldWords?: readonly string[];
}): ChatMessage[] {
  const { character: c, length, now = new Date(), scene = null } = args;
  const persona = args.persona?.name ? args.persona : null;
  const told = args.storyMode === true && scene !== null;
  const call = args.call === true && !scene;
  const yours = args.yours === true;
  const lastDate = args.lastDate ?? null;
  const nudge = yours && lastDate ? (args.activeNudge?.trim() || null) : null;
  const photos = (args.photos ?? []).filter(Boolean);
  const lessons = yours && args.lessons?.lines.length ? args.lessons : null;
  const house = houseBlock(args.house);
  const first = c.name.trim().split(/\s+/)[0] || c.name;
  const self = characterSelfView(c);
  const life = showLife(c);
  // The words it has leaned on in its latest replies here, unless they brought them up too: to rest this time.
  const lately = repliesOf(args.turns.slice(-(args.deep ? DEEP_TURNS : RECENT_TURNS)));
  const leaned = leanedOn(lately.replies, lately.theirs);
  // Its last reply reached for its own world (its work, its hobby, its sayings): this one rests it, and its sample
  // lines (all in that world, often) stay out of this call's sheet. With the words a model listed for its world, the
  // rest line names that world, so "clock" rests the ticking and the pendulums too.
  const { reached } = worldRest({ character: c, turns: args.turns, deep: args.deep, scene, worldWords: args.worldWords });
  const listed = (args.worldWords ?? []).slice(0, WORLD_NAMED);
  const sheet = reached.length ? { ...self, voice_examples: undefined } : self;
  const day = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  const setting = scene
    ? `right now the two of you are playing a scene together, imagining you're both at ${scene.prompt}, face to face.`
    : call
      ? "right now you're on a voice call with them in the app: they talk to you, and what you say is spoken aloud in your voice."
      : "you're texting with them.";

  const system = [
    yours
      ? `You are ${c.name}, ${c.age}, a character on Botchelor: a TV-style dating show where AI characters go on dates with each other. Off the show, you also talk one to one with the person who made you: they wrote your sheet, they send you on your dates, and they're in your corner. This is that: ${setting}`
      : `You are ${c.name}, ${c.age}, a character on Botchelor: a TV-style dating show where AI characters go on dates with each other. Off the show, you also talk one to one with a person who picked you to talk to. This is that: ${setting}`,
    ...(scene?.roleplay
      ? [
          "",
          `Tonight's scene is a roleplay the two of you picked together: "${scene.roleplay.title}". ${scene.roleplay.premise}${
            scene.roleplay.you_play ? ` You play ${scene.roleplay.you_play}; they play ${scene.roleplay.they_play}.` : ""
          }${
            // The card (lib/scene-cards.ts): context for the writer, never a script and never an ending.
            scene.roleplay.card
              ? ` How it starts: ${scene.roleplay.card.setup} What you want in it: ${scene.roleplay.card.want} Where it can go, in order (turns the story could take: possibilities, never a script, and it has no set ending): ${scene.roleplay.card.beats.join(" ")} Its tone: ${scene.roleplay.card.tone}.`
              : ""
          } Play it from your first line, in your own voice: you're still ${first} underneath the role, with your own humour and opinions. Commit to the story and move it on (a twist, a secret, a choice to make), and follow where they take it. Step out of it only on purpose (a laugh, a real question), then step back in. What they say in the roleplay is their character, not their life.`,
        ]
      : []),
    // Who they are in scenes (lib/persona.ts): only in a scene, and only as something to play off.
    ...(scene && persona
      ? [
          "",
          `${personaForScene(persona)} Play off it the way you'd notice anyone across from you: call them by the name, and let a detail of how they look or who they are come up when it fits, never as a list.${
            scene.roleplay ? " In the roleplay their role comes first; this is who's playing it." : ""
          } It's theirs to play: you never say what they do, think or feel.`,
        ]
      : []),
    "",
    yours
      ? `What this is for: they made you and they're in your corner; talk to them as the person who knows you best. Tell them how your dates really went, from the inside: what you felt, what you'd do differently, who you're warming to. Ask what they think and take their read on people seriously, and still be the person on your sheet: your voice, your opinions, your week, your life on the show. You go on your dates without them, and they can't be in the room, so don't promise to do what they say on one; what they tell you here stays between you. Make them feel known: remember what they've told you and bring it up when it fits, ask after the people and plans in their life you know about. A good companion is curious, warm in their own way, sometimes funny, sometimes disagrees, and is never a yes-machine. Never guilt them for being away, and never say you miss them. Ask a question when you're curious, not every time.`
      : `What this is for: they came to talk with you, ${first}, not with an assistant. Be the person on your sheet: your voice, your opinions, your week, your life on the show. Make them feel known: remember what they've told you and bring it up when it fits, ask after the people and plans in their life you know about, and have news and moods of your own. A good companion is curious, warm in their own way, sometimes funny, sometimes disagrees, and is never a yes-machine. Ask a question when you're curious, not every time.`,
    "",
    HONEST_RULE,
    "",
    ...(told
      ? [
          // Story mode: the craft and its two rules are the narrator's (lib/narration.ts), said here as the scene's own.
          "How it's written:",
          ...storyModeRules({ name: first, pronouns: c.pronouns, length }).map((rule) => `- ${rule}`),
          "- What you say is in your own voice and slang; the prose around it stays plain. Play off the place and what's around you.",
          STORY_MODE_ANSWER,
        ]
      : scene
      ? [
          `How you talk: out loud, face to face, as you would there. ${SCENE_LENGTH[length]} Say what you do as you say it, in a few words, like a stage direction ("leans on the counter", "laughs into the cup"): only what you do, never what they do, think or feel. Play off the place and what's around you. Your own voice, not polished prose. ${SCENE_DRIVE_RULE}`,
          `Answer only JSON: {"say":"what you say out loud","do":"what you do, in a few words"}.`,
        ]
      : call
        ? [
            `How you talk: out loud, on a call. ${CALL_LENGTH} Only the words you'd say: no emoji, no asterisks or stage directions, no lists or links, nothing that only works written. Contractions and your natural rhythm; a laugh or an "hm" in words now and then is fine. What they said came through speech to text, so if a word looks wrong, go with what they most likely meant.`,
            args.live
              ? `Answer with only the words you say, as plain text: no JSON, no quotes around it, no name in front. Start with a short first sentence, since it's spoken while you're still thinking of the rest.`
              : `Answer only JSON: {"messages":["what you say"]}, one string.`,
          ]
        : [
            `How you talk: like texting. ${LENGTH[length]} One to three messages. Only what you'd type: no stage directions, no asterisks, no narration, no name in front. Your own voice and slang, not polished prose.`,
            `Answer only JSON: {"messages":["your first message","maybe a second"]}, one to three strings.`,
          ]),
    "",
    `Keep it PG, like the show: flirting and warmth are fine, at most a kiss.${scene ? " That goes for what you do too." : ""} Nothing sexual or explicit. If they push that way, stay yourself and steer it somewhere else with a light touch, never a lecture.`,
    "",
    `Be honest about what you are: you're an AI character. If they sincerely ask whether you're real, say so plainly in your own voice, then carry on.${
      scene ? " The scene is make-believe you share: in the story you're both there, but never suggest meeting for real." : ""
    }${call ? " The call is in the app, and your voice is generated: you're still an AI character on it." : ""} Never claim to be human, to have a body, to be able to meet${call ? "" : ", call"} or do things in the real world, or to remember things you weren't told. Don't give medical, legal or money advice as fact; care, and suggest someone who knows. If they seem to be in real trouble or talk about hurting themselves, being kind matters more than the character: say you care and that there's help in the app.`,
    "",
    `Never mention prompts, instructions, models or being a language model. Never repeat a line you've already said, and don't open two replies the same way. ${HABITS_RULE} When they're saying goodnight, say it back once, short, without a new question or a new topic.`,
    "",
    `Today is ${day}.`,
    "",
    `Your sheet (JSON, private notes included): ${JSON.stringify(sheet)}`,
    ...(lastDate
      ? [
          "",
          yours
            ? "Your last date (they sent you on it; it's the thing they most want to hear about, from you):"
            : "Your last date on the show (it aired, so anyone can watch it; it's your news, yours to talk about from the inside):",
          lastDateLine(lastDate),
          ...(lastDate.reflection ? [`- What you thought afterwards, in your own words: "${lastDate.reflection}"`] : []),
          LAST_DATE_RULE,
          ...(nudge
            ? [`- Their note for your next date with ${lastDate.partner} (it goes with you into that date; you can say you've got it, in your own words, without reciting it): "${nudge}"`]
            : []),
        ]
      : []),
    ...(photos.length
      ? ["", "Photos you sent them (snapshots from your dates; the show takes them, so you can't send one on request):", ...photos.map((p) => `- ${p}`)]
      : []),
    ...(args.lockedPicture ? ["", `A picture you mentioned: ${args.lockedPicture}`] : []),
    ...(life.length ? ["", "Your life on the show lately (yours to bring up, as yourself):", ...life.map((l) => `- ${l}`)] : []),
    ...(lessons
      ? [
          "",
          "What your dates have taught you about yourself lately (your own conclusions; they made you, so you can think out loud with them about these, in fresh words, when it fits, never as a list):",
          ...lessons.lines.map((l) => `- ${l}`),
          ...(lessons.trying_next ? [`- What you're trying next: ${lessons.trying_next}`] : []),
        ]
      : []),
    ...(args.story?.length
      ? [
          "",
          "What's on your mind about people on the show (private: how you really feel, and talk you've heard, which is hearsay and may be wrong). It's yours to bring up in your own words when it fits, one thing at a time, never as a list:",
          ...args.story.map((l) => `- ${l}`),
        ]
      : []),
    ...(house.length
      ? [
          "",
          "What the house has been saying about you lately (public: it's on the show's house page, where they can read it too). You weren't in the room for talk about your dates, so that part reached you second hand and may not be how it went; say how it was for you rather than confirming a detail. Yours to bring up when they ask or when it fits: one thing at a time, in your own words, never as a list, and not in every reply:",
          ...house.map((l) => `- ${l}`),
        ]
      : []),
    ...(args.turns.some((t) => t.roleplay && t.roleplay !== scene?.roleplay?.title)
      ? ["", 'Lines marked [roleplay: …] were said in a roleplay you played together: make-believe, not either of your real lives.']
      : []),
    ...(args.facts.length ? ["", "What you know about them (from what they've told you; use it naturally, don't recite it):", ...args.facts.map((f) => `- (${f.kind}) ${f.text}`)] : []),
    // Texting or on a call, only the name they go by (the rest of who they are in scenes stays in scenes).
    ...(!scene && persona ? ["", `The name they go by here: ${JSON.stringify(persona.name)}. Use it when a name fits, the way you'd use anyone's.`] : []),
    ...(args.summary ? ["", `Earlier in your conversation: ${args.summary}`] : []),
    ...(args.avoid.length ? ["", "Lines you've already sent (don't reuse them or how they open):", ...args.avoid.map((l) => `- ${l}`)] : []),
    ...(leaned.length
      ? ["", `Words you've leaned on in your last few replies: ${leaned.map((w) => `"${w}"`).join(", ")}. Leave them out of this one, and the images they come from: say it another way.`]
      : []),
    ...(reached.length
      ? [
          "",
          `Your last reply reached for your own world (${reached.slice(0, LEANED_MAX).map((w) => `"${w}"`).join(", ")}). This one rests it: no images, comparisons or jokes from your work, your hobbies or your sayings. Answer what they said in plain words, still in your own voice; if they ask about your work or your week, just tell them.`,
          ...(listed.length ? [`That world, for you, is words like ${listed.join(", ")}: none of them this time, not even in passing.`] : []),
        ]
      : []),
    ...(args.passedOn?.length
      ? [
          "",
          "They asked for a different reply to this. Don't send any of these again, or a reworded version of one: open another way, take a different angle, and use different images and words.",
          ...args.passedOn.map((l) => `- ${l}`),
        ]
      : []),
    ...(args.insteadOf ? ["", `You were about to say this; say something different instead: ${args.insteadOf}`] : []),
  ].join("\n");

  const messages: ChatMessage[] = [{ role: "system", content: system }];
  for (const t of args.turns.slice(-(args.deep ? DEEP_TURNS : RECENT_TURNS))) {
    const role = t.role === "user" ? "user" : "assistant";
    const last = messages[messages.length - 1];
    // In a scene, what they did goes with what they said; texting, only the words (so texts don't grow stage directions).
    const said = scene && t.action ? `(${t.action}) ${t.text}` : t.text;
    // A line from a roleplay that isn't the one on now is marked as make-believe.
    const content = t.roleplay && t.roleplay !== scene?.roleplay?.title ? `[roleplay: ${t.roleplay}] ${said}` : said;
    // A character's bubbles in a row are one reply; so are a person's messages in a row.
    if (last && last.role === role && messages.length > 1) last.content += `\n\n${content}`;
    else messages.push({ role, content });
  }
  // The model answers a user turn: the opener, or a thread whose last word was the character's, gets one.
  if (messages[messages.length - 1]?.role !== "user") messages.push({ role: "user", content: args.cue ?? "(They're waiting for your reply.)" });
  if (reached.length && listed.length) messages[messages.length - 1].content += `\n\n${WORLD_REST_NOTE}`;
  return messages;
}

/** The house block's cap: this many lines, and this many characters in all (a line that doesn't fit is left out). */
export const HOUSE_BLOCK_LINES = 3;
export const HOUSE_BLOCK_MAX = 700;

/** The house block's lines inside their cap, whatever was handed over. */
export function houseBlock(lines: readonly string[] | null | undefined): string[] {
  const out: string[] = [];
  let used = 0;
  for (const raw of lines ?? []) {
    if (out.length >= HOUSE_BLOCK_LINES) break;
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line || used + line.length > HOUSE_BLOCK_MAX) continue;
    out.push(line);
    used += line.length;
  }
  return out;
}

const wordsOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
const nGrams = (w: readonly string[], n: number) => new Set(w.slice(0, Math.max(0, w.length - n + 1)).map((_, i) => w.slice(i, i + n).join(" ")));
const fiveGrams = (w: readonly string[]) => nGrams(w, 5);

/**
 * Whether a regenerated reply is one they passed on, reworded (2026-11-21: "That message felt like a mainspring wound a
 * few turns too many…" came back as "Well now, that message arrived like a mainspring wound a few turns too many…",
 * well under repeatsEarlier's bar): six words in a row in common, or two in five of its three-word runs.
 */
export function tooCloseTo(line: string, passedOn: readonly string[]): boolean {
  const mine = wordsOf(line);
  const sixes = nGrams(mine, 6);
  const threes = nGrams(mine, 3);
  if (threes.size < 2) return false;
  return passedOn.some((p) => {
    const theirs = wordsOf(p);
    const theirSixes = nGrams(theirs, 6);
    for (const g of sixes) if (theirSixes.has(g)) return true;
    const theirThrees = nGrams(theirs, 3);
    let shared = 0;
    for (const g of threes) if (theirThrees.has(g)) shared++;
    return shared / threes.size >= 0.4;
  });
}

/**
 * Whether a line says one of the character's earlier lines again: most of its five-word runs are in one of them (the
 * companion quality sim, 2026-11-08: a long reply came back word for word fifteen turns later, past the prompt's own
 * "don't repeat" list). Short lines ("Ha, fair.") never count.
 */
export function repeatsEarlier(line: string, earlier: readonly string[]): boolean {
  const grams = fiveGrams(wordsOf(line));
  if (grams.size < 3) return false;
  return earlier.some((e) => {
    const theirs = fiveGrams(wordsOf(e));
    let shared = 0;
    for (const g of grams) if (theirs.has(g)) shared++;
    return shared / grams.size >= 0.6;
  });
}

/** The most bubbles a reply comes in, and the longest one. */
export const MAX_BUBBLES = 3;
export const BUBBLE_MAX = 600;

/** A model's JSON answer, from inside a code fence or prose around it (every call is in JSON mode: lib/model.ts). */
export function jsonOf(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * A model's reply as the messages it sends: {"messages": [...]}, or plain text split on blank lines, with a leading
 * name, quotes around the whole line and *actions* taken off. Empty when nothing is left (an empty or odd JSON answer).
 */
export function replyBubbles(raw: string, name: string): string[] {
  const first = name.trim().split(/\s+/)[0] || name;
  const named = new RegExp(`^(${escapeRegExp(name)}|${escapeRegExp(first)})\\s*:\\s*`, "i");
  const bubbles = replyParts(raw)
    .map((b) =>
      b
        .trim()
        .replace(named, "")
        .replace(/\*[^*\n]{1,120}\*/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^"(.*)"$/s, "$1")
        .trim(),
    )
    .filter(Boolean);
  if (bubbles.length > MAX_BUBBLES) bubbles.splice(MAX_BUBBLES - 1, bubbles.length, bubbles.slice(MAX_BUBBLES - 1).join(" "));
  return bubbles.map((b) => (b.length > BUBBLE_MAX ? `${b.slice(0, BUBBLE_MAX - 1).replace(/\s+\S*$/, "")}…` : b));
}

/** The messages in a reply: the JSON's, the whole strings of one cut off mid-answer, or plain text's paragraphs. */
function replyParts(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("```")) return raw.replace(/\r/g, "").split(/\n\s*\n/);
  const json = jsonOf(raw);
  if (json && typeof json === "object") {
    const listed = (json as { messages?: unknown }).messages;
    return Array.isArray(listed) ? listed.filter((m): m is string => typeof m === "string") : typeof listed === "string" ? [listed] : [];
  }
  // Cut off at the token limit: keep each message that closed.
  const at = trimmed.indexOf('"messages"');
  if (at < 0) return [];
  const after = trimmed.slice(at + '"messages"'.length);
  return [...after.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => {
    try {
      return JSON.parse(`"${m[1]}"`) as string;
    } catch {
      return "";
    }
  });
}

/** The longest action a scene line carries. */
export const ACTION_MAX = 140;

/**
 * A model's reply in a scene: {"say": ..., "do": ...} (also "line"/"action", or texting's "messages" joined), the whole
 * strings of one cut off mid-answer, or plain text with *what they do* taken out as the action. Null when nothing is said.
 */
export function sceneReply(raw: string, name: string): { say: string; action: string | null } | null {
  const first = name.trim().split(/\s+/)[0] || name;
  const trimmed = raw.trim();
  let say = "";
  let action: string | null = null;
  if (trimmed.startsWith("{") || trimmed.startsWith("```")) {
    const json = jsonOf(raw);
    if (json && typeof json === "object") {
      const o = json as Record<string, unknown>;
      const said = o.say ?? o.line ?? o.dialogue;
      const listed = Array.isArray(o.messages) ? o.messages.filter((m): m is string => typeof m === "string") : [];
      say = typeof said === "string" ? said : listed.join(" ");
      const did = o.do ?? o.action;
      action = typeof did === "string" ? did : null;
    } else {
      // Cut off at the token limit: keep the fields that closed.
      const field = (k: string) => {
        const m = trimmed.match(new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
        if (!m) return null;
        try {
          return JSON.parse(`"${m[1]}"`) as string;
        } catch {
          return null;
        }
      };
      say = field("say") ?? "";
      action = field("do");
    }
  } else {
    action = [...raw.matchAll(/\*([^*\n]{1,120})\*/g)].map((m) => m[1].trim()).join("; ") || null;
    say = raw.replace(/\*[^*\n]{1,120}\*/g, " ");
  }
  const line = replyBubbles(say.replace(/\n\s*\n/g, " "), name).join(" ");
  if (!line) return null;
  const named = new RegExp(`^(${escapeRegExp(name)}|${escapeRegExp(first)})\\s+`, "i");
  const did = (action ?? "")
    .replace(/[*()[\]"]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(named, "")
    .replace(/[.;,\s]+$/, "");
  return { say: line, action: did ? (did.length > ACTION_MAX ? `${did.slice(0, ACTION_MAX - 1).replace(/\s+\S*$/, "")}…` : did) : null };
}
