import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { escapeRegExp } from "@/lib/text";

// One copy of each small text helper (lib/text.ts): the 2026-11-22 audit found the same regex escape written 30 times.
describe("escapeRegExp", () => {
  it("makes a pattern match the text literally, whatever characters it holds", () => {
    for (const s of ["a.b", "C++", "(hi)", "[x]", "$5.00?", "a|b", "^start", "end$", "back\\slash", "{1,2}", "*", "Zoë O'Hara-Smith"]) {
      expect(new RegExp(`^${escapeRegExp(s)}$`).test(s)).toBe(true);
    }
    expect(new RegExp(escapeRegExp("a.b")).test("axb")).toBe(false);
    expect(new RegExp(`\\b${escapeRegExp("Mr. Fox")}\\b`, "i").test("then mr. fox left")).toBe(true);
  });

  it("is the only copy in the site's code", () => {
    const copy = `.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&")`;
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
      });
    const copies = [...files("app"), ...files("lib")].filter((f) => readFileSync(f, "utf8").includes(copy));
    expect(copies).toEqual([join("lib", "text.ts")]);
  });
});
