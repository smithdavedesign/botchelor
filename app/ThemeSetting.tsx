"use client";

import { useState } from "react";
import { applyTheme, THEME_LABELS, THEMES, type Theme } from "@/lib/theme";

/**
 * Appearance, on /account (docs/brand.md, Themes): Light, Dark or System. The design system keeps the theme setting
 * here, not in the header, which holds five kinds of thing and no more. A pick applies at once and is kept in a
 * cookie (lib/theme.ts) so every later page is painted right from the server.
 */
export default function ThemeSetting({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);
  const pick = (next: Theme) => {
    setTheme(next);
    applyTheme(next);
  };
  return (
    <section className="card" aria-labelledby="appearance-head">
      <h2 id="appearance-head">Appearance</h2>
      <p className="muted small">Light or dark for the show. After Dark is always night.</p>
      <fieldset className="theme-picker">
        <legend className="sr-only">Theme</legend>
        {THEMES.map((t) => (
          <label key={t} className="theme-option">
            <input type="radio" name="theme" value={t} checked={theme === t} onChange={() => pick(t)} />
            <span>
              {THEME_LABELS[t]}
              {t === "system" && <span className="muted small"> (follows your device)</span>}
            </span>
          </label>
        ))}
      </fieldset>
    </section>
  );
}
