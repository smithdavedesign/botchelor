/**
 * The design-token ratchet (2026-11-08 UI audit, item 9): globals.css had grown to ~14,000 lines with 152 raw hex
 * colours, 121 font sizes off the type scale and about fifteen different corners. Every literal that's there today is
 * written down in tests/css-tokens-baseline.json; a new one fails here, by value, file and line. Use a token instead
 * (docs/brand.md: colour, the type scale, the radius scale), or add one. Removing literals is the point: when there are
 * fewer than the baseline says, lower it so they can't creep back:
 *
 *   UPDATE_CSS_BASELINE=1 npx vitest run tests/css-tokens.test.ts
 *
 * Only run that after removing literals, never to let a new one in (the diff of the JSON shows which way it went).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanCss, tally, type Baseline, type Kind } from "./css-token-scan";

const ROOT = join(__dirname, "..");
const BASELINE_PATH = join(ROOT, "tests", "css-tokens-baseline.json");

describe("CSS design tokens", () => {
  const { baseline: now, hits } = tally(ROOT);
  if (process.env.UPDATE_CSS_BASELINE === "1") writeFileSync(BASELINE_PATH, `${JSON.stringify(now, null, 2)}\n`);
  const recorded = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;

  it("adds no literal colour, font size or corner that the baseline doesn't have", () => {
    const added: string[] = [];
    for (const [file, kinds] of Object.entries(now)) {
      for (const [kind, values] of Object.entries(kinds) as [Kind, Record<string, number>][]) {
        for (const [value, n] of Object.entries(values)) {
          const had = recorded[file]?.[kind]?.[value] ?? 0;
          if (n > had) {
            const lines = hits[file].filter((h) => h.kind === kind && h.value === value).map((h) => h.line);
            added.push(`${file}: ${kind} ${value} ×${n - had} (lines ${lines.join(", ")}) — use a token (docs/brand.md)`);
          }
        }
      }
    }
    expect(added, `New literals:\n${added.join("\n")}`).toEqual([]);
  });

  it("keeps the baseline as low as the stylesheets are (lower it when literals go)", () => {
    const gone: string[] = [];
    for (const [file, kinds] of Object.entries(recorded)) {
      for (const [kind, values] of Object.entries(kinds) as [Kind, Record<string, number>][]) {
        for (const [value, n] of Object.entries(values)) {
          const has = now[file]?.[kind]?.[value] ?? 0;
          if (has < n) gone.push(`${file}: ${kind} ${value} ${n} → ${has}`);
        }
      }
    }
    expect(gone, `Fewer literals than the baseline (good): run UPDATE_CSS_BASELINE=1 npx vitest run tests/css-tokens.test.ts\n${gone.join("\n")}`).toEqual([]);
  });

  it("holds the 2026-11-08 audit's own stylesheet and the radius scale to tokens only", () => {
    expect(now["app/ux/catalog.css"]).toBeUndefined();
    // Corners: the scale (--radius-xs … --radius-pill) replaced 178 single-value literals; what's left is shaped on
    // purpose (a speech bubble's tail, a sheet's top corners) or a pill sized to its own height.
    const singleRadii = Object.values(now).flatMap((k) => Object.keys(k.radius ?? {})).filter((v) => !/\s/.test(v));
    expect(singleRadii.every((v) => /^(1px|2px|1\.25rem|1\.6rem|2\.1rem|2\.45rem|2\.5rem|3rem)$/.test(v)), singleRadii.join(", ")).toBe(true);
  });

  it("reads declarations, not selectors or token definitions", () => {
    const css = `
      /* a comment with #abc and font-size: 3px; */
      :root { --ink: #241022; --text-xs: clamp(0.8rem, 1vw, 0.9rem); }
      a:hover { color: #FFF; }
      @media (max-width: 720px) { .x { font-size: 0.85rem; border-radius: 12px; } }
      .y { font-size: var(--text-sm); border-radius: 50%; border-top-left-radius: 0; font-size: 1em; }
      .z { border-radius: 16px 16px 4px 16px !important; }`;
    expect(scanCss(css)).toEqual([
      { kind: "hex", value: "#fff", line: 4 },
      { kind: "font-size", value: "0.85rem", line: 5 },
      { kind: "radius", value: "12px", line: 5 },
      { kind: "radius", value: "16px 16px 4px 16px", line: 7 },
    ]);
  });
});
