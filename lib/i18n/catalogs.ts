/**
 * Every language's catalog (lib/i18n/messages/<code>.ts), keyed by the English. Server-side only: the browser gets one
 * language's `client` half through app/I18nProvider.tsx, never all seven.
 */
import de from "./messages/de";
import es from "./messages/es";
import fr from "./messages/fr";
import id from "./messages/id";
import ja from "./messages/ja";
import ko from "./messages/ko";
import pt from "./messages/pt";
import type { Locale } from "./locales";
import type { Catalog, Catalogs } from "./translate";

export const CATALOGS: Catalogs = { es, pt, fr, de, ja, ko, id };

export const catalogFor = (locale: Locale): Catalog | null => (locale === "en" ? null : CATALOGS[locale]);
