/**
 * No page gains English that isn't translated (docs/i18n.md "Translating as part of the work"; David, 2026-11-27: "make
 * sure we translate if a page is updated or new"). Every page and component a visitor sees is held to its count in
 * tests/i18n-baseline.json: a new file has none, a file's count never goes up, and when a change translates some of
 * it the baseline is lowered with it, so it can't creep back. What stays English by design is listed in
 * scripts/i18n-untranslated.ts ENGLISH_ONLY.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BASELINE, counts, untranslated } from "../scripts/i18n-untranslated";

const ROOT = join(__dirname, "..");
const FIX = "Wrap each in t() (docs/i18n.md) and add it to the catalogs with `npx tsx scripts/i18n-missing.ts`.";

describe("untranslated text on the site's pages", () => {
  const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, number>;
  const now = counts();

  it("adds none: a new page has none, and a page's count never goes up", () => {
    const worse = Object.entries(now)
      .filter(([f, n]) => n > (baseline[f] ?? 0))
      .map(([f, n]) => {
        const lines = untranslated(join(ROOT, f)).map((u) => `  ${f}:${u.line}  ${u.text}`);
        return `${f}: ${n} untranslated, ${baseline[f] ?? 0} allowed\n${lines.join("\n")}`;
      });
    expect(worse, `${FIX}\n\n${worse.join("\n\n")}`).toEqual([]);
  });

  it("keeps the baseline down to what's left: lower it when a change translates something", () => {
    const better = Object.entries(baseline)
      .filter(([f, n]) => (now[f] ?? 0) < n)
      .map(([f, n]) => `${f}: ${now[f] ?? 0} now, baseline ${n}`);
    expect(better, `Run \`npx tsx scripts/i18n-untranslated.ts --baseline\` and commit tests/i18n-baseline.json.\n${better.join("\n")}`).toEqual([]);
  });

  it("holds the pages already translated to none", () => {
    for (const f of ["app/page.tsx", "app/CharacterPhone.tsx", "app/ShowSince.tsx", "app/TonightBand.tsx", "app/YourCalls.tsx"]) {
      expect(baseline[f] ?? 0, f).toBe(0);
    }
  });

  it("sees the kinds of text a visitor reads", () => {
    const src = `export default () => (<div title="A tip"><p>Hello there</p>{ok ? "Yes it is" : t("No")}<img alt={\`Photo of \${name}\`} />{t("Fine")}<span>{" · "}</span></div>);`;
    expect(untranslated("x.tsx", src).map((u) => u.text)).toEqual(["A tip", "Hello there", "Yes it is", "Photo of …"]);
  });
});
