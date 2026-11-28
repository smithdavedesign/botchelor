/**
 * The strings the code translates (docs/i18n.md): `t("…")`, `tr("…")` or `msg("…")` in a file that uses lib/i18n, and
 * `clientMsg("…")`, by file and whether a client component shows them. Shared by tests/i18n.test.ts (every catalog has
 * them all) and scripts/i18n-missing.ts (which lists and fills what a catalog lacks).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const ROOT = join(__dirname, "..");

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
export function usedStrings(): { file: string; client: boolean; keys: string[] }[] {
  const files = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "lib"))];
  const found: { file: string; client: boolean; keys: string[] }[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    if (!/from "(@\/lib\/i18n\/[\w-]+|\.\/i18n\/[\w-]+|\.\.\/i18n\/[\w-]+|@\/app\/I18nProvider|\.\/I18nProvider)"/.test(src)) continue;
    const keys = [...src.matchAll(/\b(?:t|tr|msg)\(\s*("(?:[^"\\]|\\.)*")/g)].map((m) => JSON.parse(m[1]) as string);
    const shown = [...src.matchAll(/\bclientMsg\(\s*("(?:[^"\\]|\\.)*")/g)].map((m) => JSON.parse(m[1]) as string);
    const client = /^\s*["']use client["']/.test(src);
    found.push({ file: relative(ROOT, f), client, keys });
    if (shown.length) found.push({ file: relative(ROOT, f), client: true, keys: shown });
  }
  return found;
}

/** Every key, and the ones the browser needs (a catalog's `client` half). */
export function keySets(): { all: Set<string>; client: Set<string> } {
  const used = usedStrings();
  return { all: new Set(used.flatMap((u) => u.keys)), client: new Set(used.filter((u) => u.client).flatMap((u) => u.keys)) };
}
