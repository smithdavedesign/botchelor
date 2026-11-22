/**
 * One-sentence create (2026-11-15): the first screen of /create for someone making their first character is one box,
 * "Describe them in a sentence or two", an optional name and one button. In the 30 days before, 12 people opened the
 * builder and 4 finished it, after 103 seconds on its eight fields: the form was the wall. The free-text reader /import
 * already had (lib/import-character.ts: mapSource, screenDraft, readyToDate) drafts the whole sheet from prose; here it is
 * asked to draft rather than copy, since a sentence never holds a name, an age, three traits, a want and a dealbreaker.
 *
 * What this module is: the words sent to the model, the step from its reading to a builder draft (the same mapping and
 * screening every import takes), the adult-age rule, a look that fits the words, the plain sentence for each way it can
 * fail, and the engagement events. Pure and client-safe: the route (app/api/characters/draft) adds the limits, the model
 * call and the name check; the builder (app/create/CreateWizard.tsx) shows the box and applies the draft.
 *
 * Nothing here decides what is allowed: the draft is cut and screened by the import reader's own checks, the builder's
 * Identity rules and the save (POST /api/characters: checkSheetText in any language, the 18+ rule, the name check) judge
 * it again, and the person ticks the same "fictional adult, my own" box before anything is created.
 */
import { artStyleInWords } from "./art-style";
import { NAME_MAX } from "./field-limits";
import { importFromFields, readyToDate, statedAge, stillMissing, SOURCE_KEYS, type ImportedDraft, type SourceFields } from "./import-character";
import { LOOK_STEPS, optionsFor, WORK_OUTFITS, type Gender, type Looks } from "./looks";
import { CHARACTER_REJECTION_MESSAGES, checkSheetText, isPastPg, type RejectReason } from "./safety";

/** The box takes about a tweet: a sentence or two, not a card (that is /import's job). */
export const EXPRESS_TEXT_MAX = 280;
/** Less than this is not a description ("hi"); the button stays off. */
export const EXPRESS_TEXT_MIN = 8;
/**
 * Where the home page's box leaves its sentence for /create (sessionStorage; app/HomeExpressBox.tsx), so what someone
 * typed is never in an address the analytics see. Without script the form sends it as /create?say=… instead.
 */
export const EXPRESS_SAY_KEY = "bz_express_say";
/** How long the route waits for the model before the form opens instead (the model's own timeout and retries run to a minute). */
export const EXPRESS_TIMEOUT_MS = 12_000;
/** How long the builder waits for the route: a little longer, so the server's own answer arrives first when it has one. */
export const EXPRESS_CLIENT_TIMEOUT_MS = 16_000;

const MIN_AGE = 18;
const MAX_AGE = 1000;

/** EXPRESS_CREATE: on unless it is "0" (then /create opens on today's form and the route answers 404). */
export function expressCreateOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.EXPRESS_CREATE?.trim() !== "0";
}

/** The three taps that fill the box: originals written for this page, each a different kind of person. */
export const EXPRESS_EXAMPLES: readonly { label: string; text: string }[] = [
  { label: "Night baker", text: "A night-shift baker who names every sourdough starter and can't do small talk before sunrise." },
  { label: "Stuntman", text: "A retired stuntman in his fifties who now teaches ballroom dancing and is afraid of escalators." },
  { label: "Storm chaser", text: "A storm-chasing meteorologist who is fearless in a tornado and hopeless at first dates." },
];

/**
 * The system prompt. Unlike /import's ("use only what the text says"), this one is asked to fill what the sentence leaves
 * out, because a draft with blanks is the form again. The fields are the reader's own labelled ones (SourceFields), so
 * the answer maps and screens exactly like an import. The adult rule is said here and enforced after (adultAge).
 */
