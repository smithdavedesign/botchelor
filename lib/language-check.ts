/**
 * The content filter for text in any language (David, 2026-10-31). lib/safety.ts matches English words, so a sheet or a
 * text in Spanish ("una adolescente de dieciséis años") passed it untouched. Text that isn't English is translated to
 * English by the show's model, faithfully, and the same filter reads the translation. When the model can't translate
 * it (out of quota, down), the text is refused with a try-again: an unread text never reaches the show.
 *
 * English, and text too short to name whose letters are all plain ASCII, costs nothing: the filter alone, as before.
 */
import { detectLanguage, languageName } from "./language";
import { getModel, type Model } from "./model";
import { checkFields, type SafetyResult } from "./safety";

type Fields = Record<string, string | readonly string[] | undefined>;

/** What an `unread` refusal tells whoever sent the text. */
export const UNREAD_MESSAGE = "The show couldn't check text in that language just now. Try again in a minute.";

/** Whether a text needs reading in English: it's in another language, or too short to name and not plain ASCII. */
export function needsTranslation(text: string): boolean {
  const lang = detectLanguage(text);
  if (lang) return lang !== "en";
  return /[^\x00-\x7F]/.test(text) && /\p{L}{2}/u.test(text.replace(/[\x00-\x7F]/g, ""));
}

const TRANSLATE_PROMPT =
  "You translate text into English for a content check. Translate every value faithfully and literally: keep every age, " +
  "relationship, body part and sexual or violent word exactly as strong as it is. Never soften, summarize, refuse or " +
  'leave anything out. Reply with ONLY a JSON object with the same keys, each value its English translation (a list stays a list).';

/** A few hundred recent translations, so an unchanged sheet saved twice costs one call. */
const cache = new Map<string, string>();
const CACHE_MAX = 500;

let modelForTests: Model | null = null;
/** Tests: the model that translates (null: the show's model, lib/model.ts getModel). */
export function setTranslatorForTests(model: Model | null): void {
  modelForTests = model;
}

/**
 * Each text that needs it, in English: one model call for all of them. Null when the model couldn't (an error, or a
 * reply without every key), so the caller refuses rather than letting an unread text through.
 */
export async function inEnglish(texts: Record<string, string>, model?: Model): Promise<Record<string, string> | null> {
  const out: Record<string, string> = {};
  const todo: Record<string, string> = {};
  for (const [k, v] of Object.entries(texts)) {
    const hit = cache.get(v);
    if (hit !== undefined) out[k] = hit;
    else todo[k] = v;
  }
  if (Object.keys(todo).length === 0) return out;
  try {
    const raw = await (model ?? modelForTests ?? getModel()).complete(
      [
        { role: "system", content: TRANSLATE_PROMPT },
        { role: "user", content: JSON.stringify(todo) },
      ],
      { temperature: 0 },
    );
    const json = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")) as Record<string, unknown>;
    for (const [k, v] of Object.entries(todo)) {
      const got = json[k];
      const english = typeof got === "string" ? got : Array.isArray(got) ? got.filter((x) => typeof x === "string").join(" ") : null;
      if (!english?.trim()) return null;
      out[k] = english;
      cache.set(v, english);
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * lib/safety.ts checkFields, for text in any language: the filter on the words as written, then, for any text that
 * isn't English, on its English translation. A refusal names the field as written. `unread` when the translation
 * couldn't be made (try again).
 */
export async function checkFieldsAnyLanguage(fields: Fields, opts: { model?: Model; check?: (fields: Fields) => SafetyResult } = {}): Promise<SafetyResult> {
  const check = opts.check ?? checkFields;
  const first = check(fields);
  if (!first.ok) return first;
  // Each text that needs reading, keyed "field" or "field.i" for a list's items. When the whole of it isn't English, every
  // field is read: a one-word trait in Spanish is plain ASCII and too short to name on its own.
  const entries = Object.entries(fields).flatMap(([field, value]) => {
    const list = value === undefined ? [] : typeof value === "string" ? [value] : value;
    return list.map((text, i) => [typeof value === "string" ? field : `${field}.${i}`, text] as const);
  });
  const whole = needsTranslation(entries.map(([, text]) => text).join("\n"));
  const texts: Record<string, string> = {};
  for (const [key, text] of entries) if (text && (needsTranslation(text) || (whole && /\p{L}{2}/u.test(text)))) texts[key] = text;
  if (Object.keys(texts).length === 0) return first;
  const english = await inEnglish(texts, opts.model);
  if (!english) {
    const field = Object.keys(texts)[0].split(".")[0];
    return { ok: false, reason: "unread", field, language: languageName(detectLanguage(texts[Object.keys(texts)[0]])) ?? undefined };
  }
  const second = check(english);
  return second.ok ? second : { ...second, field: second.field.split(".")[0] };
}
