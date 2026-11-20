/**
 * Sheet and page action bars stay in reach on a phone (2026-11-20 mobile audit, B7, B9, B4): DateConfirm's Send pinned to
 * the sheet's foot with any refusal above it, the PG Studio's Shoot stuck to the screen's foot, and the create review bar
 * one row with the reason Create is greyed out inside it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

describe("pinned action bars", () => {
  it("DateConfirm: the error renders before the pinned actions", () => {
    const src = read("app/DateConfirm.tsx");
    const error = src.indexOf('className="sheet-error"');
    const actions = src.indexOf('className="sheet-actions sheet-actions-pinned"');
    expect(error).toBeGreaterThan(0);
    expect(actions).toBeGreaterThan(error);
    expect(read("app/globals.css")).toMatch(/\.sheet-actions-pinned \{[^}]*position: sticky;[^}]*background: var\(--card\);/);
  });

  it("PG Studio: Shoot sticks to the foot of a phone's screen, above the tab bar", () => {
    const css = read("app/globals.css");
    expect(css).toMatch(/@media \(max-width: 720px\) \{\s*\.pg-go \{\s*position: sticky;/);
    expect(css).toMatch(/body:has\(\.tabbar-nav\) \.pg-go \{\s*bottom: calc\(var\(--tabbar-h\)/);
    // The long fine print is out of the bar.
    const studio = read("app/characters/[id]/studio/PgStudio.tsx");
    expect(studio.indexOf("pg-go-fine")).toBeLessThan(studio.indexOf('className="pg-go"'));
  });

  it("create review: the promise sits above the bar, and why Create is greyed out is inside it", () => {
    const src = read("app/create/CreateWizard.tsx");
    const bar = src.indexOf('<div className="wizard-actions">');
    const attest = src.lastIndexOf('<label className="check wizard-attest">', bar);
    expect(attest).toBeGreaterThan(0);
    const barEnd = src.indexOf("</div>", src.indexOf("Create ${sheet.name", bar));
    const why = src.indexOf('className="wizard-still wizard-why"');
    expect(why).toBeGreaterThan(bar);
    expect(why).toBeLessThan(barEnd);
  });
});