export const EXPRESS_PROMPT =
  "You draft a character for a PG dating show from one or two sentences someone wrote. Reply with ONLY a JSON object with " +
  "these string keys: name (a first name and a surname that fit them and sound invented; if the text names them, that name), " +
  "age (a number, 18 or over: the text's own age when it gives one, otherwise an adult age that fits; never under 18), " +
  "gender (woman, man or nonbinary, only when the text says or clearly implies it, otherwise an empty string), " +
  "description (their bio: one or two sentences in the third person, keeping the text's own details, at most 300 characters), " +
  "personality (exactly three one-word traits, comma-separated), " +
  "wants (what they want from a date: one short phrase without commas, at most 100 characters), " +
  "dislikes (their dealbreaker on a date: one short phrase without commas, at most 100 characters), " +
  "occupation (their job when the text says or implies one, otherwise an empty string), " +
  "likes (two or three things they do for fun, comma-separated, only from the text, otherwise an empty string), " +
  "appearance (how they look, only when the text says, otherwise an empty string). " +
  "Keep every fact the text gives. Where it gives none, invent small, specific details that fit this one person. " +
  "Every character is an adult. Nothing sexual, no real people, no brand names, no famous characters.";

/** Why a draft did not happen; each opens the usual form with one plain sentence (expressFailureLine). */
export const EXPRESS_FAILURES = ["minor", "real_person", "unsafe", "limited", "model", "timeout", "network", "unreadable", "off"] as const;
export type ExpressFailure = (typeof EXPRESS_FAILURES)[number];
export const isExpressFailure = (r: unknown): r is ExpressFailure => typeof r === "string" && (EXPRESS_FAILURES as readonly string[]).includes(r);

const HERE_IS_THE_FORM = "so here's the form with your words in the bio.";

/**
 * The one sentence the form opens with after a failure. A refusal by the show's rules says the rule (the save would say
 * the same); everything else says what happened. What they typed is already in the bio either way.
 */
export function expressFailureLine(reason: ExpressFailure, serverMessage?: string | null): string {
  switch (reason) {
    case "minor":
      return CHARACTER_REJECTION_MESSAGES.minor;
    case "real_person":
      return CHARACTER_REJECTION_MESSAGES.real_person;
    case "unsafe":
      return serverMessage?.trim() || CHARACTER_REJECTION_MESSAGES.innuendo;
    case "limited":
      return `That's a lot of drafts from here for one day, ${HERE_IS_THE_FORM}`;
    case "timeout":
      return `The draft took too long, ${HERE_IS_THE_FORM}`;
    case "network":
      return `The connection dropped, ${HERE_IS_THE_FORM}`;
    case "unreadable":
      return `We couldn't find a character in that, ${HERE_IS_THE_FORM}`;
    case "off":
    case "model":
      return `The show's writer couldn't draft them just now, ${HERE_IS_THE_FORM}`;
  }
}

const refusalOf = (reason: RejectReason): ExpressFailure => (reason === "minor" ? "minor" : reason === "real_person" ? "real_person" : "unsafe");

/**
 * What they typed, held to the sheet's own check before any model reads it (it becomes the bio): a minor, a real
 * person's name or anything past PG is refused here, with the message a save would give.
 */
export function screenExpressText(text: string, name: string): { ok: true } | { ok: false; reason: ExpressFailure; message: string; pastPg?: true } {
  if (statedUnderage(text)) return { ok: false, reason: "minor", message: CHARACTER_REJECTION_MESSAGES.minor };
  const verdict = checkSheetText({ bio: text, name });
  if (verdict.ok) return { ok: true };
  // Past PG (sexual content or innuendo, never a minor or a real person): the builder can offer After Dark (lib/safety.ts isPastPg).
  return { ok: false, reason: refusalOf(verdict.reason), message: CHARACTER_REJECTION_MESSAGES[verdict.reason], ...(isPastPg(verdict.reason) ? { pastPg: true as const } : {}) };
}

/** The text itself gives an age under 18 ("a 16 year old…"). */
function statedUnderage(text: string): boolean {
  const age = statedAge(undefined, text);
  return age !== null && age < MIN_AGE;
}

