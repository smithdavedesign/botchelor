import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  useSearchParams: () => new URLSearchParams(),
}));

// The creator in four steps (the look kept on it, David 2026-11-11) (the 2026-11-11 audit, 2.2: the hero promised "under a minute", the rail promised eight).
// A FIRST character takes three (2026-11-14 first-session plan, PR1): the dating profile moved to the depth track and is
// written from the sheet at Create (lib/profile-fill.ts), so nothing stands between a newcomer and their first date.
const labelsOf = (html: string) => [...html.matchAll(/aria-label="Step (\d+): ([^"(]+)/g)].map((m) => `${m[1]} ${m[2].trim()}`);

describe("the creator's quick track", () => {
  it("a first character walks three steps: who they are, their look, the review", async () => {
    const { default: CreateWizard } = await import("@/app/create/CreateWizard");
    const html = renderToStaticMarkup(createElement(CreateWizard, {}));
    expect(labelsOf(html)).toEqual(["1 Identity", "2 Look", "3 Review"]);
    expect(html).toContain("Step 1 of 3 · Identity");
    expect(html).toContain("in three steps. Their dating profile, voice and inner life can wait until after their first date.");
    expect(html).not.toContain("optional</span>");
    expect(html).toContain('Next<span class="wizard-next-label">: Look</span>');
    expect(html).not.toContain("Next: Voice");
  });

  it("a creator's next character walks four steps, the dating profile back on the track", async () => {
    const { default: CreateWizard } = await import("@/app/create/CreateWizard");
    const html = renderToStaticMarkup(createElement(CreateWizard, { myCharacters: [{ id: "c-1", name: "Mira Quell" }] }));
    expect(labelsOf(html)).toEqual(["1 Identity", "2 Look", "3 Dating profile", "4 Review"]);
    expect(html).toContain("Step 1 of 4 · Identity");
    expect(html).toContain("in four steps. Their voice and inner life can wait until after their first date.");
    // Next names the step it goes to: Look, not Voice (it said "Next: Voice" and went to Look, 2026-11-12).
    expect(html).toContain('Next<span class="wizard-next-label">: Look</span>');
    expect(html).not.toContain("Next: Voice");
  });

  it("the review offers depth once, and depth or an edit opens every step", () => {
    const src = readFileSync("app/create/CreateWizard.tsx", "utf8");
    expect(src).toContain("firstCharacter ? FIRST_DATE_STEPS.map((name) => S[name]) : [S.identity, S.look, S.details, S.review]");
    expect(src).toMatch(/\{!edit && !depth && \(\s*<div className="notice wizard-depth">/);
    expect(src).toContain("const track = depth ? ALL_STEPS : quickTrack(firstCharacter);");
    expect(src).toContain("const [depth, setDepth] = useState(Boolean(edit));");
    // A first character's empty profile is written from the sheet at Create; the profile never greys out Create for them.
    expect(src).toContain("const profileOk = edit || firstCharacter ? true : profileComplete(normaliseExtras(extras));");
    expect(src).toMatch(/const sent = firstCharacter\s*\? fillProfile\(normaliseExtras\(extras\)/);
  });
});
