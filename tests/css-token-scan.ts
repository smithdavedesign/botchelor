/**
 * Finds the design values written as literals instead of tokens in a stylesheet (2026-11-08 UI audit, item 9): a raw hex
 * colour, a font size off the type scale, a corner off the radius scale. Token definitions themselves (`--name: …`)
 * are where literals belong, so they're skipped, as are values that are structure rather than design (no corner, a
 * circle, a pill; a size of 1em or inherit). Used by tests/css-tokens.test.ts.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export type Kind = "hex" | "font-size" | "radius";
export type Hit = { kind: Kind; value: string; line: number };

const STRUCTURAL_RADIUS = /^(0|50%|999px|inherit|initial|unset)$/;
const STRUCTURAL_FONT_SIZE = /^(inherit|initial|unset|1em|100%|0|smaller|larger)$/;

/** Every literal in one stylesheet's declarations, with its line. */
export function scanCss(css: string): Hit[] {
  // Comments become spaces (newlines kept), so they can't hold a declaration and line numbers stay right.
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  const hits: Hit[] = [];
  const lineAt = (i: number) => text.slice(0, i).split("\n").length;
  for (const m of text.matchAll(/([a-zA-Z-]+)\s*:\s*([^;{}]+);/g)) {
    const [, prop, rawValue] = m;
    if (prop.startsWith("--")) continue;
    const value = rawValue.trim().replace(/\s*!important$/, "");
    const at = m.index ?? 0;
    for (const h of value.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) hits.push({ kind: "hex", value: h[0].toLowerCase(), line: lineAt(at) });
    if (prop === "font-size" && !value.includes("var(") && !STRUCTURAL_FONT_SIZE.test(value)) hits.push({ kind: "font-size", value, line: lineAt(at) });
    if (/^border(-[a-z]+)*-radius$/.test(prop) && !value.includes("var(") && !STRUCTURAL_RADIUS.test(value)) hits.push({ kind: "radius", value, line: lineAt(at) });
  }
  return hits;
}

/** The app's stylesheets, as paths relative to the repo root. */
export function stylesheets(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith(".css")) out.push(relative(root, p));
    }
  };
  walk(join(root, "app"));
  return out.sort();
}

/** Per file and kind, how many times each literal value appears: the shape of tests/css-tokens-baseline.json. */
export type Baseline = Record<string, Partial<Record<Kind, Record<string, number>>>>;

export function tally(root: string): { baseline: Baseline; hits: Record<string, Hit[]> } {
  const baseline: Baseline = {};
  const hits: Record<string, Hit[]> = {};
  for (const file of stylesheets(root)) {
    const found = scanCss(readFileSync(join(root, file), "utf8"));
    if (!found.length) continue;
    hits[file] = found;
    const byKind: Partial<Record<Kind, Record<string, number>>> = {};
    for (const h of found) {
      const values = (byKind[h.kind] ??= {});
      values[h.value] = (values[h.value] ?? 0) + 1;
    }
    for (const kind of Object.keys(byKind) as Kind[]) byKind[kind] = Object.fromEntries(Object.entries(byKind[kind]!).sort(([a], [b]) => a.localeCompare(b)));
    baseline[file] = byKind;
  }
  return { baseline, hits };
}
