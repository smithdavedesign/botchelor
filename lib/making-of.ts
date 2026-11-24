/**
 * The making of Botchelor (app/making-of, 2026-11-23): the site as it grew, day by day, from the screenshots its pull
 * requests committed. lib/making-of-data.json is written by `node scripts/making-of/collect.mjs page` from git and
 * scripts/making-of/picks.json (which screenshots, their captions, the episodes' words); nothing here reads the database,
 * so the page is the same for everyone and costs nothing to serve.
 */
import raw from "./making-of-data.json";

export const MAKING_OF_PATH = "/making-of";
/** The repository is public (since 2026-11-14): every frame links to the pull request that brought it. */
export const REPO_URL = "https://github.com/smithdavedesign/botchelor";

export type Pic = { src: string; w: number; h: number };
/**
 * One screenshot at two widths: a card for lists and the stage on a phone, the full one for big screens and the viewer;
 * `from` is the file in docs/screenshots it was cut from.
 */
export type Shot = { card: Pic; full: Pic; from: string };
export type Frame = {
  pr: number;
  /** The Pacific day the pull request merged, "YYYY-MM-DD". */
  day: string;
  /** The pull request's own title. */
  title: string;
  /** What's on screen, in a few words. */
  caption: string;
  desktop?: Shot;
  phone?: Shot;
};
export type Day = { day: string; prs: number };
export type Chapter = { id: string; from: string; to: string; title: string; blurb: string };
export type DayOneCommit = { time: string; pr: number | null; title: string };
export type MakingOf = {
  first: string;
  last: string;
  dayOne: DayOneCommit[];
  totals: { prs: number; byClaude: number; issues: number; screenshots: number; days: number };
  days: Day[];
  chapters: Chapter[];
  frames: Frame[];
};

export const MAKING_OF = raw as MakingOf;

export const prUrl = (pr: number) => `${REPO_URL}/pull/${pr}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const parts = (day: string) => day.split("-").map(Number) as [number, number, number];

/** "2026-10-21" → "Oct 21" (the day as written, no time zone in play). */
export function shortDay(day: string): string {
  const [, m, d] = parts(day);
  return `${MONTHS[m - 1]} ${d}`;
}

/** "2026-10-21" → "Tue, Oct 21". */
export function longDay(day: string): string {
  const [y, m, d] = parts(day);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${MONTHS[m - 1]} ${d}`;
}

/** Day 1 is the first commit's day. */
export function dayNumber(day: string, first: string = MAKING_OF.first): number {
  const at = (s: string) => Date.UTC(...(parts(s).map((n, i) => (i === 1 ? n - 1 : n)) as [number, number, number]));
  return Math.round((at(day) - at(first)) / 86_400_000) + 1;
}

/** "Oct 13–19", or "Oct 27–Nov 2" across a month. */
export function dayRange(from: string, to: string): string {
  const [, m1] = parts(from);
  const [, m2, d2] = parts(to);
  return m1 === m2 ? `${shortDay(from)}–${d2}` : `${shortDay(from)}–${shortDay(to)}`;
}

/** The episode a day falls in (the last one when it's past every range). */
export function chapterOf(day: string, chapters: Chapter[] = MAKING_OF.chapters): Chapter {
  return chapters.find((c) => day >= c.from && day <= c.to) ?? chapters[chapters.length - 1];
}

/** Each episode with its frames and how many pull requests merged in it. */
export function episodes(data: MakingOf = MAKING_OF): (Chapter & { n: number; frames: Frame[]; prs: number })[] {
  return data.chapters.map((c, i) => ({
    ...c,
    n: i + 1,
    frames: data.frames.filter((f) => chapterOf(f.day, data.chapters).id === c.id),
    prs: data.days.filter((d) => d.day >= c.from && d.day <= c.to).reduce((s, d) => s + d.prs, 0),
  }));
}

/** Pull requests merged up to and including each day. */
export function runningTotals(days: Day[]): Map<string, number> {
  const out = new Map<string, number>();
  let sum = 0;
  for (const d of days) out.set(d.day, (sum += d.prs));
  return out;
}

/** The day the most pull requests merged (the earliest, on a tie). */
export function busiestDay(days: Day[]): Day {
  return days.reduce((best, d) => (d.prs > best.prs ? d : best), days[0]);
}

/**
 * What the stage shows at frame i: the newest desktop and phone shots up to it, so the laptop and the phone are never
 * empty once each has had a picture, and which of the two this frame changed.
 */
export function stageAt(frames: Frame[], i: number): { desktop: Shot | null; phone: Shot | null } {
  let desktop: Shot | null = null;
  let phone: Shot | null = null;
  for (let j = 0; j <= i && j < frames.length; j++) {
    if (frames[j].desktop) desktop = frames[j].desktop!;
    if (frames[j].phone) phone = frames[j].phone!;
  }
  // Before the first of a kind, show the first one there is, so the stage starts full.
  desktop ??= frames.find((f) => f.desktop)?.desktop ?? null;
  phone ??= frames.find((f) => f.phone)?.phone ?? null;
  return { desktop, phone };
}

/** The frame a day lands on when scrubbing: the last frame on or before it, else the first. */
export function frameForDay(frames: Frame[], day: string): number {
  let at = 0;
  frames.forEach((f, i) => {
    if (f.day <= day) at = i;
  });
  return at;
}

/** Share of the merged pull requests Claude Code opened, as a whole percent. */
export const claudeShare = (t: MakingOf["totals"]) => (t.prs ? Math.round((t.byClaude / t.prs) * 100) : 0);
