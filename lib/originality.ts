/**
 * The originality check (David, 2026-10-15: "be unique"). A nudge, never a gate: it reads a character sheet
 * and says how it could stand out — the stock phrases half the cast already uses, a character on the show
 * that reads almost the same, and the optional bits that make a date sound like one particular person (a
 * voice, sample lines, tells). Deterministic and free (no model call). The builder shows it on the review
 * step, and agents get it back from create_character and check_originality.
 *
 * The score is a friendly 0..100 "how distinct is this character" read, not a rating anyone else sees, and it
 * never touches the engine, matchmaking or anything public.
 */
import type { Db } from "./db";
import { publicExtras, type CharacterExtras } from "./extras";
import { contentWords, EVERYDAY_WORDS } from "./quality";
import { DELETED_OWNER } from "./rules";

export type SheetDraft = {
  name?: string;
  bio?: string;
  traits?: readonly string[];
  want?: string;
  dealbreaker?: string;
  voice?: string | null;
  extras?: CharacterExtras | null;
};

export type Cliche = { field: "bio" | "traits" | "want" | "dealbreaker"; phrase: string; tip: string };
/**
 * `kind`: "concept" reads like the same character; "name" only shares a first name (a lighter nudge). `recent`: made in
 * the last RECENT_HOURS (2.4.3); `name_and_job`: a close name doing the same job, the case that gets a suggestion.
 */
export type Lookalike = { id: string; name: string; why: string; kind?: "concept" | "name"; recent?: true; name_and_job?: true };
/** 2.4.3: what to change when a name and a job are too close to a recent character's: a different name or job, concretely. */
export type RenameSuggestion = { text: string; names: string[]; jobs: string[] };
export type OriginalityReport = {
  score: number;
  cliches: Cliche[];
  similar: Lookalike[];
  tips: string[];
  /** #505: what the score means, in words. Creating is allowed at any score: a near-twin is the one thing worth changing first. */
  verdict: "stands out" | "fine to create" | "consider changing";
  /** The score a sheet reads as "fine" from, and the one it stands out from. */
  thresholds: { fine_from: number; stands_out_from: number };
  verdict_note: string;
  /** 2.4.3: a close name doing the same job as a character made in the last RECENT_HOURS: pick a different job or name. */
  suggestion?: RenameSuggestion;
};

/** The score a sheet is "fine to create" from, and "stands out" from (#505). A nudge, never a gate. */
export const ORIGINALITY_FINE_FROM = 55;
export const ORIGINALITY_STANDS_OUT_FROM = 75;

/** Stock phrases, by field: matched on whole words, case-insensitive. Each comes with a nudge toward something specific. */
const PHRASES: { field: Cliche["field"]; phrases: string[]; tip: string }[] = [
  {
    field: "bio",
    phrases: ["love to travel", "loves to travel", "wanderlust", "partner in crime", "work hard play hard", "fluent in sarcasm", "coffee addict", "foodie",
      "netflix", "dog mom", "dog dad", "good vibes", "no drama", "live laugh love", "looking for my person", "just ask", "here for a good time",
      "life of the party", "hopeless romantic", "lover of life", "down to earth", "laid back", "the gym"],
    tip: "Swap the stock phrase for one specific thing: a job, a habit, a story they'd actually tell.",
  },
  {
    field: "want",
    phrases: ["makes me laugh", "make me laugh", "someone kind", "someone nice", "someone honest", "partner in crime", "good vibes", "my other half",
      "someone to share", "adventures with", "someone genuine", "real connection"],
    tip: "A specific want comes up on the date: what would they actually be hoping to see someone do?",
  },
  {
    field: "dealbreaker",
    phrases: ["liars", "lying", "rudeness", "rude to waiters", "bad hygiene", "smoking", "dishonesty", "arrogance", "fake people", "drama"],
    tip: "Make the dealbreaker theirs: an odd, specific thing the audience would never guess.",
  },
];

/** Traits so common they don't say who someone is. */
const GENERIC_TRAITS = new Set([
  "funny", "nice", "kind", "smart", "loyal", "outgoing", "chill", "easygoing", "easy-going", "adventurous", "honest", "caring", "friendly",
  "fun", "sweet", "cool", "confident", "creative", "spontaneous", "positive", "happy", "laid-back",
]);

const norm = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9']+/g, " ").trim()} `;

