/**
 * A date's report card (David 2026-11-20, growth playbook "viral shareable moments"): an aired date graded like a school
 * report, one letter per subject (chemistry, attraction, trust, awkwardness) and one overall, with each character's own
 * verdict and the quote of the night. A page anyone can open (/episodes/<id>/report-card) and a share card
 * (/api/og/report-card/<id>), made from what the date already stored: no model call, nothing new saved.
 *
 * It names the ending, so it exists only once the finale has aired, and only from what a logged-out spectator may see
 * (getEpisodeView with no viewer): the same rule as the aired episode page, which prints the ending anyway.
 *
 * Grades are on a curve. The engine's numbers don't read as school marks (a typical chemistry is 70, a typical trust
 * 48), so each subject is graded against how aired dates actually scored: REPORT_CURVE is their 10th, 25th, 50th, 75th
 * and 90th percentiles (prod, 693 aired dates, 2026-11-20). A middling date is a B-; the best tenth get an A; awkwardness
 * is graded the other way round (less is better). Pure: the page, the card and the tests share it.
 */
import type { BoxScore, EpisodeView } from "./game";
import { DATE_VARIABLES, type DateVariable, endingWithDetail, dateNumberOf, VARIABLE_GOOD_WHEN_HIGH, VARIABLE_LABELS } from "./rules";

/** The share tag on a report card link (app/funnel.ts BEACON_REFS → source report_share, lib/engagement.ts). */
export const REPORT_REF = "report";

export const reportCardPath = (episodeId: string) => `/episodes/${encodeURIComponent(episodeId)}/report-card`;
/** What a share of it links to: the page, tagged so its visitors are told apart. */
export const sharedReportCardPath = (episodeId: string) => `${reportCardPath(episodeId)}?ref=${REPORT_REF}`;
export const reportCardImagePath = (episodeId: string) => `/api/og/report-card/${encodeURIComponent(episodeId)}`;
/** The picture at 9:16 (1080×1920): for a phone's stories, and the daily video's report beat (scripts/clips). */
export const REPORT_STORY = "story";
export const reportCardStoryPath = (episodeId: string) => `${reportCardImagePath(episodeId)}?format=${REPORT_STORY}`;

/** Aired dates' final scores at the 10th, 25th, 50th, 75th and 90th percentiles (prod, 2026-11-20, n = 693). */
export const REPORT_CURVE: Record<DateVariable, readonly [number, number, number, number, number]> = {
  chemistry: [63, 66, 70, 74, 78],
  attraction: [51, 55, 59, 66, 73],
  trust: [39, 44, 48, 53, 58],
  awkwardness: [30, 33, 38, 42, 46],
};
const KNOTS = [10, 25, 50, 75, 90] as const;
/** Past the ends of the curve, this many points more (or less) reaches 100 (or 0). */
const TAIL = 15;

/**
 * Where a score sits among aired dates, 0–100 (higher is a better date for that subject): linear between the curve's
 * points, and on past them to 0 and 100. Awkwardness is turned round, so a low awkwardness ranks high.
 */
export function rankOf(variable: DateVariable, score: number): number {
  const curve = REPORT_CURVE[variable];
  const v = Number.isFinite(score) ? score : curve[2];
  let rank: number;
  if (v <= curve[0]) rank = Math.max(0, KNOTS[0] * (1 - (curve[0] - v) / TAIL));
  else if (v >= curve[4]) rank = Math.min(100, KNOTS[4] + (100 - KNOTS[4]) * ((v - curve[4]) / TAIL));
  else {
    let i = 0;
    while (v > curve[i + 1]) i++;
    const span = curve[i + 1] - curve[i] || 1;
    rank = KNOTS[i] + (KNOTS[i + 1] - KNOTS[i]) * ((v - curve[i]) / span);
  }
  return VARIABLE_GOOD_WHEN_HIGH[variable] ? rank : 100 - rank;
}

/** The letters, best first, with the lowest rank each needs. */
const GRADES = [
  ["A+", 95],
  ["A", 85],
  ["A-", 75],
  ["B+", 65],
  ["B", 55],
  ["B-", 45],
  ["C+", 35],
  ["C", 25],
  ["D", 12],
  ["F", 0],
] as const;
export type Grade = (typeof GRADES)[number][0];
export const ALL_GRADES: readonly Grade[] = GRADES.map(([g]) => g);

export const gradeOf = (rank: number): Grade => (GRADES.find(([, min]) => rank >= min) ?? GRADES[GRADES.length - 1])[0];

/** The colour family a grade is drawn in: the page's class and the card's ink. */
export const gradeTone = (g: Grade): "a" | "b" | "c" | "f" => (g.startsWith("A") ? "a" : g.startsWith("B") ? "b" : g.startsWith("C") ? "c" : "f");

export type Subject = { variable: DateVariable; label: string; score: number; delta: number; grade: Grade; comment: string };

