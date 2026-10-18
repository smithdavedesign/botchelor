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
/** `kind`: "concept" reads like the same character; "name" only shares a first name (a lighter nudge). */
export type Lookalike = { id: string; name: string; why: string; kind?: "concept" | "name" };
export type OriginalityReport = { score: number; cliches: Cliche[]; similar: Lookalike[]; tips: string[] };

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
};


/**
 * The concept terms of a sheet: distinctive words and two-word phrases from who the character IS (bio, traits, want,
 * dealbreaker, job and signature details). Not the voice kit: long kits of lines and tells share everyday words
 * ("question", "hello", "story") between characters who have nothing else in common.
 */
export function conceptTerms(sheet: SheetDraft): Set<string> {
  const e = sheet.extras ?? {};
  const details = [e.occupation, e.quirk, e.signature_item, e.hidden_talent, e.pet_peeve, e.guilty_pleasure, ...(e.facts ?? []).map((f) => f.value)].filter(Boolean).join(". ");
  const text = [sheet.bio ?? "", (sheet.traits ?? []).join(". "), sheet.want ?? "", sheet.dealbreaker ?? "", details].join(". ");
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

/** Why `sheet` reads like `other`, from every signal, with a score for ordering; or null. Pure, given the term weights. */
export function twinWhy(sheet: SheetDraft, other: Compared, terms: Set<string>, otherTerms: Set<string>, weight: (term: string) => number): (Lookalike & { score: number }) | null {
  const base = { id: other.id, name: other.name };
  const concept = conceptSimilarity(terms, otherTerms, weight);
  const both = concept.shared.length ? ` (both: ${concept.shared.join(", ")})` : "";
  if (concept.score >= CONCEPT_TWIN_AT && concept.count >= CONCEPT_TWIN_TERMS) {
    return { ...base, kind: "concept", why: `${other.name} reads a lot like this one${both}.`, score: 1 + concept.score };
  }
  const alike = lookalikeWhy(sheet, other, other.name);
  if (alike) return { ...base, kind: "concept", why: alike.why, score: 1 + alike.score };
  const first = firstName(sheet.name);
  const sameFirst = first.length >= 3 && first === firstName(other.name);
  const closeSurname = surnamesClose(sheet.name, other.name);
  if ((sameFirst || closeSurname) && concept.count >= NAMED_TWIN_TERMS) {
    return { ...base, kind: "concept", why: `${other.name} has a name and a story close to this one's${both}.`, score: 1 + concept.score };
  }
  if (sameFirst) {
    const cap = first[0].toUpperCase() + first.slice(1);
    return { ...base, kind: "name", why: `There's already a ${cap} on the show (${other.name}). Two on one date blur together: a different first name keeps them apart.`, score: 0.5 };
  }
  return null;
}

/** Characters already on the show that read almost the same (or share the name). Excludes `excludeId` (the one being edited). */
export async function findLookalikes(db: Db, sheet: SheetDraft, excludeId: string | null = null, limit = 3): Promise<Lookalike[]> {
  const { rows } = await db.query<{ id: string; name: string; bio: string; traits: string[]; want: string; dealbreaker: string | null; voice: string | null; extras: CharacterExtras | null }>(
    `select id, name, bio, traits, want, dealbreaker, voice, extras from characters
      where ($1::text is null or id <> $1)
      order by is_house desc, created_at desc
      limit 500`,
    [excludeId],
  );
  const name = sheet.name?.trim().toLowerCase();
  const terms = conceptTerms(sheet);
  // Other characters' private facts never take part: the twin note names shared terms, and that mustn't reveal them.
  for (const r of rows) r.extras = publicExtras(r.extras);
  const rowTerms = rows.map((r) => conceptTerms({ ...r, dealbreaker: r.dealbreaker ?? undefined }));
  const weight = termWeights([terms, ...rowTerms]);
  const found: (Lookalike & { score: number })[] = [];
  rows.forEach((r, i) => {
    if (name && r.name.trim().toLowerCase() === name) {
      found.push({ id: r.id, name: r.name, kind: "concept", why: `There's already a ${r.name} on the show.`, score: 3 });
      return;
    }
    const twin = twinWhy(sheet, { ...r, dealbreaker: r.dealbreaker ?? undefined }, terms, rowTerms[i], weight);
    if (twin) found.push(twin);
  });
  return found.sort((x, y) => y.score - x.score).slice(0, limit).map(({ score: _s, ...l }) => l);
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
  return { score: Math.max(0, Math.min(100, score)), cliches, similar, tips: [...new Set(tips)].slice(0, 5) };
}

/** The whole check, with lookalikes from the database. */
export async function originality(db: Db, sheet: SheetDraft, excludeId: string | null = null): Promise<OriginalityReport> {
  return scoreSheet(sheet, findCliches(sheet), await findLookalikes(db, sheet, excludeId));
}
