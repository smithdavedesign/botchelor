/**
 * The site's languages (David, 2026-11-26: "can we offer it in our nav and across site? ideally the top 8 languages for
 * our market"). docs/i18n.md says why these eight and how a page is translated.
 *
 * English is the site's own language and every string's key: a string with no translation shows in English, so a page
 * nobody has translated yet still works. The codes are lib/language.ts's, so a visitor's language is also one a character
 * can speak (lib/character.ts speaks).
 *
 * Shared by the server and the browser: nothing here reads a request.
 */
import type { LanguageCode } from "@/lib/language";

export const LOCALES = ["en", "es", "pt", "fr", "de", "ja", "ko", "id"] as const satisfies readonly LanguageCode[];
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** The visitor's pick, from the nav's language menu (app/LanguagePicker.tsx). A year, like the theme's. */
export const LOCALE_COOKIE = "bz_lang";
export const LOCALE_MAX_AGE = 60 * 60 * 24 * 365;

/** Each language in its own words, for the menu: someone looking for theirs reads it in theirs. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  es: "Español",
  pt: "Português",
  fr: "Français",
  de: "Deutsch",
  ja: "日本語",
  ko: "한국어",
  id: "Bahasa Indonesia",
};

/** `<html lang>`: Portuguese is written for Brazil, where most of its speakers are. */
export const HTML_LANG: Record<Locale, string> = { en: "en", es: "es", pt: "pt-BR", fr: "fr", de: "de", ja: "ja", ko: "ko", id: "id" };

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && (LOCALES as readonly string[]).includes(v);

/**
 * The best of our languages for an Accept-Language header ("pt-BR,pt;q=0.9,en;q=0.8"), by its weights, or null when it
 * names none of them. A region doesn't matter ("es-MX" is Spanish); "in" is Indonesian's old code, which some Android
 * browsers still send.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .slice(0, 20)
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const weight = q ? Number(q.slice(2)) : 1;
      return { lang: tag.trim().toLowerCase().split("-")[0], weight: Number.isFinite(weight) ? weight : 0, i };
    })
    .filter((r) => r.lang && r.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.i - b.i);
  for (const r of ranked) {
    const lang = r.lang === "in" ? "id" : r.lang;
    if (isLocale(lang)) return lang;
  }
  return null;
}

/** The language a page is in: the visitor's pick, else their browser's, else English. */
export function pickLocale(cookie: string | null | undefined, acceptLanguage: string | null | undefined): Locale {
  if (isLocale(cookie)) return cookie;
  return localeFromAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE;
}

/** In the browser: keep the pick. The page is then refreshed by the caller (app/LanguagePicker.tsx). */
export function storeLocale(locale: Locale): void {
  if (typeof document === "undefined") return;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${LOCALE_COOKIE}=${locale}; Max-Age=${LOCALE_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
}

/**
 * The language a new character speaks when its creator picks none (David, 2026-11-27): the site's, so a visitor using the
 * site in Spanish makes a character whose dates and texts are in Spanish (lib/character.ts speaks). Null for English,
 * which leaves it unset: the sheet's own language, as before.
 */
export const newCharacterLanguage = (locale: Locale): Exclude<Locale, "en"> | null => (locale === "en" ? null : locale);