/** A small stable hash: the same words always get the same invented age and the same look. */
function hashOf(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

/**
 * The draft's age (the adult rule): the age the person's own words state when they state one, else the model's when it
 * is an adult's, else an adult age picked from the words (24 to 39). Never under 18: a stated age under 18 is refused
 * before this is reached (screenExpressText, draftFromReading), and a model's is never taken. Null: the words state an
 * age the sheet cannot hold (over 1000), which the form asks about.
 */
export function adultAge(text: string, modelAge: string | undefined): { age: number; invented: boolean } | null {
  const stated = statedAge(undefined, text);
  if (stated !== null) return stated >= MIN_AGE && stated <= MAX_AGE ? { age: stated, invented: false } : null;
  const read = modelAge ? Number(/\d{1,4}/.exec(modelAge)?.[0]) : NaN;
  if (Number.isInteger(read) && read >= MIN_AGE && read <= MAX_AGE) return { age: read, invented: true };
  return { age: 24 + (hashOf(text.trim().toLowerCase()) % 16), invented: true };
}

/** The model's answer as labelled fields: only the reader's keys, strings and numbers, each cut short. */
export function fieldsFromReply(raw: string): SourceFields | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const fields: SourceFields = {};
  for (const k of SOURCE_KEYS) {
    const v = (parsed as Record<string, unknown>)[k];
    const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
    if (s) fields[k] = s.slice(0, 600);
  }
  return Object.keys(fields).length ? fields : null;
}

/* ------------------------------------------------------------------------------------------------------------ *
 * A look that fits the words
 * ------------------------------------------------------------------------------------------------------------ */

const pickBy = <T>(list: readonly T[], seed: number): T => list[seed % list.length];

/** The first option whose words appear in the text, else none. */
function read(words: string, table: readonly [RegExp, string][]): string | undefined {
  return table.find(([re]) => re.test(words))?.[1];
}

const HAIR_COLOR: readonly [RegExp, string][] = [
  [/\b(?:blond|blonde|golden)[- ]?hair|\bblondes?\b|\bblond\b/, "blonde"],
  [/\bred[- ]?head|\bginger\b|\bauburn\b|\bcopper[- ]hair|\bred[- ]hair/, "red"],
  [/\b(?:silver|grey|gray|white)[- ]hair/, "silver"],
  [/\bpink[- ]hair/, "pink"],
  [/\bblue[- ]hair/, "blue"],
  [/\b(?:black|dark|raven|jet[- ]black)[- ]hair/, "black"],
  [/\bbrunette\b|\bbrown[- ]hair/, "brunette"],
];
const EYES: readonly [RegExp, string][] = [
  [/\bblue[- ]eye/, "blue"],
  [/\bgreen[- ]eye/, "green"],
  [/\bhazel[- ]eye/, "hazel"],
  [/\b(?:grey|gray)[- ]eye/, "grey"],
  [/\b(?:brown|dark)[- ]eye/, "brown"],
];
const HAIR_STYLE: Record<Gender, readonly [RegExp, string][]> = {
  woman: [
    [/\bcurl/, "curly"],
    [/\bponytail/, "ponytail"],
    [/\bbun\b/, "bun"],
    [/\bbangs\b|\bfringe\b/, "bangs"],
    [/\bshort[- ]hair|\bbob\b|\bpixie\b/, "short"],
  ],
  man: [
    [/\bbuzz ?cut|\bshaved head/, "buzz"],
    [/\bman[- ]bun/, "bun"],
    [/\bcurl/, "curly"],
    [/\bslicked/, "slicked"],
    [/\blong[- ]hair/, "long"],
  ],
};
const BODY: Record<Gender, readonly [RegExp, string][]> = {
  woman: [
    [/\bathletic|\brunner\b|\bsporty\b|\bdancer\b|\bclimber\b/, "athletic"],
    [/\bcurvy\b/, "curvy"],
    [/\bplus[- ]size/, "plus"],
    [/\bslim\b|\bslender\b|\bwillowy\b|\blanky\b/, "slim"],
  ],
  man: [
    [/\bmuscular\b|\bburly\b|\bbodybuilder\b|\bstrongman\b/, "muscular"],
    [/\bathletic|\brunner\b|\bsporty\b|\bdancer\b|\bclimber\b/, "athletic"],
    [/\bstocky\b|\bportly\b/, "stocky"],
    [/\bslim\b|\bslender\b|\blanky\b|\bwiry\b/, "slim"],
  ],
};
const FACIAL_HAIR: readonly [RegExp, string][] = [
  [/\b(?:full|bushy|big|thick) beard/, "full_beard"],
  [/\bbeard/, "short_beard"],
  [/\bstubble/, "stubble"],
  [/\bmoustache|\bmustache/, "moustache"],
  [/\bclean[- ]shaven/, "clean"],
];
const OUTFIT: readonly [RegExp, string][] = [
  [/\bgoth/, "gothic"],
  [/\bpunk\b|\brocker\b|\bleather jacket/, "rocker"],
  [/\bvintage\b|\bretro\b|\b1950s\b/, "vintage"],
  [/\bpreppy\b/, "preppy"],
  [/\bboho|\bhippie\b|\bbohemian\b/, "boho"],
  [/\bcowboy|\bcowgirl|\brancher\b/, "western"],
  [/\bgym\b|\bathlete\b|\bpersonal trainer\b/, "sporty"],
];

