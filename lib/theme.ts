/**
 * The site's theme (docs/brand.md, Themes). The system's by default: the stylesheet follows prefers-color-scheme.
 * A viewer who picks Light or Dark on /account gets that everywhere, in every browser they're signed in on this
 * device: the pick is a cookie, read by the root layout into `<html data-theme>`, so the first paint is already right.
 * After Dark is night in every theme (app/globals.css .after-dark-mode) and ignores this.
 */
export const THEME_COOKIE = "bz_theme";
export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_LABELS: Record<Theme, string> = { light: "Light", dark: "Dark", system: "System" };
/** A year: the pick stays until it's changed. */
export const THEME_MAX_AGE = 60 * 60 * 24 * 365;

/** The pick a cookie holds. Anything else (no cookie, "system", junk) is the system's theme. */
export function themeFromCookie(value: string | null | undefined): Theme {
  return value === "light" || value === "dark" ? value : "system";
}

/**
 * What `<html data-theme>` carries: a picked theme only. "system" writes nothing, so the stylesheet's own
 * prefers-color-scheme rules decide, exactly as they did before anyone could pick.
 */
export function themeAttribute(theme: Theme): "light" | "dark" | undefined {
  return theme === "system" ? undefined : theme;
}

/** In the browser: store the pick and repaint at once, without a reload. */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const attr = themeAttribute(theme);
  if (attr) document.documentElement.dataset.theme = attr;
  else delete document.documentElement.dataset.theme;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    theme === "system"
      ? `${THEME_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax${secure}`
      : `${THEME_COOKIE}=${theme}; Max-Age=${THEME_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
}
