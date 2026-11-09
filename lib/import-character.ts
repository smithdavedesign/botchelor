/**
 * "Bring your character" (/import): what someone pastes from another chat app, turned into a pre-filled draft for the
 * /create wizard. Deterministic wherever the source is labelled:
 *
 *  - Character.AI-style creator fields, pasted as text: Name, Tagline, Description, Greeting, Definition.
 *  - TavernAI / SillyTavern character cards: "chara_card_v2" (and v3) JSON, the older v1 JSON (name, description,
 *    personality, scenario, first_mes, mes_example), Pygmalion's char_name / char_persona / char_greeting, and a card
 *    PNG with the JSON in its "chara" text chunk (cardJsonFromPng).
 *  - Inside any of those, labelled lines ("Age: 27", "Likes: tea, rain") and W++ (`Age("27") Likes("tea" + "rain")`).
 *
 * Only unlabelled free text goes to a model (app/api/characters/import, on the show's free model); its answer comes back
 * as the same labelled fields and goes through mapSource like everything else.
 *
 * Nothing here is trusted: every field is cut to the builder's limits, and screenDraft runs the show's own sheet filter
 * (lib/safety.ts): a source that suggests a minor anywhere, or a real person's name, is refused whole; a field that
 * isn't PG is left out and named. The wizard's own checks (name taken, originality, the save's filter) still apply.
 * Pure: runs in the browser (the /import page) and in tests.
 */
import { MAX_HOBBIES, SAMPLE_LINE_MAX, TEXT_DETAILS, type CharacterExtras } from "./extras";
import { APPEARANCE_MAX, BIO_MAX, DEALBREAKER_MAX, NAME_MAX, TRAIT_MAX, WANT_MAX } from "./field-limits";
import { VOICE_MAX } from "./rules";
import { checkFields, sheetPgIssue, CHARACTER_REJECTION_MESSAGES } from "./safety";

export const IMPORT_PATH = "/import";
/** The landing page for people moving their characters from a chat app (app/alternatives/character-ai). */
export const CHARACTER_AI_ALTERNATIVE_PATH = "/alternatives/character-ai";
/** Where /import leaves the draft for /create?imported=1 (this browser only; read once, then removed). */
export const IMPORT_STORAGE_KEY = "botchelor:import:v1";
/** The longest paste or file the page reads (a big SillyTavern card with a lorebook is ~100 KB). */
export const IMPORT_TEXT_MAX = 200_000;
/** The most unlabelled text sent to the model (app/api/characters/import): the free tier's quota is shared with the show. */
export const IMPORT_FREE_TEXT_MAX = 6_000;
const MIN_AGE = 18;
const MAX_AGE = 1000;
const MAX_NAME_WORDS = 5;
const HOBBY_MAX = 30;

export type ImportFormat = "chara_card_v2" | "chara_card_v3" | "tavern_v1" | "pygmalion" | "json" | "labelled" | "free_text";

/** The fields other apps have, by what they mean. Every one optional. */
export type SourceFields = {
  name?: string;
  tagline?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  greeting?: string;
  examples?: string;
  definition?: string;
  /** Attributes a model read out of free text (the import route), or that a source labels directly. */
  age?: string;
  gender?: string;
  appearance?: string;
  occupation?: string;
  likes?: string;
  dislikes?: string;
  wants?: string;
  speech?: string;
  catchphrase?: string;
};
export const SOURCE_KEYS = [
  "name", "tagline", "description", "personality", "scenario", "greeting", "examples", "definition",
  "age", "gender", "appearance", "occupation", "likes", "dislikes", "wants", "speech", "catchphrase",
] as const satisfies readonly (keyof SourceFields)[];

export type ReadSource = { format: ImportFormat; fields: SourceFields; freeText: string | null };

