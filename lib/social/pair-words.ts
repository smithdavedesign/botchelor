/**
 * The pair panel's words (docs/PRDs/social-network.md section 9, Phase 3): every tie between two characters across
 * layers and time, and their history, a line each. Pure and browser-safe, so the Constellation's side panel and the
 * couple page say a pair the same way (app/graph/PairTiesCard.tsx draws it).
 */
import { shortName } from "../names";
import { TIE_KINDS } from "./kinds";
import { directedWords, kindPairWords, styleOf, type StyleKey } from "./lenses";
import type { Evidence, PairTies, SharedPlace, TieEvent, TieKindId, TieView } from "./types";

/** A date as the panels write it: "3 Nov 2026" (UTC, so a server render and a browser agree). */
export const pairDate = (iso: string): string => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** One tie between them, ready to draw: what it is, how the sky draws it, when, and what made it. */
export type PairRow = {
  id: string;
  kind: TieKindId;
  words: string;
  style: StyleKey;
  /** It feels bad: drawn red. */
  sour: boolean;
  over: boolean;
  /** "since 3 Nov 2026", "since school", "3 Nov – 18 Nov 2026"; empty when nothing says. */
  when: string;
  evidence: Evidence[];
};

/** What a tie is between the two, in words: "best friends", "Ada told Bea", "Bea is Ada's mentor". */
export function tieSentence(t: Pick<TieView, "kind" | "from" | "to" | "directed">, nameOf: (id: string) => string): string {
  if (!t.directed || !t.to) return kindPairWords(t.kind);
  return directedWords(t.kind, nameOf(t.from), nameOf(t.to));
}

/** When a tie ran, in words. */
export function tieWhen(t: Pick<TieView, "status" | "since_text" | "started_at" | "ended_at">): string {
  const since = t.since_text?.trim();
  if (t.status === "ended") {
    if (t.started_at && t.ended_at) return `${pairDate(t.started_at)} – ${pairDate(t.ended_at)}`;
    return t.ended_at ? `over since ${pairDate(t.ended_at)}` : "over";
  }
  if (since) return `since ${since}`;
  return t.started_at ? `since ${pairDate(t.started_at)}` : "";
}

/** The two by their first names, for a sentence about them: the panel's heading already has their full names. */
function firstNames(p: Pick<PairTies, "a" | "b">): (id: string) => string {
  const names = new Map([
    [p.a.id, shortName(p.a.name)],
    [p.b.id, shortName(p.b.name)],
  ]);
  return (id) => names.get(id) || "someone";
}

/** Their ties as rows: the ones still on first (strongest first, as the read layer orders them), then the ones over. */
export function pairRows(p: Pick<PairTies, "a" | "b" | "ties">): PairRow[] {
  const nameOf = firstNames(p);
  const rows = p.ties
    .filter((t) => t.status === "active" || t.status === "ended")
    .map((t) => ({
      id: t.id,
      kind: t.kind,
      words: tieSentence(t, nameOf),
      style: styleOf(t.kind, t.layer, t.valence),
      sour: t.valence < 0 && t.status === "active",
      over: t.status === "ended",
      when: tieWhen(t),
      evidence: t.evidence,
    }));
  return [...rows.filter((r) => !r.over), ...rows.filter((r) => r.over)];
}

/** What happened to a tie at an event, as a tag; null for what a page doesn't tell (a proposal, a refusal). */
const EVENT_TAG: Record<TieEvent, string | null> = {
  created: "started",
  accepted: "started",
  revived: "back on",
  ended: "ended",
  decayed: "faded",
  contact: "again",
  changed: null,
  proposed: null,
  declined: null,
};

/** A change's tag: closer or cooler when the feeling or the closeness moved, else nothing worth a line. */
function changedTag(changes: Record<string, [unknown, unknown]>): string | null {
  for (const key of ["valence", "closeness"]) {
    const [was, now] = changes[key] ?? [];
    if (typeof was === "number" && typeof now === "number" && was !== now) return now > was ? "warmer" : "cooler";
  }
  return null;
}

export type PairMoment = { at: string; kind: TieKindId; words: string; tag: string; style: StyleKey; ref: string | null };

/** Their history, newest first: one line a moment, each with the tie it moved and what happened to it. */
export function pairHistory(p: Pick<PairTies, "a" | "b" | "ties" | "events">): PairMoment[] {
  const byId = new Map(p.ties.map((t) => [t.id, t]));
  const nameOf = firstNames(p);
  const out: PairMoment[] = [];
  for (const e of p.events) {
    const t = byId.get(e.tie_id);
    const tag = e.event === "changed" ? changedTag(e.changes) : EVENT_TAG[e.event];
    if (!tag) continue;
    const words = t ? tieSentence(t, nameOf) : kindPairWords(e.kind);
    const def = TIE_KINDS[e.kind];
    const style = t ? styleOf(t.kind, t.layer, t.valence) : styleOf(e.kind, def?.layer ?? "acquaintance", def?.valence ?? 0);
    out.push({ at: e.at, kind: e.kind, words, tag, style, ref: e.source_ref });
  }
  return out.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
}

/** The places they share, in words, once each: "Regulars at the dive bar · Both from Leeds". */
export const sharedWords = (shared: readonly SharedPlace[]): string[] => [...new Set(shared.map((s) => s.words))];