/** The teacher's note on one subject: how it moved over the night, in words. */
function commentOn(variable: DateVariable, delta: number): string {
  const up = delta > 0;
  const size = Math.abs(delta);
  if (size < 3) return "Held steady all night";
  const much = size >= 15 ? "a lot" : size >= 8 ? "" : "a little";
  if (variable === "awkwardness") return up ? `Got ${much ? `${much} ` : ""}more awkward as it went` : `Eased off${much ? ` ${much}` : ""} as it went`;
  return `${up ? "Rose" : "Fell"}${much ? ` ${much}` : ""} over the night`;
}

/** The four subjects, in the box score's order (a missing one is left out). */
export function subjectsOf(box: BoxScore): Subject[] {
  return DATE_VARIABLES.flatMap((variable) => {
    const arc = box[variable];
    if (!arc || !Number.isFinite(arc.final)) return [];
    const delta = Number.isFinite(arc.delta) ? arc.delta : 0;
    return [{ variable, label: VARIABLE_LABELS[variable], score: arc.final, delta, grade: gradeOf(rankOf(variable, arc.final)), comment: commentOn(variable, delta) }];
  });
}

/** The overall grade: the four subjects' ranks, averaged. */
export function overallGrade(box: BoxScore): Grade {
  const ranks = subjectsOf(box).map((s) => rankOf(s.variable, s.score));
  return gradeOf(ranks.length ? ranks.reduce((t, r) => t + r, 0) / ranks.length : 50);
}

export type Verdict = { characterId: string; name: string; kind: "see_again" | "diary"; seeAgain?: "yes" | "maybe" | "no"; line: string | null };

const SEE_AGAIN_WORDS = { yes: "Would see them again", maybe: "Maybe again", no: "Wouldn't see them again" } as const;
export const seeAgainWords = (s: "yes" | "maybe" | "no") => SEE_AGAIN_WORDS[s];

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
/** A verdict line or the quote on the card stays this short; the page shows them whole. */
export const CARD_LINE_MAX = 110;
export const clipForCard = (s: string, max = CARD_LINE_MAX) => clip(s.replace(/\s+/g, " ").trim(), max);

/**
 * Each character's own verdict, when the public may see it: their answer to "would you see them again?" and why (living
 * dates, once aired), else their diary-cam line. Nothing for a side the public may not see.
 */
export function verdictsOf(episode: Pick<EpisodeView, "characters" | "inner" | "diary">): Verdict[] {
  return episode.characters.flatMap((c): Verdict[] => {
    const choice = episode.inner?.choices.find((x) => x.character_id === c.id);
    if (choice) return [{ characterId: c.id, name: c.name, kind: "see_again" as const, seeAgain: choice.see_again, line: choice.reason?.trim() || null }];
    const diary = episode.diary?.find((d) => d.character_id === c.id)?.line?.trim();
    return diary ? [{ characterId: c.id, name: c.name, kind: "diary" as const, line: diary }] : [];
  });
}

export type ReportCard = {
  episodeId: string;
  names: [string, string];
  overall: Grade;
  ending: string;
  subjects: Subject[];
  verdicts: Verdict[];
  quote: string | null;
};

/**
 * The report card for what a viewer may see of a date, or null when there isn't one to show: the finale hasn't aired
 * (no ending or box score for a spectator), or the date is private or hidden.
 */
export function reportCardOf(episode: EpisodeView | null): ReportCard | null {
  if (!episode || episode.hidden || !episode.revealed || episode.visibility === "private" || !episode.ending || !episode.box_score) return null;
  const subjects = subjectsOf(episode.box_score);
  if (!subjects.length) return null;
  const [a, b] = episode.characters;
  return {
    episodeId: episode.id,
    names: [a.name, b.name],
    overall: overallGrade(episode.box_score),
    ending: endingWithDetail(episode.ending, dateNumberOf(episode), episode.ending_detail),
    subjects,
    verdicts: verdictsOf(episode),
    quote: episode.best_line?.trim() || null,
  };
}

/** The headline a shared report card carries: its og:title and the words on Reddit or Bluesky. */
export const reportCardTitle = (card: Pick<ReportCard, "names" | "overall" | "ending">) =>
  `${card.names[0]} × ${card.names[1]} got ${/^[AF]/.test(card.overall) ? "an" : "a"} ${card.overall} on their AI blind date (${card.ending.toLowerCase()})`;

/** The preview's description: each subject's letter in a line. */
export const reportCardDescription = (card: Pick<ReportCard, "subjects">) =>
  `${card.subjects.map((s) => `${s.label} ${s.grade}`).join(" · ")}. The date report card from Botchelor, where AI characters go on blind dates nobody steers.`;

/** The episode page this card came from, with the share tag (the "Watch the date" link). */
export const episodeFromReportCard = (episodeId: string) => `/episodes/${encodeURIComponent(episodeId)}?ref=${REPORT_REF}`;

const query = (params: Record<string, string>) =>
  Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");

export const reportRedditShareUrl = (url: string, card: Pick<ReportCard, "names" | "overall" | "ending">) => `https://www.reddit.com/submit?${query({ url, title: reportCardTitle(card) })}`;
export const reportBlueskyShareUrl = (url: string, card: Pick<ReportCard, "names" | "overall" | "ending">) => `https://bsky.app/intent/compose?${query({ text: `${reportCardTitle(card)} 📝 ${url}` })}`;
