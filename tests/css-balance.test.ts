import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A stylesheet with a block left open nests every rule after it inside that block, and the browser applies them
// nowhere (CSS nesting makes it valid, so nothing errors). Merges dropped a closing brace in app/ux/after-dark.css twice
// on 2026-10-25, and half the After Dark styles stopped applying. Every stylesheet's braces must balance.
const ROOT = join(__dirname, "..");
const sheets = [join(ROOT, "app", "globals.css"), ...readdirSync(join(ROOT, "app", "ux")).filter((f) => f.endsWith(".css")).map((f) => join(ROOT, "app", "ux", f))];

/** The line of the first block still open at the end, or null when every one is closed (comments and strings skipped). */
function firstUnclosed(css: string): number | null {
  const open: number[] = [];
  let line = 1;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "\n") line++;
    else if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      for (const c of css.slice(i, end < 0 ? css.length : end)) if (c === "\n") line++;
      i = end < 0 ? css.length : end + 1;
    } else if (ch === '"' || ch === "'") {
      const end = css.indexOf(ch, i + 1);
      i = end < 0 ? css.length : end;
    } else if (ch === "{") open.push(line);
    else if (ch === "}") {
      if (!open.length) return line;
      open.pop();
    }
  }
  return open.length ? open[0] : null;
}

describe("stylesheets", () => {
  it.each(sheets.map((f) => [f.slice(ROOT.length + 1), f]))("%s closes every block it opens", (_name, file) => {
    expect(firstUnclosed(readFileSync(file, "utf8"))).toBeNull();
  });
});
