/**
 * "Right now" (2026-11-16): two or three short lines at the top of a character's page that answer what is going on in
 * their life this minute: who they are seeing, after or feuding with, and the latest thing that happened. An outside
 * review's point: the profile opened on a sheet (age, job, bio) and the week's story sat two tabs away.
 *
 * Nothing is read for it. It is shaped from what the page already loaded for everyone, all of it public:
 *
 *  - the circle's ties (lib/story-map.ts: this week's public story map, strongest first);
 *  - Talk of the house (lib/character-talk.ts: /house's scenes as a stranger sees them, the producer's public line,
 *    the public layer of the graph);
 *  - the latest aired public date on the page's date record (lib/game.ts getCharacterDatesPage: aired and public only);
 *  - the page's "this week" line (lib/life.ts), which only ever fills a spare line: on its own it is not news.
 *
 * So it can't show anything the Talk and Dates tabs don't: nothing from the story state (opinions, heard, wants are
 * the owner's alone), nothing private or unaired, the same for every viewer, the owner included. A date whose other
 * half is private to someone else is left out. Pure: no clock, no database.
 *
 * A line never repeats the one above it: the latest thing is skipped when a tie already tells it (the scene a tie
 * links to, the date behind a pair's standing), and the next newest stands in.
 *
 * Empty is null, and the page then renders nothing at all: no box, no heading (most people's characters, and every
 * brand-new one). CHARACTER_NOW=0 turns the lines off without a deploy of code.
 */
import type { CharacterTalk, TalkAfter, TalkFriction, TalkSaid } from "./character-talk";
import { shortName } from "./names";
import { endingLabel, type Ending } from "./rules";
import type { CircleData, StoryTie } from "./story-map";

type Env = Record<string, string | undefined>;

/** CHARACTER_NOW: on unless it is "0". */
export const characterNowOn = (env: Env = process.env): boolean => env.CHARACTER_NOW?.trim() !== "0";

/** The most lines the block ever shows, and how many of them may be ties. */
export const NOW_LINES_MAX = 3;
export const NOW_TIES_MAX = 2;
/** A line the producer wrote about who is after whom counts as "now" for this many days; a standing on the graph has no age. */
export const NOW_LINE_DAYS = 14;
/** How much of a quoted line fits before it is cut at a word. */
export const NOW_QUOTE_MAX = 110;

export type NowLine = {
  key: string;
  kind: "tie" | "latest" | "week";
  icon: string;
  /** The line, in words. */
  text: string;
  /** What made it (the couple, the scene, the date); the week's line has none. */
  href: string | null;
  /** "since Sunday", "today": said quietly after the line. */
  when: string | null;
  /** Analytics: which kind of thing the line is. */
  track: string;
};

export type CharacterNow = {
  lines: NowLine[];
  /** There is a Talk tab with something in it: the block ends on "See the talk". */
  talk: boolean;
};

export type NowDate = {
  share_path: string;
  ending: Ending;
  date_number?: number | null;
  /** When it aired (ISO). */
  aired_at?: string | null;
  partner: { id: string; name: string; private?: boolean };
};

export type NowInput = {
  /** The character the page is about. */
  character: { id: string; name: string; private?: boolean };
  circle: CircleData | null;
  talk: CharacterTalk | null;
  /** The page's "this week" line, or null. */
  week: string | null;
  /** The newest date on the page's public record (aired, public), or null. */
  lastDate: NowDate | null;
  /** Today, YYYY-MM-DD (UTC): how old a producer's line may be. */
  today: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const cut = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, max - 1).replace(/\s+\S*$/, "")}…`);
const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const unstop = (s: string) => s.replace(/[.\s]+$/, "");

const TIE_ICONS: Record<StoryTie["kind"], string> = {
  date_now: "🎬",
  rivals: "👀",
  feuding: "⚡",
  date_next: "📅",
  cleared: "🤝",
  together: "💞",
  second_date: "💞",
  bad_blood: "🔥",
  stories: "⚡",
  talked: "🏠",
};

/** A tie of the week's map as this character's own line: "Rivals with Juniper for Sable". */
function tieWords(t: StoryTie, meId: string, me: string, other: string): string {
  switch (t.kind) {
    case "date_now":
      return `On a date with ${other} right now`;
    case "rivals":
      // The map's label is "rivals for Sable": who it is over is already a public name in it.
      return `Rivals with ${other}${t.label.replace(/^rivals/i, "")}`;
    case "feuding":
      return `Feuding with ${other}: ${t.label}`;
    case "date_next":
      return `A date with ${other} coming up`;
    case "cleared":
      return `Cleared the air with ${other}`;
    case "together":
      return t.label === "going steady" ? `Going steady with ${other}` : `Dating ${other}`;
    case "second_date":
      return `Second date agreed with ${other}`;
    case "bad_blood":
      return `Bad blood with ${other}`;
    case "stories":
      return `At odds with ${other}: ${t.label}`;
    case "talked":
      return t.a === meId ? `Talked about ${other} in the house` : `${other} talked about ${me} in the house`;
  }
}

/** "now" and "coming up" are already in the words. */
const tieWhen = (t: StoryTie): string | null => (t.when === "now" || t.when === "coming up" ? null : t.when);

const daysBetween = (day: string, today: string): number => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day.slice(0, 10)}T00:00:00Z`)) / DAY_MS);

