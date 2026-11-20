/**
 * Toasts make room (2026-11-20 mobile audit, B8, C23): the install hint and the beta prompt wait while they would sit over
 * a page's main button, one of them a visit; the After Dark privacy toast's ✕ is 44px and it shows once per browser.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { overlaps, PRIMARY_SELECTOR } from "@/app/useToastRoom";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

describe("toasts make room", () => {
  it("overlaps: boxes that touch within the pad overlap, apart ones don't", () => {
    const toast = { top: 700, bottom: 780, left: 16, right: 374 };
    expect(overlaps(toast, { top: 740, bottom: 784, left: 100, right: 300 })).toBe(true);
    expect(overlaps(toast, { top: 650, bottom: 695, left: 100, right: 300 })).toBe(true); // 5px apart: touching
    expect(overlaps(toast, { top: 600, bottom: 644, left: 100, right: 300 })).toBe(false);
    expect(overlaps(toast, { top: 720, bottom: 760, left: 390, right: 430 })).toBe(false);
  });

  it("main buttons are the filled ones, never ghost, secondary or text buttons", () => {
    expect(PRIMARY_SELECTOR).toContain("button.primary");
    expect(PRIMARY_SELECTOR).toContain("a.button:not(.secondary):not(.button-ghost)");
  });

  it("the install hint and the beta prompt wait for room, take one visit each, and hide while they wait", () => {
    for (const [p, kind] of [["app/InstallHint.tsx", "install"], ["app/FeedbackDock.tsx", "beta"]] as const) {
      const src = read(p);
      expect(src, p).toContain("useToastRoom(");
      expect(src, p).toContain(`toastVisitFree("${kind}")`);
      expect(src, p).toContain(`claimToastVisit("${kind}")`);
      expect(src, p).toContain("hidden={waiting}");
    }
    expect(read("app/globals.css")).toMatch(/\.beta-toast\[hidden\],\s*\.install-hint\[hidden\] \{\s*display: none;/);
  });

  it("the After Dark privacy toast: a 44px ✕, remembered per browser", () => {
    expect(read("app/ux/after-dark.css")).toMatch(/\.ad-blur-hint-close \{[^}]*min-width: 44px;\s*min-height: 44px;/);
    expect(read("app/after-dark/[a]/[b]/AfterDarkTheater.tsx")).toMatch(/localStorage\.setItem\(BLUR_HINT_KEY/);
  });
});
