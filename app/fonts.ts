import { Fraunces, Inter } from "next/font/google";

/**
 * The site's two faces, self-hosted by next/font (2026-11-27): they used to come from a render-blocking Google Fonts
 * @import at the top of globals.css, so the first paint waited on a second host and the headings jumped when Fraunces
 * landed. Now they're served from our own origin with size-adjusted fallbacks, and stylesheets reach them as
 * var(--font-display) and var(--font-body) (defaults on :where(:root) in globals.css).
 *
 * Fraunces comes with its whole design space: optical size, the SOFT axis (rounder terminals) and WONK (its leaning,
 * show-title letterforms), and a real italic for the show's quoted titles, which were a slanted roman before.
 */
export const display = Fraunces({
  subsets: ["latin", "latin-ext"],
  style: ["normal", "italic"],
  axes: ["SOFT", "WONK", "opsz"],
  display: "swap",
  variable: "--font-display",
  fallback: ["Georgia", "serif"],
});

export const body = Inter({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-body",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});

/** The class that puts both variables on <html>. */
export const fontVariables = `${display.variable} ${body.variable}`;