/**
 * A look for the Look step, already picked, so Next works at once and the free portrait is drawn from picks instead of a
 * colour tile: what the words say about hair, eyes, build and clothes where they say it, and a pick seeded by the words
 * where they don't (so two characters don't get the same face). Dressed for their job when the builder has an outfit
 * for it (lib/looks.ts WORK_OUTFITS). Needs to know woman or man, the only two the picture tiles have; with neither
 * (they/them, or the words don't say) there is no suggestion and the step shows "Not picked yet", as before.
 * Ethnicity is never guessed from a sentence: unset, it stays theirs to pick. Every id is one LooksInput accepts.
 */
export function suggestLooks(o: { pronouns: string; words: string; occupation?: string | null }): Looks | undefined {
  const gender: Gender | null = o.pronouns === "she/her" ? "woman" : o.pronouns === "he/him" ? "man" : null;
  if (!gender) return undefined;
  const words = ` ${o.words.toLowerCase().replace(/\s+/g, " ")} `;
  const seed = hashOf(words);
  const ids = (step: string) => optionsFor(LOOK_STEPS.find((s) => s.id === step)!, gender).map((opt) => opt.id);
  const valid = (step: string, id: string | undefined) => (id && ids(step).includes(id) ? id : undefined);
  const job = (o.occupation ?? "").toLowerCase();
  const worksIn = Boolean(job) && WORK_OUTFITS.some((w) => w.match.test(job));

  const looks: Looks = {
    gender,
    style: artStyleInWords(words),
    eyes: valid("eyes", read(words, EYES)) ?? pickBy(ids("eyes"), seed),
    hair_color: valid("hair_color", read(words, HAIR_COLOR)) ?? pickBy(["brunette", "black", "blonde", "red"], seed >>> 3),
    hair_style: valid("hair_style", read(words, HAIR_STYLE[gender])) ?? pickBy(gender === "man" ? ["short", "curly", "slicked", "long"] : ["straight", "curly", "short", "ponytail", "bangs"], seed >>> 6),
    body: valid("body", read(words, BODY[gender])) ?? "average",
    outfit: worksIn ? "work" : (valid("outfit", read(words, OUTFIT)) ?? pickBy(["casual", "smart", "cozy", "street"], seed >>> 9)),
  };
  if (gender === "man") looks.facial_hair = valid("facial_hair", read(words, FACIAL_HAIR)) ?? pickBy(["clean", "stubble", "short_beard"], seed >>> 12);
  return looks;
}

/* ------------------------------------------------------------------------------------------------------------ *
 * From the reading to a draft
 * ------------------------------------------------------------------------------------------------------------ */

export type ExpressDraft = {
  ok: true;
  /** The builder's fields (the shape /import hands over), with a suggested look in extras.looks when there is one. */
  draft: ImportedDraft;
  /** Name, adult age, bio, three traits, want and dealbreaker are all in: the builder goes on to Look. */
  ready: boolean;
  /** What the form still has to ask for, in words (lib/import-character.ts stillMissing). */
  missing: string[];
  /** What the show made up rather than read: said on the review so nobody takes it for their own words. */
  invented: { name: boolean; age: boolean };
  /** Fields left out, and why (the reader's PG screen). */
  dropped: { field: string; why: string }[];
};
export type ExpressRefusal = { ok: false; reason: ExpressFailure; message: string };

/** Surname particles that stay lower case inside a name ("Anouk van der Berg"), longest first. */
const NAME_PARTICLES = ["della", "van", "von", "der", "den", "del", "ter", "ten", "de", "di", "da", "du", "le", "la"];
const GLUED_PARTICLES = new RegExp(`^((?:${NAME_PARTICLES.join("|")})+)(\\p{Lu}.*)$`, "u");

/** "vanden" → ["van", "den"], or the run whole when it doesn't split into particles. */
function splitParticles(run: string): string[] {
  const out: string[] = [];
  let rest = run;
  while (rest) {
    const p = NAME_PARTICLES.find((x) => rest.startsWith(x));
    if (!p) return [run];
    out.push(p);
    rest = rest.slice(p.length);
  }
  return out;
}

