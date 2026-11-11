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
describe("the creator's quick track", () => {
  it("a new character walks four steps: who they are, their look, the dating profile, the review", async () => {
    const { default: CreateWizard } = await import("@/app/create/CreateWizard");
    const html = renderToStaticMarkup(createElement(CreateWizard, {}));
    const labels = [...html.matchAll(/aria-label="Step (\d+): ([^"(]+)/g)].map((m) => `${m[1]} ${m[2].trim()}`);
    expect(labels).toEqual(["1 Identity", "2 Look", "3 Dating profile", "4 Review"]);
    expect(html).toContain("Step 1 of 4 · Identity");
    expect(html).toContain("in four steps. Their voice and inner life can wait until after their first date.");
    expect(html).not.toContain("optional</span>");
  });

  it("the review offers depth once, and depth or an edit opens every step", () => {
    const src = readFileSync("app/create/CreateWizard.tsx", "utf8");
    expect(src).toContain("const QUICK_TRACK: readonly number[] = [S.identity, S.look, S.details, S.review];");
    expect(src).toMatch(/\{!edit && !depth && \(\s*<div className="notice wizard-depth">/);
    expect(src).toContain("const track = depth ? ALL_STEPS : QUICK_TRACK;");
    expect(src).toContain("const [depth, setDepth] = useState(Boolean(edit));");
  });
});
