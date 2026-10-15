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
import type { CharacterExtras } from "./extras";
import { contentWords } from "./quality";

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
export type Lookalike = { id: string; name: string; why: string };
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
  return new Set(contentWords([sheet.bio ?? "", (sheet.traits ?? []).join(" "), sheet.want ?? "", sheet.voice ?? ""].join(" "), 4));
}

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

/** Characters already on the show that read almost the same (or share the name). Excludes `excludeId` (the one being edited). */
export async function findLookalikes(db: Db, sheet: SheetDraft, excludeId: string | null = null, limit = 3): Promise<Lookalike[]> {
  const { rows } = await db.query<{ id: string; name: string; bio: string; traits: string[]; want: string; voice: string | null }>(
    `select id, name, bio, traits, want, voice from characters
      where ($1::text is null or id <> $1)
      order by is_house desc, created_at desc
      limit 500`,
    [excludeId],
  );
  const name = sheet.name?.trim().toLowerCase();
  const found: (Lookalike & { score: number })[] = [];
  for (const r of rows) {
    if (name && r.name.trim().toLowerCase() === name) {
      found.push({ id: r.id, name: r.name, why: `There's already a ${r.name} on the show.`, score: 2 });
      continue;
    }
    const score = likeness(sheet, r);
    if (score >= LOOKALIKE_AT) found.push({ id: r.id, name: r.name, why: `${r.name} reads a lot like this one.`, score });
  }
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
  ).length + (e.prompts?.length ?? 0) + (e.hobbies?.length ? 1 : 0);

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
  else tips.push("A few details (a job, a quirk, a profile prompt) give their dates something real to talk about.");
  score += (e.never_says?.length ? 5 : 0) + (words(sheet.want) >= 6 ? 5 : 0);
  score -= Math.min(30, cliches.length * 10);
  if (similar.length) score -= 20;
  for (const c of cliches) tips.unshift(c.tip);
  for (const s of similar) tips.unshift(`${s.why} What makes yours different?`);
  return { score: Math.max(0, Math.min(100, score)), cliches, similar, tips: [...new Set(tips)].slice(0, 5) };
}

/** The whole check, with lookalikes from the database. */
export async function originality(db: Db, sheet: SheetDraft, excludeId: string | null = null): Promise<OriginalityReport> {
  return scoreSheet(sheet, findCliches(sheet), await findLookalikes(db, sheet, excludeId));
}