/** The builder's fields, as /create's draft holds them. */
export type ImportedDraft = {
  sheet: { name: string; age: string; bio: string; want: string; dealbreaker: string };
  traits: [string, string, string];
  pronouns: string;
  voice: string;
  appearance: string;
  extras: CharacterExtras;
};

export type ImportResult =
  | {
      ok: true;
      format: ImportFormat;
      draft: ImportedDraft;
      /** What came in, in words ("name", "bio", "3 traits"…). */
      filled: string[];
      /** What the builder still needs before they can be created. */
      missing: string[];
      /** Fields left out, and why. */
      dropped: { field: string; why: string }[];
    }
  | { ok: false; reason: "empty" | "minor" | "real_person" | "unreadable"; message: string };

/* ------------------------------------------------------------------------------------------------------------ *
 * Reading the source
 * ------------------------------------------------------------------------------------------------------------ */

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);

/** A parsed JSON object's fields, whichever card format it is; null when it isn't one we know. */
function fromJson(obj: Record<string, unknown>): { format: ImportFormat; fields: SourceFields } | null {
  const spec = str(obj.spec);
  const data = obj.data && typeof obj.data === "object" ? (obj.data as Record<string, unknown>) : null;
  if (data && (spec === "chara_card_v2" || spec === "chara_card_v3" || str(data.name))) {
    const inner = fromJson({ ...data, spec: undefined, data: undefined });
    return inner ? { format: spec === "chara_card_v3" ? "chara_card_v3" : "chara_card_v2", fields: inner.fields } : null;
  }
  if (str(obj.char_name) || str(obj.char_persona) || str(obj.char_greeting)) {
    return {
      format: "pygmalion",
      fields: {
        name: str(obj.char_name),
        personality: str(obj.char_persona),
        scenario: str(obj.world_scenario),
        greeting: str(obj.char_greeting),
        examples: str(obj.example_dialogue),
      },
    };
  }
  const fields: SourceFields = {
    name: str(obj.name) ?? str(obj.character_name) ?? str(obj.participant__name),
    tagline: str(obj.tagline) ?? str(obj.title),
    description: str(obj.description) ?? str(obj.short_description),
    personality: str(obj.personality),
    scenario: str(obj.scenario),
    greeting: str(obj.first_mes) ?? str(obj.greeting),
    examples: str(obj.mes_example) ?? str(obj.example_dialogue),
    definition: str(obj.definition) ?? str(obj.long_description),
  };
  const tavern = "first_mes" in obj || "mes_example" in obj;
  const known = Object.values(fields).filter(Boolean).length;
  if (!fields.name && known < 2) return null;
  return { format: tavern ? "tavern_v1" : "json", fields };
}