/** The stock phrases and generic traits a sheet leans on. Pure: the builder runs it as you type. */
export function findCliches(sheet: SheetDraft): Cliche[] {
  const out: Cliche[] = [];
  for (const group of PHRASES) {
    const text = norm(String(sheet[group.field] ?? ""));
    for (const phrase of group.phrases) {
      if (text.includes(norm(phrase))) {
        out.push({ field: group.field, phrase, tip: group.tip });
        break; // one nudge per field is plenty
      }
    }
  }
  const generic = (sheet.traits ?? []).map((t) => t.trim().toLowerCase()).filter((t) => GENERIC_TRAITS.has(t));
  if (generic.length >= 2) {
    out.push({
      field: "traits",
      phrase: generic.join(", "),
      tip: `“${generic[0]}” is how half the cast describes itself. Try a trait only they would have: “collects bad puns”, “allergic to small talk”.`,
    });
  }
  return out;
}

/** The words that make a sheet what it is, for comparing two characters. */
function fingerprint(sheet: SheetDraft): Set<string> {
  const e = sheet.extras ?? {};
  return new Set(
    contentWords([sheet.bio ?? "", (sheet.traits ?? []).join(" "), sheet.want ?? "", sheet.voice ?? "", e.occupation ?? "", e.quirk ?? "", ...(e.facts ?? []).map((f) => f.value)].join(" "), 4),
  );
}

/** What they do for a living, as words: the occupation detail, minus everyday words ("runs a soup window" and "runs a bakery" aren't one job). */
const workWords = (sheet: SheetDraft) => new Set(contentWords(sheet.extras?.occupation || "", 4).filter((w) => !EVERYDAY_WORDS.has(w) && !EVERYDAY_WORDS.has(stem(w))));
const bioWords = (sheet: SheetDraft) => new Set(contentWords(sheet.bio ?? "", 4));

