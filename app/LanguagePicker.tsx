"use client";

import { useState } from "react";
import Icon from "@/app/Icon";
import { useLocale, useT } from "@/app/I18nProvider";
import { HTML_LANG, isLocale, LOCALE_NAMES, LOCALES, storeLocale } from "@/lib/i18n/locales";

/**
 * The nav's language menu (docs/i18n.md; David, 2026-11-26): every language the site speaks, each in its own words.
 * A pick is kept in a cookie and the page loads again in it. In the bar on a wide
 * screen (a globe and the code), a row in the phone's menu.
 */
export default function LanguagePicker() {
  const locale = useLocale();
  const t = useT();
  const [pending, setPending] = useState(false);
  return (
    <label className="nav-lang" data-pending={pending || undefined} title={t("Language")}>
      <Icon name="globe" className="nav-lang-icon" />
      <span className="nav-lang-code" aria-hidden="true">
        {locale.toUpperCase()}
      </span>
      <span className="nav-lang-label">{t("Language")}</span>
      <select
        className="nav-lang-select"
        aria-label={t("Language")}
        value={locale}
        onChange={(e) => {
          const next = e.target.value;
          if (!isLocale(next)) return;
          storeLocale(next);
          document.documentElement.lang = HTML_LANG[next];
          setPending(true);
          // A reload, not a client refresh: every client-side cache on the page is in the old language too.
          window.location.reload();
        }}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