/** The labels a creator page uses for a whole field: Character.AI's, SillyTavern's, and the usual ways people copy them. */
const SECTION_LABELS: [RegExp, keyof SourceFields][] = [
  [/^(?:character'?s? )?name$/, "name"],
  [/^(?:tagline|title|short description)$/, "tagline"],
  [/^(?:description|long description|about|bio|character description)$/, "description"],
  [/^(?:personality|personality summary)$/, "personality"],
  [/^(?:scenario|setting)$/, "scenario"],
  [/^(?:greeting|first message|first mes|first_mes|opening message|intro message)$/, "greeting"],
  [/^(?:example dialogue|example dialog|example messages|example chats?|examples of dialogue|mes_example|dialogue examples)$/, "examples"],
  [/^(?:definition|advanced definition|character definition)$/, "definition"],
];

function sectionKey(label: string): keyof SourceFields | null {
  const l = label.toLowerCase().replace(/[*_#]/g, "").replace(/\s+/g, " ").trim();
  return SECTION_LABELS.find(([re]) => re.test(l))?.[1] ?? null;
}

const LABEL_LINE = /^\s*(?:#{1,6}\s*)?\**\s*([A-Za-z][A-Za-z' _]{1,40}?)\s*\**\s*[:：]\s*\**\s*(.*)$/;

/** Pasted text with the creator page's labels ("Name: …", "Greeting: …"); null when it has none. */
function fromLabelled(text: string): SourceFields | null {
  const fields: Partial<Record<keyof SourceFields, string[]>> = {};
  let current: keyof SourceFields | null = null;
  let labels = 0;
  for (const line of text.split(/\r?\n/)) {
    const m = LABEL_LINE.exec(line);
    const key = m ? sectionKey(m[1]) : null;
    // A section's label with its text after the colon…
    if (m && key) {
      current = key;
      labels++;
      (fields[key] ??= []).push(m[2]);
      continue;
    }
    // …or alone on its line above it, as copying a creator page's form gives ("Greeting", then the greeting).
    const bare = line.trim().length <= 30 ? sectionKey(line.replace(/[:：]\s*$/, "")) : null;
    if (bare) {
      current = bare;
      labels++;
      fields[bare] ??= [];
      continue;
    }
    if (current) (fields[current] ??= []).push(line);
  }
  // One label is the start of a free-text blob ("Description: she runs a bakery…"), two or a name is a form.
  if (labels === 0 || (labels === 1 && !fields.name)) return null;
  const out: SourceFields = {};
  for (const [k, lines] of Object.entries(fields) as [keyof SourceFields, string[]][]) {
    const v = lines.join("\n").trim();
    if (v) out[k] = v;
  }
  return out;
}

/** What someone pasted (or a file's text): its format and its fields. Null when there's nothing to read. */
export function readSource(raw: string): ReadSource | null {
  const text = raw.replace(/^﻿/, "").slice(0, IMPORT_TEXT_MAX).trim();
  if (!text) return null;
  if (/^[{[]/.test(text)) {
    try {
      const parsed: unknown = JSON.parse(text);
      const obj = Array.isArray(parsed) ? parsed[0] : parsed;
      if (obj && typeof obj === "object") {
        const got = fromJson(obj as Record<string, unknown>);
        if (got) return { ...got, freeText: null };
      }
    } catch {
      /* not JSON after all: read it as text */
    }
  }
  const labelled = fromLabelled(text);
  if (labelled) return { format: "labelled", fields: labelled, freeText: null };
  return { format: "free_text", fields: {}, freeText: text };
}

/**
 * A character card PNG's JSON (the "chara" tEXt chunk SillyTavern and TavernAI write, base64; v3's "ccv3" preferred), or
 * null when the image has none. Reads the chunks only, never the picture.
 */
export function cardJsonFromPng(bytes: Uint8Array): string | null {
  const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 8 || SIG.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const latin1 = (a: number, b: number) => String.fromCharCode(...bytes.subarray(a, b));
  const found: Record<string, string> = {};
  let at = 8;
  while (at + 8 <= bytes.length) {
    const len = view.getUint32(at);
    const type = latin1(at + 4, at + 8);
    const start = at + 8;
    const end = start + len;
    if (end > bytes.length) break;
    if (type === "tEXt" || type === "iTXt") {
      const zero = bytes.indexOf(0, start);
      if (zero > start && zero < end) {
        const keyword = latin1(start, zero).toLowerCase();
        if (keyword === "chara" || keyword === "ccv3") {
          let textStart = zero + 1;
          if (type === "iTXt") {
            if (bytes[textStart] !== 0) {
              at = end + 4;
              continue; // compressed iTXt: not something card tools write
            }
            textStart += 2;
            const lang = bytes.indexOf(0, textStart);
            const translated = lang >= 0 ? bytes.indexOf(0, lang + 1) : -1;
            if (translated < 0 || translated >= end) {
              at = end + 4;
              continue;
            }
            textStart = translated + 1;
          }
          let b64 = "";
          for (let i = textStart; i < end; i += 8192) b64 += String.fromCharCode(...bytes.subarray(i, Math.min(end, i + 8192)));
          try {
            const bin = atob(b64.trim());
            const out = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
            found[keyword] = new TextDecoder().decode(out);
          } catch {
            /* not base64: skip */
          }
        }
      }
    }
    if (type === "IEND") break;
    at = end + 4;
  }
  return found.ccv3 ?? found.chara ?? null;
}

/* ------------------------------------------------------------------------------------------------------------ *
 * Mapping to the builder's fields
 * ------------------------------------------------------------------------------------------------------------ */

/** {{char}} becomes their name, {{user}} "you"; HTML and markdown emphasis go. */
function clean(text: string | undefined, name: string): string {
  if (!text) return "";
  return text
    .replace(/\{\{\s*char\s*\}\}|<\s*bot\s*>|\{\{\s*bot\s*\}\}/gi, name || "they")
    .replace(/\{\{\s*user\s*\}\}|<\s*user\s*>/gi, "you")
    .replace(/<[^>]{1,40}>/g, " ")
    .replace(/[*_]{2,}/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Cut to `max` characters at a sentence end, else a word end, never mid-word. */
export function cutTo(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max + 1);
  const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (sentence >= max * 0.4) return head.slice(0, sentence + 1).trim();
  const space = head.lastIndexOf(" ");
  return (space > 0 ? head.slice(0, space) : head.slice(0, max)).replace(/[,;:\-–—]+$/, "").trim();
}

/** Roleplay actions (*smiles*, (waves)) out of a line, leaving what's said. */
function speechOnly(line: string): string {
  const quoted = /["“]([^"”]{2,})["”]/.exec(line)?.[1];
  if (quoted) return quoted.trim();
  return line
    .replace(/\*[^*]*\*/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Attribute labels inside a description or definition ("Age: 27", "- Likes: tea, rain"), by meaning. */
const ATTRIBUTES: [RegExp, keyof SourceFields][] = [
  [/^age$/, "age"],
  [/^(?:gender|sex|pronouns)$/, "gender"],
  [/^(?:appearance|looks|physical appearance|features|outfit|clothes|clothing|style)$/, "appearance"],
  [/^(?:occupation|job|profession|work|career|role)$/, "occupation"],
  [/^(?:likes|loves|hobbies|interests|hobby|passions)$/, "likes"],
  [/^(?:dislikes|hates|pet peeves|dislike)$/, "dislikes"],
  [/^(?:wants|goal|goals|desires|wishes|dream|dreams|motivation)$/, "wants"],
  [/^(?:speech|speech style|speaking style|voice|way of speaking|speech pattern|speech patterns|talks)$/, "speech"],
  [/^(?:catchphrase|catch phrase|quote)$/, "catchphrase"],
  [/^(?:personality|traits|personality traits|mind|nature)$/, "personality"],
];

function attributeKey(label: string): keyof SourceFields | null {
  const l = label.toLowerCase().replace(/[*_#"']/g, "").replace(/\s+/g, " ").trim();
  return ATTRIBUTES.find(([re]) => re.test(l))?.[1] ?? null;
}

/** Labelled lines and W++ attributes in a longer text, plus that text with them taken out (its prose). */
export function readAttributes(text: string): { attrs: Partial<Record<keyof SourceFields, string>>; prose: string } {
  const attrs: Partial<Record<keyof SourceFields, string>> = {};
  const put = (k: keyof SourceFields, v: string) => {
    const value = v.trim();
    if (value && !attrs[k]) attrs[k] = value;
  };
  // W++ / Ali:Chat: Key("a" + "b") or Key: ("a" + "b"), usually inside [character("Name") { … }].
  let body = text.replace(/([A-Za-z][A-Za-z ]{1,30})\s*[:=]?\s*\(\s*((?:"[^"]*"\s*\+?\s*)+)\)/g, (_all, key: string, vals: string) => {
    const k = attributeKey(key);
    const list = [...vals.matchAll(/"([^"]*)"/g)].map((m) => m[1].trim()).filter(Boolean);
    if (k) put(k, list.join(", "));
    return " ";
  });
  // Boostyle and friends: [Personality= "a" + "b"] / Likes = [a, b]
  body = body.replace(/^[ \t]*[-*•[]?[ \t]*([A-Za-z][A-Za-z' ]{1,30}?)[ \t]*[:=：][ \t]*(.+)$/gm, (all, key: string, value: string) => {
    const k = attributeKey(key);
    if (!k) return all;
    put(k, value.replace(/[[\]{}"]/g, "").replace(/\s*\+\s*/g, ", "));
    return "";
  });
  const prose = body
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[{}]/g, " ")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && /[a-z]{3,}.*\s.*[a-z]{2,}/i.test(l))
    .join("\n");
  return { attrs, prose };
}

/** Short traits from a list ("shy, kind + curious", "Shy. Kind."), or none when it's prose. */
export function traitsFrom(list: string | undefined): string[] {
  if (!list) return [];
  const items = list
    .split(/[,;+|\n•/]|\s-\s|\.\s+|\band\b/i)
    .map((s) => s.replace(/^[\s\-*"'([]+|[\s"')\].!]+$/g, "").trim())
    .filter((s) => s && s.length <= TRAIT_MAX && s.split(/\s+/).length <= 3 && /^[\p{L}][\p{L}' -]*$/u.test(s));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of items) {
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
    if (out.length === 3) break;
  }
  return out;
}

function listItems(list: string | undefined, max: number, each: number): string[] {
  if (!list) return [];
  return [
    ...new Set(
      list
        .split(/[,;+|\n•]|\.\s+/)
        .map((s) => s.replace(/^[\s\-*"'([]+|[\s"')\].!]+$/g, "").trim())
        .filter((s) => s && s.length <= each),
    ),
  ].slice(0, max);
}

/** The age a source states, as a number; null when it doesn't say or says something that isn't one. */
export function statedAge(attr: string | undefined, prose: string): number | null {
  const fromAttr = attr ? /\d{1,4}/.exec(attr)?.[0] : undefined;
  if (fromAttr) return Number(fromAttr);
  const m = /\b(\d{1,4})[ -]?(?:years?[ -]old|yrs?[ -]old|y\/o|yo)\b/i.exec(prose) ?? /\b(?:aged?|age of)\s+(\d{1,4})\b/i.exec(prose);
  return m ? Number(m[1]) : null;
}

function pronounsFrom(gender: string | undefined, prose: string): string {
  const g = (gender ?? "").toLowerCase();
  if (/they\s*\/\s*them|non[- ]?binary|\benby\b|agender/.test(g)) return "they/them";
  if (/she\s*\/\s*her|\b(?:female|woman|girl|feminine|f)\b/.test(g)) return "she/her";
  if (/he\s*\/\s*him|\b(?:male|man|boy|masculine|m)\b/.test(g)) return "he/him";
  if (g) return "";
  // No label: only when the prose is clear about it (one set of pronouns, used a few times).
  const she = (prose.match(/\b(?:she|her|hers|herself)\b/gi) ?? []).length;
  const he = (prose.match(/\b(?:he|him|his|himself)\b/gi) ?? []).length;
  if (she >= 3 && he === 0) return "she/her";
  if (he >= 3 && she === 0) return "he/him";
  return "";
}

/** The first line a character says in an example dialogue ("{{char}}: …", "<START>" blocks). */
function firstExampleLine(examples: string, name: string): string {
  const who = [name, name.split(/\s+/)[0], "{{char}}", "<bot>", "char"].filter(Boolean).map((n) => n.toLowerCase());
  for (const line of examples.split(/\r?\n/)) {
    const m = /^\s*([^:]{1,40}):\s*(.+)$/.exec(line);
    if (m && who.includes(m[1].trim().toLowerCase())) {
      const said = speechOnly(clean(m[2], name));
      if (said.length >= 8) return said;
    }
  }
  return "";
}

/** A name fit for the builder: no "(from Some Show)" or emoji, five words at most. */
function cleanName(raw: string | undefined): string {
  if (!raw) return "";
  const n = raw
    .split(/\r?\n/)[0]
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/[^\p{L}\p{N}' .-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return n.split(" ").slice(0, MAX_NAME_WORDS).join(" ").slice(0, NAME_MAX).trim();
}

/** The builder's fields from a source's, and what came in. Unscreened: screenDraft does that. */
export function mapSource(fields: SourceFields): { draft: ImportedDraft; filled: string[] } {
  const name = cleanName(fields.name);
  const long = [fields.description, fields.definition, fields.personality].map((t) => clean(t, name)).filter(Boolean).join("\n");
  const { attrs, prose } = readAttributes(long);
  const pick = (k: keyof SourceFields) => clean(fields[k], name) || attrs[k] || "";
  // A personality section can carry labelled lines after its list ("shy, kind\nLikes: tea"): its own list only.
  const ownPersonality = (() => {
    const text = clean(fields.personality, name);
    if (!text) return attrs.personality ?? "";
    const r = readAttributes(text);
    return r.attrs.personality ?? text.split(/\r?\n/).filter((l) => !LABEL_LINE.test(l) && !/\("/.test(l)).join("\n");
  })();

  // The bio: the tagline and a short description when the app has them (Character.AI), else the description's prose.
  const tagline = clean(fields.tagline, name);
  const descProse = readAttributes(clean(fields.description, name)).prose;
  const defProse = readAttributes(clean(fields.definition, name)).prose;
  const persProse = readAttributes(clean(fields.personality, name)).prose;
  const body = [descProse, defProse, traitsFrom(persProse).length ? "" : persProse].find((t) => t.trim()) ?? "";
  const bioParts = [tagline, body && !(tagline && body.toLowerCase().includes(tagline.toLowerCase())) ? body : ""].filter(Boolean);
  const bio = cutTo(bioParts.map((p) => p.replace(/\s+/g, " ").trim().replace(/([^.!?])$/, "$1.")).join(" "), BIO_MAX);

  const traits = traitsFrom(ownPersonality).length ? traitsFrom(ownPersonality) : traitsFrom(attrs.personality);
  const age = statedAge(pick("age"), prose);
  const pronouns = pronounsFrom(pick("gender"), prose);
  const want = cutTo(pick("wants"), WANT_MAX);
  const dislikes = listItems(pick("dislikes"), 3, DEALBREAKER_MAX);
  const dealbreaker = dislikes[0] ?? "";
  const appearance = cutTo(pick("appearance"), APPEARANCE_MAX);
  const greeting = clean(fields.greeting, name);
  const hello = greeting ? cutTo(speechOnly(greeting.split(/\n\s*\n/)[0]), SAMPLE_LINE_MAX) : "";
  const example = fields.examples ? firstExampleLine(fields.examples, name) : "";
  const speech = pick("speech");
  const voice = speech ? cutTo(speech, VOICE_MAX) : example ? cutTo(`Talks like this: "${cutTo(example, VOICE_MAX - 20)}"`, VOICE_MAX) : "";

  const extras: CharacterExtras = {};
  if (hello) extras.lines = { hello };
  const occupation = cutTo(pick("occupation"), TEXT_DETAILS.occupation.max);
  if (occupation) extras.occupation = occupation;
  const catchphrase = cutTo(speechOnly(pick("catchphrase")), TEXT_DETAILS.catchphrase.max);
  if (catchphrase) extras.catchphrase = catchphrase;
  const hobbies = listItems(pick("likes"), MAX_HOBBIES, HOBBY_MAX);
  if (hobbies.length) extras.hobbies = hobbies;
  if (dislikes[1]) extras.pet_peeve = cutTo(dislikes[1], TEXT_DETAILS.pet_peeve.max);

  const draft: ImportedDraft = {
    sheet: { name, age: age === null ? "" : String(age), bio, want, dealbreaker },
    traits: [traits[0] ?? "", traits[1] ?? "", traits[2] ?? ""],
    pronouns,
    voice,
    appearance,
    extras,
  };
  return { draft, filled: filledFields(draft) };
}

/** What a draft has, in words ("name", "bio", "3 traits"…). */
export function filledFields(d: ImportedDraft): string[] {
  const traits = d.traits.filter(Boolean).length;
  const e = d.extras;
  return [
    d.sheet.name && "name",
    d.sheet.age && "age",
    d.pronouns && "pronouns",
    d.sheet.bio && "bio",
    traits > 0 && `${traits} trait${traits === 1 ? "" : "s"}`,
    d.sheet.want && "what they want",
    d.sheet.dealbreaker && "a dealbreaker",
    d.voice && "voice",
    e.lines?.hello && "how they say hello",
    d.appearance && "appearance",
    e.occupation && "occupation",
    e.hobbies?.length && "interests",
    e.catchphrase && "catchphrase",
    e.pet_peeve && "a pet peeve",
  ].filter((x): x is string => typeof x === "string" && x.length > 0);
}

/** The draft's public fields, by the names the wizard and its notes use. */
function draftFields(d: ImportedDraft): [string, string, (d: ImportedDraft) => void][] {
  const e = d.extras;
  return [
    ["bio", d.sheet.bio, (x) => void (x.sheet.bio = "")],
    ["traits", d.traits.join(", "), (x) => void (x.traits = ["", "", ""])],
    ["what they want", d.sheet.want, (x) => void (x.sheet.want = "")],
    ["dealbreaker", d.sheet.dealbreaker, (x) => void (x.sheet.dealbreaker = "")],
    ["appearance", d.appearance, (x) => void (x.appearance = "")],
    ["voice", d.voice, (x) => void (x.voice = "")],
    ["hello line", e.lines?.hello ?? "", (x) => void delete x.extras.lines],
    ["occupation", e.occupation ?? "", (x) => void delete x.extras.occupation],
    ["catchphrase", e.catchphrase ?? "", (x) => void delete x.extras.catchphrase],
    ["interests", (e.hobbies ?? []).join(", "), (x) => void delete x.extras.hobbies],
    ["pet peeve", e.pet_peeve ?? "", (x) => void delete x.extras.pet_peeve],
  ];
}

/**
 * The show's rules on an import: anything suggesting a minor, anywhere in the source (not only the fields that came
 * in), or a stated age under 18, refuses it; so does a real person's name. A field that isn't PG (the show's sheet
 * filter) is left out and named, so what reaches the builder is something it would save.
 */
export function screenDraft(draft: ImportedDraft, sourceText: string): { ok: true; draft: ImportedDraft; dropped: { field: string; why: string }[] } | { ok: false; reason: "minor" | "real_person"; message: string } {
  const age = draft.sheet.age ? Number(draft.sheet.age) : null;
  if (age !== null && age < MIN_AGE) return { ok: false, reason: "minor", message: CHARACTER_REJECTION_MESSAGES.minor };
  const whole = checkFields({ source: sourceText.slice(0, IMPORT_TEXT_MAX) });
  if (!whole.ok && whole.reason === "minor") return { ok: false, reason: "minor", message: CHARACTER_REJECTION_MESSAGES.minor };
  const named = checkFields({ name: draft.sheet.name });
  if (!named.ok && named.reason === "real_person") return { ok: false, reason: "real_person", message: CHARACTER_REJECTION_MESSAGES.real_person };

  const out: ImportedDraft = structuredClone(draft);
  const dropped: { field: string; why: string }[] = [];
  if (!named.ok) {
    out.sheet.name = "";
    dropped.push({ field: "name", why: "it isn't PG" });
  }
  if (age !== null && age > MAX_AGE) {
    out.sheet.age = "";
    dropped.push({ field: "age", why: `over ${MAX_AGE}` });
  }
  for (const [field, value, clear] of draftFields(out)) {
    if (!value) continue;
    const issue = sheetPgIssue(value);
    if (!issue) continue;
    if (issue === "minor") return { ok: false, reason: "minor", message: CHARACTER_REJECTION_MESSAGES.minor };
    clear(out);
    dropped.push({ field, why: issue === "real_person" ? "it names a real person" : "the show is PG" });
  }
  return { ok: true, draft: out, dropped };
}

/** What the builder still needs once the import is in (its first step, and the dating profile's minimum). */
export function stillMissing(d: ImportedDraft): string[] {
  const age = Number(d.sheet.age);
  return [
    !d.sheet.name && "a name",
    !(d.sheet.age && Number.isFinite(age) && age >= MIN_AGE) && "an adult age (18 or over)",
    !d.sheet.bio && "a bio",
    d.traits.some((t) => !t) && "three traits",
    !d.sheet.want && "what they want",
    !d.sheet.dealbreaker && "a dealbreaker",
    "two dating-profile answers",
    (d.extras.hobbies?.length ?? 0) < 2 && "two interests",
  ].filter((x): x is string => typeof x === "string");
}

/** Every step at once: read, map, screen. For a source that's free text, `fields` are what the model read out of it. */
export function importFromFields(format: ImportFormat, fields: SourceFields, sourceText: string): ImportResult {
  const { draft, filled } = mapSource(fields);
  if (filled.filter((f) => f !== "pronouns").length === 0) return { ok: false, reason: "unreadable", message: "We couldn't find a character in that. Paste its name, description and greeting, or the card's JSON." };
  const screened = screenDraft(draft, sourceText);
  if (!screened.ok) return screened;
  return {
    ok: true,
    format,
    draft: screened.draft,
    filled: filledFields(screened.draft),
    missing: stillMissing(screened.draft),
    dropped: screened.dropped,
  };
}

/** A labelled or card source, all the way to the builder's draft. Free text returns null: it needs the model first. */
export function importCharacter(raw: string): ImportResult | { ok: "free_text"; text: string } {
  const read = readSource(raw);
  if (!read) return { ok: false, reason: "empty", message: "Paste your character first." };
  if (read.format === "free_text") {
    // Refused before any model reads it.
    const whole = checkFields({ source: read.freeText ?? "" });
    if (!whole.ok && whole.reason === "minor") return { ok: false, reason: "minor", message: CHARACTER_REJECTION_MESSAGES.minor };
    return { ok: "free_text", text: (read.freeText ?? "").slice(0, IMPORT_FREE_TEXT_MAX) };
  }
  return importFromFields(read.format, read.fields, raw);
}

/**
 * Free text with no labels and no model to read it (the model is out of quota, or down): the whole of it as the bio,
 * and a name only when the first line is clearly one. Better than nothing, and every field is editable.
 */
export function freeTextFallback(text: string): SourceFields {
  const lines = text.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const first = lines[0] ?? "";
  const looksLikeName = first.length <= NAME_MAX && first.split(/\s+/).length <= 4 && /^[\p{Lu}][\p{L}' .-]*$/u.test(first);
  return looksLikeName ? { name: first, description: lines.slice(1).join("\n") } : { description: lines.join("\n") };
}

/** Human names for the formats, for the page's "Read as …" line. Nominative only: no affiliation is implied. */
export const FORMAT_LABELS: Record<ImportFormat, string> = {
  chara_card_v2: "a character card (V2, as SillyTavern exports)",
  chara_card_v3: "a character card (V3)",
  tavern_v1: "a TavernAI character card",
  pygmalion: "a Pygmalion character file",
  json: "character JSON",
  labelled: "labelled creator fields (name, greeting, definition…)",
  free_text: "a description, read by the show's model",
};