function jaccard(x: Set<string>, y: Set<string>): number {
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

/** How alike two sheets read, 0..1 (shared meaningful words over all of them). */
export function likeness(a: SheetDraft, b: SheetDraft): number {
  return jaccard(fingerprint(a), fingerprint(b));
}

/** Above this, two characters read as near-twins. Unrelated sheets sit well under 0.1. */
export const LOOKALIKE_AT = 0.3;
/** Two bios alone sharing this much read as the same person (the whole-sheet score is diluted by voice and want). */
const BIO_LOOKALIKE_AT = 0.22;
/** Same line of work and bios that overlap this much: a near-clone with the names changed. */
const SAME_JOB_BIO_AT = 0.1;

/** Why two sheets read as near-twins, or null. Pure. */
export function lookalikeWhy(a: SheetDraft, b: SheetDraft, bName: string): { why: string; score: number } | null {
  const whole = likeness(a, b);
  if (whole >= LOOKALIKE_AT) return { why: `${bName} reads a lot like this one.`, score: whole };
  const bio = jaccard(bioWords(a), bioWords(b));
  if (bio >= BIO_LOOKALIKE_AT) return { why: `${bName}'s bio is close to this one's.`, score: bio };
  const jobA = workWords(a), jobB = workWords(b);
  const sharedJob = [...jobA].some((w) => jobB.has(w) || bioWords(b).has(w)) || [...jobB].some((w) => bioWords(a).has(w));
  if (sharedJob && bio >= SAME_JOB_BIO_AT) return { why: `${bName} does the same kind of work and has a similar story.`, score: bio + 0.1 };
  return null;
}

/* ------------------------------------------- concept twins ------------------------------------------- */
/*
 * Agents keep converging on the same character (visitor runs 1-5): a Marguerite, an Okonkwo-L… or Vasquez-L…
 * surname, a night shift, a ledger, exact about time. The word overlap above misses them when the wording differs, so
 * three more signals: the same first name, a near-identical surname, and a concept score over every field (lines and
 * tells included), where a word counts by how rare it is on the show and a few recurring tropes count as one.
 */

/** A light stem, so "ledgers" meets "ledger" and "diaries" meets "diary". */
const stem = (w: string) => (w.length > 4 && w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

/** Words that count as one concept here: the tropes agents keep landing on, worded differently each time. */
const SAME_AS: Record<string, string> = {
  night: "night", overnight: "night", graveyard: "night", nightshift: "night", nocturnal: "night", midnight: "night",
  notebook: "ledger", logbook: "ledger", journal: "ledger", tally: "ledger", ledger: "ledger",
  wristwatch: "clock", watch: "clock", clock: "clock", timepiece: "clock", stopwatch: "clock",
  punctual: "punctual", punctuality: "punctual", prompt: "punctual", timekeeping: "punctual", early: "punctual", late: "punctual",
  lateness: "punctual", latecomer: "punctual", tardy: "punctual",
  tollbooth: "toll", toll: "toll",
  // 2.9.0 (#655): the sea trope every run of 2026-10-22 landed on (lighthouses, tide tables, barometers), however it's worded.
  maritime: "nautical", nautical: "nautical", naval: "nautical", seafaring: "nautical", seafarer: "nautical",
  lighthouse: "lighthouse", lightkeeper: "lighthouse", lighthouseman: "lighthouse",
  tide: "tide", tidal: "tide",
  barometer: "barometer", barometric: "barometer",
};


/**
 * The concept terms of a sheet: distinctive words and two-word phrases from who the character IS (bio, traits, want,
 * dealbreaker, job and signature details, hobbies and profile answers). Not the voice kit: long kits of lines and tells
 * share everyday words ("question", "hello", "story") between characters who have nothing else in common.
 * #655 (the 2026-10-22-0610 run): two agents' lighthouse characters, minutes apart, shared only "lighthouse" in what was
 * read; the rest of the idea (barometer collecting, tide tables) was in their hobbies and profile answers.
 */
export function conceptTerms(sheet: SheetDraft): Set<string> {
  const text = conceptText(sheet);
  const out = new Set<string>();
  for (const part of text.toLowerCase().split(/[.!?;,:()"“”\n]+/)) {
    let prev: string | null = null;
    for (const raw of part.replace(/[-–—/]/g, " ").split(/[^a-z']+/)) {
      const word = raw.replace(/'s$/, "");
      const mapped = SAME_AS[word] ?? SAME_AS[stem(word)];
      if (!mapped && (word.length < 4 || EVERYDAY_WORDS.has(word) || EVERYDAY_WORDS.has(stem(word)) || !contentWords(word, 4).length)) {
        prev = null;
        continue;
      }
      const term = mapped ?? stem(word);
      out.add(term);
      if (prev && prev !== term) out.add(`${prev} ${term}`);
      prev = term;
    }
  }
  return out;
}

/** The words conceptTerms reads from a sheet, as one text. */
function conceptText(sheet: SheetDraft): string {
  const e = sheet.extras ?? {};
  const details = [
    e.occupation, e.quirk, e.signature_item, e.hidden_talent, e.pet_peeve, e.guilty_pleasure, ...(e.facts ?? []).map((f) => f.value),
    ...(e.hobbies ?? []), ...(e.prompts ?? []).map((p) => p.answer),
  ].filter(Boolean).join(". ");
  return [sheet.bio ?? "", (sheet.traits ?? []).join(". "), sheet.want ?? "", sheet.dealbreaker ?? "", details].join(". ");
}

/** A concept term as the sheet wrote it ("flinches", not the stem "flinche"), word by word; the term where no word matches. */
function asWritten(term: string, sheet: SheetDraft): string {
  const words = conceptText(sheet).toLowerCase().replace(/[-–—/]/g, " ").split(/[^a-z']+/).map((w) => w.replace(/'s$/, ""));
  return term
    .split(" ")
    .map((part) => words.find((w) => w && (SAME_AS[w] ?? SAME_AS[stem(w)] ?? stem(w)) === part) ?? part)
    .join(" ");
}

/** How rare each term is among `docs` (the sheets compared against): a word everyone uses counts for little. */
export function termWeights(docs: Set<string>[]): (term: string) => number {
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d) df.set(t, (df.get(t) ?? 0) + 1);
  const n = Math.max(1, docs.length);
  return (t) => Math.log(1 + n / (df.get(t) ?? 1));
}

/** Rarity-weighted overlap of two sheets' concept terms, 0..1 (a weighted cosine), how many they share, and the rarest. */
export function conceptSimilarity(a: Set<string>, b: Set<string>, weight: (term: string) => number): { score: number; count: number; shared: string[] } {
  let both = 0;
  let wa = 0;
  let wb = 0;
  const shared: string[] = [];
  for (const t of a) {
    const w = weight(t) ** 2;
    wa += w;
    if (b.has(t)) {
      both += w;
      shared.push(t);
    }
  }
  for (const t of b) wb += weight(t) ** 2;
  const score = wa && wb ? both / Math.sqrt(wa * wb) : 0;
  // The rarest first; a phrase stands in for the words inside it.
  const named = shared.sort((x, y) => weight(y) - weight(x)).filter((t, i, all) => !all.slice(0, i).some((u) => u.split(" ").includes(t)));
  return { score, count: shared.length, shared: named.slice(0, 3) };
}

/**
 * Two sheets read like one character when they share a cluster of distinctive concepts: at least this weighted
 * overlap AND this many shared terms (calibrated on the house cast, whose most alike pair scores 0.079 with 3 terms,
 * against the visitor runs' twins at 0.10 to 0.15 with 5 or 6; tests/originality-twins.test.ts).
 */
export const CONCEPT_TWIN_AT = 0.09;
export const CONCEPT_TWIN_TERMS = 4;
/** With a shared first name or a near-identical surname, two shared concepts are enough. */
const NAMED_TWIN_TERMS = 2;
/**
 * #403: the same temperament doing the same kind of thing. Two identical traits plus three shared story terms: Maren (a
 * patient, wry lens restorer with a ledger of everyone who waved from a ferry) next to Ines (a wry, patient ferry
 * lost-property clerk with a ledger of what's left behind) shared just three terms, under the concept bar.
 */
const SAME_TEMPERAMENT_TRAITS = 2;
const SAME_TEMPERAMENT_TERMS = 3;
const sharedTraits = (a: SheetDraft, b: SheetDraft): string[] => {
  const mine = new Set((a.traits ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean));
  return [...new Set((b.traits ?? []).map((t) => t.trim().toLowerCase()))].filter((t) => mine.has(t));
};

const nameParts = (name: string | undefined) => (name ?? "").toLowerCase().replace(/[^a-z\s'-]/g, " ").trim().split(/\s+/).filter(Boolean);
const firstName = (name: string | undefined) => nameParts(name)[0] ?? "";
const surname = (name: string | undefined) => nameParts(name).slice(1).join(" ");

/** Levenshtein distance, for near-identical surnames. */
function editDistance(x: string, y: string): number {
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

/** "Okonkwo-Laine" and "Okonkwo-Lind", "Vasquez-Lind" and "Vasquez-Lund": one part in common, or a letter or two apart. */
export function surnamesClose(a: string | undefined, b: string | undefined): boolean {
  const x = surname(a);
  const y = surname(b);
  if (x.length < 4 || y.length < 4) return false;
  const parts = (s: string) => s.split(/[\s-]+/).filter((p) => p.length >= 4);
  if (parts(x).some((p) => parts(y).includes(p))) return true;
  return Math.min(x.length, y.length) >= 6 && editDistance(x, y) <= 2;
}

type Compared = { id: string; name: string } & SheetDraft;

/* ------------------------------------------ recent characters (2.4.3) ------------------------------------------ */
/*
 * The 2026-10-21-0419 run: two agents a few minutes apart made near-namesakes in the same line of work, and the check
 * compared them only as far as its other signals went. Every character made in the last RECENT_HOURS by anyone (public
 * ones: a private character's sheet stays its owner's) is compared too, through an index on created_at, and a close name
 * doing the same job gets a concrete "pick a different job or name" before saving.
 */
export const RECENT_HOURS = 48;
const RECENT_LIMIT = 200;

/** First names a letter or two apart ("Odile" and "Odila"), or the same: close enough to blur on one date. */
function firstNamesClose(a: string | undefined, b: string | undefined): boolean {
  const x = firstName(a);
  const y = firstName(b);
  if (x.length < 3 || y.length < 3) return false;
  if (x === y) return true;
  return Math.min(x.length, y.length) >= 4 && x[0] === y[0] && editDistance(x, y) <= (Math.min(x.length, y.length) >= 6 ? 2 : 1);
}

/** The line of work two sheets share (their occupations, or one's occupation in the other's bio), as words; empty when none. */
export function sharedJob(a: SheetDraft, b: SheetDraft): string[] {
  const ja = workWords(a);
  const jb = workWords(b);
  const ba = bioWords(a);
  const bb = bioWords(b);
  return [...new Set([...[...ja].filter((w) => jb.has(w) || bb.has(w)), ...[...jb].filter((w) => ba.has(w))])];
}

/** A close name (first name or surname) doing the same job: the two would read as one character. Pure. */
export function nameAndJobClose(sheet: SheetDraft, other: Compared): string[] | null {
  if (!(firstNamesClose(sheet.name, other.name) || surnamesClose(sheet.name, other.name))) return null;
  const job = sharedJob(sheet, other);
  return job.length ? job : null;
}

/** Lines of work to offer instead, a spread of them: one that no recent character shares a word with is suggested. */
const JOB_IDEAS = [
  "a piano tuner", "a lock restorer", "a beekeeper", "a ferry engineer", "a typeface designer", "a cheese cave keeper", "a bell founder",
  "a hot-air balloon pilot", "a museum night guard", "a puppet repairer", "a seed librarian", "a court stenographer", "a glassblower",
  "a mountain-hut cook", "a canal lock keeper", "a weather balloon launcher", "a subtitle translator", "an organ builder", "a falconer",
  "a crossword setter", "a theatre prop maker", "a tide-table printer", "a skate sharpener", "a perfume tester",
  // #1016: a bigger pool, so agents dealt different jobs rarely meet on the same one.
  "a map engraver", "a violin varnisher", "a kite maker", "a clock-tower winder", "a sign painter", "a rope maker", "a mushroom forager",
  "a stained-glass mender", "a radio-play foley artist", "a lift inspector", "a tea blender", "a fountain pen repairer", "a ski patroller",
  "a cooper", "a botanical illustrator", "a snow-plough driver", "a hat blocker", "a lido lifeguard", "a bookbinder", "a ship-in-a-bottle maker",
  "a vineyard frost watcher", "a model railway builder", "a taxidermy restorer", "an archive mould specialist",
];

/** Spare first names, for "pick a different name" (none of them is offered if the show already has it). */
const NAME_IDEAS = ["Wren", "Tamsin", "Ottoline", "Bastien", "Leocadia", "Hollis", "Ysolde", "Casimir", "Peregrine", "Delphine", "Ambrose", "Sabine", "Lucan", "Mireille", "Thaddeus", "Ingrid"];

/** How long one caller keeps the same job suggestions (#1016): long enough for check_only then create, short enough to move on. */
export const JOB_DEAL_MINUTES = 15;

/** A seeded shuffle of `xs` (FNV-1a for the seed, then mulberry32): the same key always deals the same order. Pure. */
function dealt<T>(xs: T[], key: string): T[] {
  let h = 0x811c9dc5;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  const next = () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Jobs to offer instead: none shares a word with what these others do or say. #1016 (the 2026-10-30-1924 run: two agents
 * on one model got the same "a lock restorer", and the second save was a twin): the order is dealt per caller (`by`, the
 * agent or account; the sheet's name without one) and per JOB_DEAL_MINUTES window, so two agents rarely get the same
 * list, and one agent keeps its list between check_only and create. Pure, given `now`.
 */
export function freshJobs(sheet: SheetDraft, others: SheetDraft[], n = 3, by: string | null = null, now = Date.now()): string[] {
  const window = Math.floor(now / (JOB_DEAL_MINUTES * 60_000));
  const used = new Set(others.flatMap((r) => [...workWords(r), ...bioWords(r)]));
  return dealt(JOB_IDEAS, `${by ?? ""}|${(sheet.name ?? "x").trim().toLowerCase()}|${window}`)
    .filter((j) => !contentWords(j, 4).some((w) => used.has(w) || used.has(stem(w))))
    .slice(0, n);
}

/** Every character's job alone (no bio), to keep suggestions off jobs the show already has (#1016). */
const jobsOnly = (rows: SheetDraft[]): SheetDraft[] => rows.map((r) => ({ extras: { occupation: r.extras?.occupation ?? "" } }));

/** #852: jobs no character on the show has yet (by occupation), for a check that found look-alikes but no recent twin. */
export async function unusedJobs(db: Db, sheet: SheetDraft, n = 3, by: string | null = null): Promise<string[]> {
  const { rows } = await db.query<{ occupation: string | null }>(`select extras->>'occupation' as occupation from characters where coalesce(extras->>'occupation', '') <> ''`);
  return freshJobs(sheet, rows.map((r) => ({ extras: { occupation: r.occupation ?? "" } })), n, by);
}

/** The concrete suggestion: free names (keeping nothing that's close to the twin's) and jobs nobody recent has. */
async function renameSuggestion(db: Db, sheet: SheetDraft, twins: Compared[], recent: Compared[], rows: Compared[], by: string | null): Promise<RenameSuggestion> {
  const seed = [...(sheet.name ?? "x")].reduce((n, ch) => n + ch.charCodeAt(0), 0);
  const rotate = <T,>(xs: T[]) => xs.map((_, i) => xs[(seed + i) % xs.length]);
  const surnameOf = surname(sheet.name);
  const keepSurname = surnameOf && !twins.some((t) => surnamesClose(sheet.name, t.name));
  const cap = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  const candidates = rotate(NAME_IDEAS)
    .filter((n) => !twins.some((t) => firstNamesClose(n, t.name)) && !recent.some((r) => firstNamesClose(n, r.name)))
    .map((n) => (keepSurname ? `${n} ${cap(surnameOf)}` : n));
  const taken = candidates.length
    ? new Set((await db.query<{ name: string }>(`select lower(trim(name)) as name from characters where lower(trim(name)) = any($1)`, [candidates.map((n) => n.toLowerCase())])).rows.map((r) => r.name))
    : new Set<string>();
  const names = candidates.filter((n) => !taken.has(n.toLowerCase())).slice(0, 3);
  const jobs = freshJobs(sheet, [...recent, ...twins, ...jobsOnly(rows)], 3, by);
  const who = twins.map((t) => t.name).join(", ");
  return {
    names,
    jobs,
    text:
      `Too close to ${who} (made in the last ${RECENT_HOURS} hours): a close name and the same job. Pick a different job or name before saving` +
      `${names.length ? `: a name like ${names.join(", ")}` : ""}${jobs.length ? `${names.length ? ", or" : ":"} a job like ${jobs.join(", ")}` : ""}.`,
  };
}

/** Why `sheet` reads like `other`, from every signal, with a score for ordering; or null. Pure, given the term weights. */
export function twinWhy(sheet: SheetDraft, other: Compared, terms: Set<string>, otherTerms: Set<string>, weight: (term: string) => number): (Lookalike & { score: number }) | null {
  const base = { id: other.id, name: other.name };
  const concept = conceptSimilarity(terms, otherTerms, weight);
  const both = concept.shared.length ? ` (both: ${concept.shared.map((t) => asWritten(t, sheet)).join(", ")})` : "";
  if (concept.score >= CONCEPT_TWIN_AT && concept.count >= CONCEPT_TWIN_TERMS) {
    return { ...base, kind: "concept", why: `${other.name} reads a lot like this one${both}.`, score: 1 + concept.score };
  }
  const alike = lookalikeWhy(sheet, other, other.name);
  if (alike) return { ...base, kind: "concept", why: alike.why, score: 1 + alike.score };
  const traits = sharedTraits(sheet, other);
  if (traits.length >= SAME_TEMPERAMENT_TRAITS && concept.count >= SAME_TEMPERAMENT_TERMS) {
    return { ...base, kind: "concept", why: `${other.name} has the same temperament (${traits.join(", ")}) and a similar story${both}.`, score: 0.8 + concept.score };
  }
  const first = firstName(sheet.name);
  const sameFirst = first.length >= 3 && first === firstName(other.name);
  const closeSurname = surnamesClose(sheet.name, other.name);
  if ((sameFirst || closeSurname) && concept.count >= NAMED_TWIN_TERMS) {
    return { ...base, kind: "concept", why: `${other.name} has a name and a story close to this one's${both}.`, score: 1 + concept.score };
  }
  if (sameFirst) {
    const cap = first[0].toUpperCase() + first.slice(1);
    return { ...base, kind: "name", why: `There's already someone called ${cap} on the show (${other.name}). Two on one date blur together: a different first name keeps them apart.`, score: 0.5 };
  }
  return null;
}

/** `agent`: made over MCP (not the house cast); `made_at`: when it was made (2.6.0, for the recent-twin warning). */
type Row = { id: string; name: string; bio: string; traits: string[]; want: string; voice: string | null; extras: CharacterExtras | null; recent: boolean; agent: boolean; made_at: string };

/** Characters already on the show that read almost the same (or share the name). Excludes `excludeId` (the one being edited). */
export async function findLookalikes(db: Db, sheet: SheetDraft, excludeId: string | null = null, limit = 3): Promise<Lookalike[]> {
  return (await lookalikesWithRecent(db, sheet, excludeId, limit)).found;
}

type Found = Lookalike & { score: number; shared: string[]; row: Row };

async function lookalikesWithRecent(db: Db, sheet: SheetDraft, excludeId: string | null, limit: number): Promise<{ found: Lookalike[]; recent: Compared[]; rows: Compared[]; all: Found[] }> {
  const recentSql = `created_at > now() - interval '${RECENT_HOURS} hours'`;
  const extra = `created_via = 'mcp' and not is_house as agent, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as made_at`;
  const [main, fresh] = await Promise.all([
    db.query<Row>(
      // Only characters anyone can see (data plan Tier 2): a twin note names the other character and the terms it
      // shares, so a private character or a deleted account's never takes part.
      `select id, name, bio, traits, want, voice, extras, ${recentSql} and not is_house and visibility = 'public' as recent, ${extra} from characters
        where ($1::text is null or id <> $1) and visibility = 'public' and owner_id is distinct from $2
        order by is_house desc, created_at desc
        limit 500`,
      [excludeId, DELETED_OWNER],
    ),
    // 2.4.3: every public character made in the last RECENT_HOURS, by anyone (characters_created_idx), whatever the cap above left out.
    db.query<Row>(
      `select id, name, bio, traits, want, voice, extras, true as recent, ${extra} from characters
        where ${recentSql} and not is_house and visibility = 'public' and owner_id is distinct from $2 and ($1::text is null or id <> $1)
        order by created_at desc
        limit ${RECENT_LIMIT}`,
      [excludeId, DELETED_OWNER],
    ),
  ]);
  const seen = new Set(main.rows.map((r) => r.id));
  const rows = [...main.rows, ...fresh.rows.filter((r) => !seen.has(r.id))];
  const name = sheet.name?.trim().toLowerCase();
  const terms = conceptTerms(sheet);
  // Other characters' private facts and their dealbreaker never take part: neither is on their card
  // (guess_dealbreaker is a game), and the twin note names shared terms, so it mustn't reveal them.
  for (const r of rows) r.extras = publicExtras(r.extras);
  const rowTerms = rows.map((r) => conceptTerms(r));
  const weight = termWeights([terms, ...rowTerms]);
  const found: Found[] = [];
  rows.forEach((r, i) => {
    // The concepts the two share (the rarest first), kept for the archetype a recent-twin warning names (2.6.0).
    const shared = () => conceptSimilarity(terms, rowTerms[i], weight).shared;
    if (name && r.name.trim().toLowerCase() === name) {
      found.push({ id: r.id, name: r.name, kind: "concept", why: `There's already someone called ${r.name} on the show.`, score: 3, shared: shared(), row: r });
      return;
    }
    // 2.4.3: a recent character with a close name doing the same job reads as the same one, whatever else differs.
    const job = r.recent ? nameAndJobClose(sheet, r) : null;
    if (job) {
      found.push({ id: r.id, name: r.name, kind: "concept", recent: true, name_and_job: true, why: `${r.name}, made in the last ${RECENT_HOURS} hours, has a close name and the same job (${job.slice(0, 2).join(", ")}).`, score: 2.5, shared: shared(), row: r });
      return;
    }
    const twin = twinWhy(sheet, r, terms, rowTerms[i], weight);
    if (twin) found.push({ ...twin, shared: shared(), row: r });
  });
  const sorted = found.sort((x, y) => y.score - x.score);
  return {
    found: sorted.slice(0, limit).map(({ score: _s, shared: _t, row: _r, ...l }) => l),
    recent: rows.filter((r) => r.recent),
    rows,
    all: sorted,
  };
}

/* --------------------------------------- recent agents' twins (2.6.0) --------------------------------------- */
/*
 * The 2026-10-22-0042 run: three visitors on the same model started at once and each made a retired lighthouse inspector
 * within minutes. The look-alike check named at most three (the house cast first), the first of them heard nothing, and
 * the warning came after saving. Agents on one model converge on archetypes, on production too, so create_character
 * names every other agent's character made lately that reads like the sheet, the idea several of them share, and jobs
 * nobody recent has: before saving (check_only) and again at the save.
 */
export const TWIN_WARN_HOURS = 24;
export type RecentTwin = { id: string; name: string; why: string; shared: string[]; made_at: string };

/**
 * Agent-made characters made in the last `hours` that read like `sheet` (concept twins, not just a shared first name),
 * closest first; `archetype` is the concept the most of them share with it, and `sharing` how many do (2.9.0, #655: one is
 * enough, as the sheet makes two: the morning's two lighthouse characters never heard the idea named). `jobs`: lines of work
 * none of them (nor anyone recent, nor any public character's job) has, dealt for `by` (#1016). Public sheets only, as every look-alike check.
 */
export async function recentAgentTwins(
  db: Db,
  sheet: SheetDraft,
  excludeId: string | null = null,
  hours = TWIN_WARN_HOURS,
  by: string | null = null,
): Promise<{ twins: RecentTwin[]; archetype: string | null; sharing: number; jobs: string[] }> {
  const { all, recent, rows } = await lookalikesWithRecent(db, sheet, excludeId, 3);
  const since = Date.now() - hours * 3_600_000;
  const twins = all
    .filter((x) => x.kind === "concept" && x.row.agent && Date.parse(x.row.made_at) >= since)
    .map((x) => ({ id: x.id, name: x.name, why: x.why, shared: x.shared, made_at: x.row.made_at }));
  // The idea several share: the shared concept the most twins have in common (a phrase over a single word on a tie).
  const counts = new Map<string, number>();
  for (const t of twins) for (const term of new Set(t.shared)) counts.set(term, (counts.get(term) ?? 0) + 1);
  const best = [...counts].sort((x, y) => y[1] - x[1] || y[0].split(" ").length - x[0].split(" ").length || y[0].length - x[0].length)[0];
  const archetype = best && best[1] >= 1 ? best[0] : null;
  return { twins, archetype, sharing: archetype ? best[1] : 0, jobs: twins.length ? freshJobs(sheet, [...recent, ...all.map((x) => x.row), ...jobsOnly(rows)], 3, by) : [] };
}

const words = (s: string | undefined) => (s ?? "").trim().split(/\s+/).filter(Boolean).length;

/** The score and the nudges, from the clichés and lookalikes already found. Pure. */
export function scoreSheet(sheet: SheetDraft, cliches: Cliche[], similar: Lookalike[]): OriginalityReport {
  const e = sheet.extras ?? {};
  const lines = Object.values(e.lines ?? {}).filter(Boolean).length;
  const tells = Object.values(e.tells ?? {}).filter(Boolean).length;
  const details = ["occupation", "hometown", "quirk", "catchphrase", "hidden_talent", "pet_peeve", "guilty_pleasure", "ideal_first_date"].filter(
    (k) => (e as Record<string, unknown>)[k],
  ).length + (e.prompts?.length ?? 0) + (e.hobbies?.length ? 1 : 0) + Math.min(3, e.facts?.length ?? 0);

  let score = 50;
  const tips: string[] = [];
  if (words(sheet.bio) >= 15) score += 10;
  else tips.push("Give the bio one specific detail — a job, a habit, a story they'd tell. Thin bios make generic dates.");
  if (sheet.voice?.trim()) score += 10;
  else tips.push("Write how they talk (the Voice step). It's the biggest lever for a date that sounds like them.");
  if (lines >= 2) score += 10;
  else tips.push("Add a couple of lines exactly as they'd say them (Sound like them).");
  if (tells >= 2) score += 5;
  else tips.push("Give them a tell or two: what they do when they're nervous, or smitten.");
  if (details >= 3) score += 5;
  else if (details === 0) tips.push("A few details (a job, a quirk, a profile prompt) give their dates something real to talk about.");
  else tips.push(`${3 - details === 1 ? "One more detail" : "Two more details"} (a hometown, a hidden talent, a profile prompt) would give their dates more to talk about.`);
  score += (e.never_says?.length ? 5 : 0) + (words(sheet.want) >= 6 ? 5 : 0);
  score -= Math.min(30, cliches.length * 10);
  // A character that reads like another costs more than one that only shares a first name.
  if (similar.some((s) => s.kind !== "name")) score -= 20;
  else if (similar.length) score -= 10;
  for (const c of cliches) tips.unshift(c.tip);
  for (const s of similar) tips.unshift(s.kind === "name" ? s.why : `${s.why} What makes yours different?`);
  const final = Math.max(0, Math.min(100, score));
  const twin = similar.some((s) => s.kind !== "name");
  const verdict = twin || final < ORIGINALITY_FINE_FROM ? "consider changing" : final >= ORIGINALITY_STANDS_OUT_FROM ? "stands out" : "fine to create";
  return {
    score: final,
    cliches,
    similar,
    tips: [...new Set(tips)].slice(0, 5),
    verdict,
    thresholds: { fine_from: ORIGINALITY_FINE_FROM, stands_out_from: ORIGINALITY_STANDS_OUT_FROM },
    verdict_note:
      verdict === "consider changing"
        ? twin
          ? "It reads a lot like a character already on the show: change its job or story first. You can still create it."
          : `Under ${ORIGINALITY_FINE_FROM}: the tips say what's missing. Nothing stops you creating it as it is.`
        : verdict === "stands out"
          ? `${ORIGINALITY_STANDS_OUT_FROM} or more: specific and its own. Go ahead.`
          : `${ORIGINALITY_FINE_FROM} to ${ORIGINALITY_STANDS_OUT_FROM - 1}: fine to create; the tips would make its dates more its own. Creating is allowed at any score.`,
  };
}

/**
 * The whole check, with lookalikes from the database (2.4.3: and a suggestion when a name and job are too close to a
 * recent one's). `also`: more look-alikes to weigh after the word-based ones, each character once: the twins by meaning
 * that server callers pass in (lib/originality-concept.ts originalityWithConcepts). This file stays free of server-only
 * imports because the builder imports it in the browser (findCliches).
 */
export async function originality(
  db: Db,
  sheet: SheetDraft,
  excludeId: string | null = null,
  also: Lookalike[] | Promise<Lookalike[]> = [],
  by: string | null = null,
): Promise<OriginalityReport> {
  const [words, more] = await Promise.all([lookalikesWithRecent(db, sheet, excludeId, 3), Promise.resolve(also).catch(() => [])]);
  const { recent, rows } = words;
  const found = [...words.found, ...more.filter((c) => !words.found.some((f) => f.id === c.id))].slice(0, 3);
  const report = scoreSheet(sheet, findCliches(sheet), found);
  const close = found.filter((f) => f.name_and_job).flatMap((f) => rows.filter((r) => r.id === f.id));
  if (!close.length) return report;
  const suggestion = await renameSuggestion(db, sheet, close, recent, rows, by);
  return { ...report, suggestion, tips: [suggestion.text, ...report.tips.filter((t) => t !== suggestion.text)].slice(0, 5) };
}
