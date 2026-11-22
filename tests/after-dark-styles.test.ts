import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Two rules collided with rules in other stylesheets (found live on 2026-11-22). A hub list's `.ad-pairs { display: grid }`
// (app/ux/after-dark.css, from when the hub listed its pairs) also matched the admin tables of that name, so each
// table's header row and its body took their own column widths: the headings on the providers page (jobs, videos,
// subscriptions) and the graph page (pairs, models) sat over the wrong columns. And a night-only ink for the Showcase's
// chosen side chip, set for a lilac fill, stayed when the chip's fill became the show's button pink: 3.7:1.
const ROOT = join(__dirname, "..");
const sheets = readdirSync(join(ROOT, "app"), { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".css"))
  .map((f) => [f, readFileSync(join(ROOT, "app", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")] as const);

/** Every rule (inside @media too) with a selector whose own subject matches `subject`: its file, selector and declarations. */
function rulesFor(subject: RegExp): { file: string; selector: string; body: string }[] {
  const out: { file: string; selector: string; body: string }[] = [];
  for (const [file, css] of sheets) {
    for (const m of css.matchAll(/([^{};]*)\{([^{}]*)\}/g)) {
      for (const selector of m[1].split(",").map((s) => s.trim())) if (subject.test(selector)) out.push({ file, selector, body: m[2] });
    }
  }
  return out;
}
const where = (rules: { file: string; selector: string }[]) => rules.map((r) => `${r.file}: ${r.selector}`);

describe("After Dark's styles", () => {
  it("keeps the admin tables tables: no stylesheet gives .ad-pairs a display of its own", () => {
    const rules = rulesFor(/\.ad-pairs$/);
    // The tables' own rule (globals.css) is found, so the scan reads the sheets.
    expect(rules.length).toBeGreaterThan(0);
    expect(where(rules.filter((r) => /(^|[;\s])display\s*:/.test(r.body)))).toEqual([]);
  });

  it("sets the Showcase's chosen side chip's ink only together with its fill", () => {
    const rules = rulesFor(/showcase-side\.on$/);
    expect(rules.length).toBeGreaterThan(0);
    const inkAlone = rules.filter((r) => /(^|[;\s])color\s*:/.test(r.body) && !/(^|[;\s])background(-color)?\s*:/.test(r.body));
    expect(where(inkAlone)).toEqual([]);
  });
});
