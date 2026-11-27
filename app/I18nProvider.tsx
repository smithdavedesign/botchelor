"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locales";
import { english, translator, type Messages, type T } from "@/lib/i18n/translate";

/**
 * The page's language in the browser (docs/i18n.md). The root layout passes this request's language and its catalog's
 * `client` half (lib/i18n/server.ts clientMessages): only the strings client components show, in one language.
 */
const I18nContext = createContext<{ locale: Locale; t: T }>({ locale: DEFAULT_LOCALE, t: english });

export default function I18nProvider({ locale, messages, children }: { locale: Locale; messages: Messages; children: ReactNode }) {
  const value = useMemo(() => ({ locale, t: locale === DEFAULT_LOCALE ? english : translator(messages) }), [locale, messages]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** The translator for a client component: `const t = useT(); t("Watch")`. */
export const useT = (): T => useContext(I18nContext).t;
export const useLocale = (): Locale => useContext(I18nContext).locale;
