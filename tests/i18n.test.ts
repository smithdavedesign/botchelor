/**
 * The site's translations (docs/i18n.md). Every string the code translates (`t("…")`, `tr("…")` or `msg("…")` in a
 * file that uses lib/i18n) is in every language's catalog, in the right half: a client component's strings in `client`
 * (the half the browser gets). No catalog keeps a string nothing uses, and every translation keeps its `{placeholders}`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOGS } from "@/lib/i18n/catalogs";
import { localeFromAcceptLanguage, pickLocale } from "@/lib/i18n/locales";
import { translator } from "@/lib/i18n/translate";

const ROOT = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !p.includes(`${join("lib", "i18n")}`)) out.push(p);
  }
  return out;
}

/** Strings marked for translation, by file, and whether the file is a client component. */
function usedStrings(): { file: string; client: boolean; keys: string[] }[] {
  const files = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "lib"))];
  const found: { file: string; client: boolean; keys: string[] }[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    if (!/from "(@\/lib\/i18n\/[\w-]+|\.\/i18n\/[\w-]+|@\/app\/I18nProvider)"/.test(src)) continue;
    const keys = [...src.matchAll(/\b(?:t|tr|msg)\(\s*("(?:[^"\\]|\\.)*")/g)].map((m) => JSON.parse(m[1]) as string);
    const client = /^\s*["']use client["']/.test(src);
    found.push({ file: relative(ROOT, f), client, keys });
  }
  return found;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("the catalogs", () => {
  const used = usedStrings();
  const clientKeys = new Set(used.filter((u) => u.client).flatMap((u) => u.keys));
  const allKeys = new Set(used.flatMap((u) => u.keys));

  it("finds the site's translated strings", () => {
    expect(allKeys.size).toBeGreaterThan(40);
    expect(clientKeys.has("Make your character")).toBe(true);
  });

  for (const [lang, catalog] of Object.entries(CATALOGS)) {
    describe(lang, () => {
      it("has every string the browser shows in its client half", () => {
        expect([...clientKeys].filter((k) => !(k in catalog.client))).toEqual([]);
      });
      it("has every other string in one half or the other", () => {
        expect([...allKeys].filter((k) => !(k in catalog.client) && !(k in catalog.server))).toEqual([]);
      });
      it("keeps no string twice, nor one in the browser's half that only the server shows", () => {
        expect(Object.keys(catalog.client).filter((k) => k in catalog.server)).toEqual([]);
        expect(Object.keys(catalog.client).filter((k) => !clientKeys.has(k))).toEqual([]);
      });
      it("keeps no string the code doesn't use", () => {
        expect([...Object.keys(catalog.client), ...Object.keys(catalog.server)].filter((k) => !allKeys.has(k))).toEqual([]);
      });
      it("keeps every placeholder and translates every string", () => {
        for (const [k, v] of [...Object.entries(catalog.client), ...Object.entries(catalog.server)]) {
          expect(placeholders(v), `${lang}: ${k}`).toEqual(placeholders(k));
          expect(v.trim(), `${lang}: ${k}`).not.toBe("");
        }
      });
    });
  }
});

describe("picking the language", () => {
  it("follows the browser's weights, ignoring regions", () => {
    expect(localeFromAcceptLanguage("pt-BR,pt;q=0.9,en;q=0.8")).toBe("pt");
    expect(localeFromAcceptLanguage("es-MX")).toBe("es");
    expect(localeFromAcceptLanguage("nl;q=0.9,de;q=0.5,en;q=0.7")).toBe("en");
    expect(localeFromAcceptLanguage("in-ID")).toBe("id");
    expect(localeFromAcceptLanguage("zh-CN,zh;q=0.9")).toBeNull();
    expect(localeFromAcceptLanguage("ja;q=0,en")).toBe("en");
    expect(localeFromAcceptLanguage(null)).toBeNull();
  });
  it("puts the nav's pick first, then the browser, then English", () => {
    expect(pickLocale("ko", "fr")).toBe("ko");
    expect(pickLocale("en", "fr")).toBe("en");
    expect(pickLocale("xx", "fr")).toBe("fr");
    expect(pickLocale(undefined, undefined)).toBe("en");
  });
  it("falls back to the English and fills placeholders", () => {
    const t = translator({ "{n} unread": "{n} sin leer" });
    expect(t("{n} unread", { n: 3 })).toBe("3 sin leer");
    expect(t("Not translated yet")).toBe("Not translated yet");
  });
});
