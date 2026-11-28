/**
 * Ceremony night (David, 2026-11-27: "Do 1-6", the reality TV ideas after the format playbook). Two pieces of the rose
 * ceremony that the stored result already holds, told the way television tells it:
 *
 *  - The staged reveal (CEREMONY_REVEAL=0 turns it off): the roses go out one at a time, the last rose comes down to two
 *    faces, then who goes home. Built from a held ceremony's row (lib/ceremony.ts), so nothing here decides anything:
 *    the result was settled when the ceremony ran, and this is only the order it is shown in.
 *  - Exit interviews (EXIT_INTERVIEWS=0 turns them off): the suitor who went home says two or three lines to camera on
 *    the way out, in their own voice. Templates over the engine's verdict on their week and their public card's "when
 *    something goes wrong" line (publicExtras: never a private detail). $0, no model call. Written once, when the
 *    ceremony is held (ceremonies.exits).
 *
 * Pure and client-safe: the reveal runs in the browser (app/watch/CeremonyReveal.tsx).
 */
import type { CharacterExtras } from "./extras";
import type { Ending } from "./rules";

type Env = Record<string, string | undefined>;
export const ceremonyRevealOn = (env: Env = process.env): boolean => env.CEREMONY_REVEAL?.trim() !== "0";
export const exitInterviewsOn = (env: Env = process.env): boolean => env.EXIT_INTERVIEWS?.trim() !== "0";

export type NightFace = { id: string; name: string; hue: number | null; portrait: string | null; house: boolean };

/** One suitor's exit interview, as stored: who sent them home and what they said. */
export type ExitInterview = { id: string; by: "vote" | "lead"; lines: string[] };

/** What the verdict knew about their week with the lead (lib/ceremony.ts Verdict), for the words. */
export type ExitWeek = { dates: number; best: { ending: Ending; venue: string | null } | null; worst: { ending: Ending; venue: string | null } | null };

const MAX_LINE = 160;
const clip = (s: string) => (s.length > MAX_LINE ? `${s.slice(0, MAX_LINE - 1).trimEnd()}…` : s);

/**
 * The lines a suitor says in the limo: their own "when something goes wrong" sample when their card has one, then the
 * week in a sentence, then how it ended for them. First person, from the aired record only.
 */
export function exitInterview(o: { lead: string; by: "vote" | "lead"; week: ExitWeek | null; extras?: CharacterExtras | null; place?: (venue: string) => string }): string[] {
  const out: string[] = [];
  const own = o.extras?.lines?.upset?.trim();
  if (own) out.push(clip(own));
  const w = o.week;
  const at = (v: string | null) => (v && o.place ? ` at ${o.place(v)}` : "");
  if (!w || w.dates === 0) out.push(`I never got a date with ${o.lead} this week. That's the part that stings.`);
  else if (w.best?.ending === "second_date") out.push(`We had a second date${at(w.best.venue)}. I really thought that meant something.`);
  else if (w.worst?.ending === "disaster") out.push(`That date${at(w.worst.venue)} was a disaster. I'd take it back if I could.`);
  else out.push(`${o.lead} and I kept ending up as friends. I should have seen it coming.`);
  out.push(o.by === "vote" ? "The audience sent me home. I hope they were watching closely." : `${o.lead} made the call. For the record, I'd have kept me.`);
  return out;
}

/** A held ceremony, as the reveal needs it (CeremonyBoard.last plus who kept a rose). */
export type RevealInput = {
  held_on: string;
  week: number;
  finale: boolean;
  lines: string[];
  /** Who kept a rose this week (the finale: the final rose). */
  kept: NightFace[];
  voted_out: NightFace | null;
  lead_out: NightFace | null;
  final_rose: NightFace | null;
  /** The finale's runners-up. */
  runners_up: NightFace[];
  exits: ExitInterview[];
};

export type RevealStep =
  | { kind: "open"; line: string }
  | { kind: "vote"; face: NightFace; line: string | null }
  | { kind: "rose"; face: NightFace; n: number; of: number }
  | { kind: "last_rose"; faces: NightFace[]; line: string }
  | { kind: "goes_to"; face: NightFace; line: string | null }
  | { kind: "home"; face: NightFace; line: string | null }
  | { kind: "limo"; face: NightFace; lines: string[] }
  | { kind: "close"; line: string };

/** A steady order for the roses, from the ceremony's day: the same for every viewer and every replay. */
export function roseOrder<T extends { id: string }>(list: readonly T[], seed: string): T[] {
  const h = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return [...list].sort((a, b) => h(seed + a.id) - h(seed + b.id) || a.id.localeCompare(b.id));
}

const lineWith = (lines: readonly string[], name: string, skip: ReadonlySet<string>): string | null => lines.find((l) => !skip.has(l) && l.includes(name)) ?? null;

/**
 * The night in the order television tells it. A week: the opening line, the audience's pick going home, the roses one
 * by one, the last rose between two faces, who it goes to, who goes home, then the limo. The finale: the last faces
 * waiting, the final rose, the runners-up's exits. Every line comes from the stored ceremony; nothing new is decided.
 */
export function revealSteps(c: RevealInput): RevealStep[] {
  const used = new Set<string>();
  const take = (l: string | null) => {
    if (l) used.add(l);
    return l;
  };
  const steps: RevealStep[] = [];
  if (c.lines[0]) steps.push({ kind: "open", line: take(c.lines[0])! });
  const short = (f: NightFace) => f.name.split(/\s+/)[0];
  const exitOf = (f: NightFace) => c.exits.find((e) => e.id === f.id);
  if (c.finale && c.final_rose) {
    const faces = roseOrder([c.final_rose, ...c.runners_up], c.held_on);
    steps.push({ kind: "last_rose", faces, line: `One rose. ${faces.length === 1 ? "One face" : `${faces.length} faces`}.` });
    steps.push({ kind: "goes_to", face: c.final_rose, line: take(lineWith(c.lines, `final rose goes to ${short(c.final_rose)}`, used) ?? lineWith(c.lines, short(c.final_rose), used)) });
    for (const r of c.runners_up) steps.push({ kind: "home", face: r, line: null });
  } else {
    if (c.voted_out) steps.push({ kind: "vote", face: c.voted_out, line: take(lineWith(c.lines, short(c.voted_out), used)) });
    const roses = roseOrder(c.kept, c.held_on);
    // The last rose is between the last of the kept and whoever the lead sends home; with no lead pick, every rose is plain.
    const last = c.lead_out && roses.length ? roses[roses.length - 1] : null;
    const plain = last ? roses.slice(0, -1) : roses;
    plain.forEach((f, i) => steps.push({ kind: "rose", face: f, n: i + 1, of: roses.length }));
    if (last && c.lead_out) {
      steps.push({ kind: "last_rose", faces: roseOrder([last, c.lead_out], c.held_on + "last"), line: "One rose left. Two faces." });
      steps.push({ kind: "goes_to", face: last, line: null });
      steps.push({ kind: "home", face: c.lead_out, line: take(lineWith(c.lines, short(c.lead_out), used)) });
    }
  }
  for (const f of [c.voted_out, c.lead_out, ...(c.finale ? c.runners_up : [])]) {
    const e = f ? exitOf(f) : null;
    if (f && e?.lines.length) steps.push({ kind: "limo", face: f, lines: e.lines });
  }
  const rest = c.lines.filter((l) => !used.has(l));
  if (rest.length) steps.push({ kind: "close", line: rest[rest.length - 1] });
  return steps;
}
