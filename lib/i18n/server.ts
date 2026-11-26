/**
 * The page's language on the server (docs/i18n.md): the nav's pick (the `bz_lang` cookie), else the browser's
 * Accept-Language, else English. Read once a request.
 *
 * Reading the cookie makes a page dynamic, as the root layout's cookies() already does for every page of the show.
 */
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { afterDarkOnly } from "@/lib/after-dark-host";
import { catalogFor } from "./catalogs";
import { DEFAULT_LOCALE, LOCALE_COOKIE, pickLocale, type Locale } from "./locales";
import { english, translator, type Messages, type T } from "./translate";

/**
 * After Dark stays in English (docs/languages.md: its checks read English until they're proven in other languages), so
 * its own host is always English.
 */
export const getLocale = cache(async (): Promise<Locale> => {
  if (afterDarkOnly()) return DEFAULT_LOCALE;
  const [cookieStore, h] = await Promise.all([cookies(), headers()]);
  return pickLocale(cookieStore.get(LOCALE_COOKIE)?.value, h.get("accept-language"));
});

/** A translator for this request's language, over both halves of its catalog. */
export const getT = cache(async (): Promise<T> => tFor(await getLocale()));

export function tFor(locale: Locale): T {
  const c = catalogFor(locale);
  return c ? translator({ ...c.server, ...c.client }) : english;
}

/** The browser's half, for app/I18nProvider.tsx. */
export function clientMessages(locale: Locale): Messages {
  return catalogFor(locale)?.client ?? {};
}