function afterWords(a: TalkAfter, me: string): string {
  if (a.direction === "them") return `${a.other.name} is after ${me}`;
  if (a.direction === "theirs") return `After ${a.other.name}`;
  // The public standing, as the Talk tab says it: "Nell and Sable agreed to a second date."
  return unstop(a.text);
}

const saidWords = (l: TalkSaid): string => `${l.speaker.name}, ${l.where}: “${cut(l.text, NOW_QUOTE_MAX)}”`;
const frictionWords = (f: TalkFriction): string => [unstop(f.text), f.result ? unstop(f.result) : null].filter(Boolean).join(". ");

/**
 * The block's lines, or null when there is nothing to say. Ties first (the strongest two, one a person), then the
 * newest thing that happened (a line said about them, a confrontation or challenge, the day's line, or an aired
 * date), then the week's line if a line is spare.
 */
export function shapeNow(input: NowInput): CharacterNow | null {
  const { character: c, circle, talk, week, lastDate, today } = input;
  if (c.private) return null;
  const me = shortName(c.name);

  const ties: NowLine[] = [];
  const seen = new Set<string>();
  // Who each tie line is with: a tie on a couple's page already tells that pair's latest date.
  const withWhom = new Map<string, string>();
  for (const { person, tie } of circle?.around ?? []) {
    if (ties.length >= NOW_TIES_MAX) break;
    if (seen.has(person.id)) continue;
    seen.add(person.id);
    withWhom.set(`tie:${tie.id}`, person.id);
    ties.push({ key: `tie:${tie.id}`, kind: "tie", icon: TIE_ICONS[tie.kind], text: tieWords(tie, c.id, me, person.name), href: tie.href, when: tieWhen(tie), track: tie.kind });
  }
  // A character outside this week's map can still be with someone, or have someone after them: the Talk tab's rows.
  for (const a of talk?.after ?? []) {
    if (ties.length >= NOW_TIES_MAX) break;
    if (seen.has(a.other.id)) continue;
    // A producer's line ages; a standing on the public graph (a second date agreed, a couple) is current.
    if (a.direction !== "both" && (!a.day || daysBetween(a.day, today) > NOW_LINE_DAYS)) continue;
    seen.add(a.other.id);
    withWhom.set(`after:${a.key}`, a.other.id);
    ties.push({ key: `after:${a.key}`, kind: "tie", icon: a.direction === "both" ? "💞" : "👀", text: afterWords(a, me), href: a.href, when: null, track: `after-${a.direction}` });
  }
  for (const f of talk?.friction ?? []) {
    if (ties.length >= NOW_TIES_MAX) break;
    if (f.kind !== "bad_blood" || !f.other || seen.has(f.other.id)) continue;
    seen.add(f.other.id);
    withWhom.set(`friction:${f.key}`, f.other.id);
    ties.push({ key: `friction:${f.key}`, kind: "tie", icon: "🔥", text: unstop(f.text), href: f.href, when: null, track: "bad_blood" });
  }

  // The newest thing that happened. The talk's lists are newest first; bad blood is a standing, told above.
  // `with`: the date's other half, so a date a tie line already tells (their standing as a pair) isn't told twice.
  type Happened = { day: string; line: NowLine; with?: string };
  const happened: Happened[] = [];
  const said = talk?.said[0];
  if (said) happened.push({ day: said.day, line: { key: `said:${said.key}`, kind: "latest", icon: "🏠", text: saidWords(said), href: said.href, when: null, track: "said" } });
  const event = talk?.friction.find((f) => f.kind !== "bad_blood" && f.day);
  if (event) happened.push({ day: event.day!, line: { key: `event:${event.key}`, kind: "latest", icon: event.kind === "challenge" ? "🏆" : "⚡", text: frictionWords(event), href: event.href, when: null, track: event.kind } });
  if (lastDate && !lastDate.partner.private) {
    happened.push({
      // A date with no time on it is the oldest thing here: it only leads when nothing else happened.
      day: lastDate.aired_at ? lastDate.aired_at.slice(0, 10) : "",
      with: lastDate.partner.id,
      line: { key: `date:${lastDate.share_path}`, kind: "latest", icon: "📺", text: `Latest date, with ${shortName(lastDate.partner.name)}: ${endingLabel(lastDate.ending, lastDate.date_number)}`, href: lastDate.share_path, when: null, track: "date" },
    });
  }
  // Not what a tie line just said: the scene a tie links to (a confrontation is "Cleared the air with Dex" above), or
  // the date behind a pair's standing ("Bad blood with Juniper" is that date).
  const told = (h: Happened): boolean =>
    ties.some((t) => t.href === h.line.href || (h.with !== undefined && withWhom.get(t.key) === h.with && (t.href ?? "").startsWith("/couples/")));
  // Stable: on the same day the house's word leads (a scene about a date comes after the date).
  const latest =
    happened
      .filter((h) => !told(h))
      .map((h, i) => ({ h, i }))
      .sort((p, q) => q.h.day.localeCompare(p.h.day) || p.i - q.i)[0]?.h.line ?? null;

  const lines = [...ties, ...(latest ? [latest] : [])];
  if (!lines.length) return null;
  const weekLine = week?.trim();
  if (weekLine && lines.length < NOW_LINES_MAX) lines.push({ key: "week", kind: "week", icon: "🗓️", text: `This week: ${upperFirst(weekLine)}`, href: null, when: null, track: "week" });
  return { lines: lines.slice(0, NOW_LINES_MAX), talk: Boolean(talk && (!talk.empty || circle)) };
}