/**
 * The model's invented name in a name's own casing (2026-11-22 audit: "Storm vandenBosch"): particles glued to a surname
 * come apart ("Storm van den Bosch"), particles after the first name stay lower case, and any other word starting in lower
 * case gets its capital ("storm" → "Storm"). A name someone typed is theirs and never passes through here. Pure.
 */
export function tidyNameCase(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((w, i) => {
      const glued = i > 0 ? GLUED_PARTICLES.exec(w) : null;
      if (glued) return [...splitParticles(glued[1]), glued[2]];
      if (i > 0 && NAME_PARTICLES.includes(w)) return [w];
      return [/^\p{Ll}/u.test(w) ? w[0].toUpperCase() + w.slice(1) : w];
    })
    .join(" ");
}

/**
 * The model's reading and the person's own words, as a draft for the builder (pure). The name they typed wins over the
 * model's; the age follows adultAge; everything then goes through the import reader's mapping and screen
 * (importFromFields: cut to the builder's limits, a minor or a real person's name refuses the whole thing, a field that
 * isn't PG is left out). A bio the reader lost falls back to their own words, so the form never opens emptier than the
 * box was. The name may still be empty (the model gave none, or it was dropped): the route invents one that's free.
 */
export function draftFromReading(reading: SourceFields, text: string, givenName = ""): ExpressDraft | ExpressRefusal {
  const typed = givenName.trim().slice(0, NAME_MAX);
  if (statedUnderage(text)) return { ok: false, reason: "minor", message: CHARACTER_REJECTION_MESSAGES.minor };
  const age = adultAge(text, reading.age);
  const fields: SourceFields = { ...reading, age: age ? String(age.age) : undefined };
  if (typed) fields.name = typed;
  else if (fields.name) fields.name = tidyNameCase(fields.name);
  if (!fields.description?.trim()) fields.description = text;
  const result = importFromFields("free_text", fields, `${text}\n${typed}`);
  if (!result.ok) {
    const reason: ExpressFailure = result.reason === "minor" ? "minor" : result.reason === "real_person" ? "real_person" : "unreadable";
    return { ok: false, reason, message: result.message };
  }
  const draft = result.draft;
  if (!draft.sheet.bio) draft.sheet.bio = text.trim();
  const looks = suggestLooks({ pronouns: draft.pronouns, words: `${text} ${draft.appearance}`, occupation: draft.extras.occupation });
  if (looks) draft.extras = { ...draft.extras, looks };
  return {
    ok: true,
    draft,
    ready: readyToDate(draft),
    missing: stillMissing(draft),
    invented: { name: Boolean(draft.sheet.name) && !typed, age: Boolean(age?.invented) },
    dropped: result.dropped,
  };
}

/* ------------------------------------------------------------------------------------------------------------ *
 * The engagement events (the beacon never sends in dev or headless runs, so tests pin them as data)
 * ------------------------------------------------------------------------------------------------------------ */

export type ExpressEvent = { name: "express_started" | "express_drafted" | "express_failed"; props: Record<string, string | number | boolean | null> };

/** "Meet them" was tapped: how much they wrote, whether they named them, whether an example filled the box. Never the words. */
export function expressStartedEvent(o: { length: number; named: boolean; example: boolean }): ExpressEvent {
  return { name: "express_started", props: { length: o.length, named: o.named, example: o.example } };
}

/** A draft came back: ready (on to Look) or short (the form, with what came in), and whether a look was suggested. */
export function expressDraftedEvent(o: { ready: boolean; invented_name: boolean; look: boolean }): ExpressEvent {
  return { name: "express_drafted", props: { ready: o.ready, invented_name: o.invented_name, look: o.look } };
}

/** No draft: why. The form opened with their words in the bio. */
export function expressFailedEvent(reason: ExpressFailure): ExpressEvent {
  return { name: "express_failed", props: { reason } };
}

/** The same event with where the sentence was typed, when that wasn't /create itself (the home page's box: "home"). */
export function expressEventAt(ev: ExpressEvent, place: string | null): ExpressEvent {
  return place ? { name: ev.name, props: { ...ev.props, place } } : ev;
}
