// UX round 2026-11-07 (David: "do all of the suggestions"): the shared empty state, the phone action bar, and vote
// shares a screen reader can read.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import EmptyState from "@/app/EmptyState";
import PhoneActionBar from "@/app/PhoneActionBar";
import SeasonFormatVote from "@/app/SeasonFormatVote";
import type { SeasonBallot } from "@/lib/season-vote";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }), usePathname: () => "/" }));

describe("an empty list says what to do next (app/EmptyState.tsx)", () => {
  it("has a title, one action and one other way on", () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, { emoji: "💌", title: "No matches yet", action: { href: "/swipe", label: "Swipe" }, secondary: { href: "/companion", label: "Talk to a companion" } }, "Why it's empty."),
    );
    expect(html).toContain("No matches yet");
    expect(html).toMatch(/<a class="button small" href="\/swipe">Swipe<\/a>/);
    expect(html).toMatch(/<a class="button-ghost small" href="\/companion">Talk to a companion<\/a>/);
    expect(html).toContain('aria-hidden="true">💌');
  });
});

describe("the phone action bar (app/PhoneActionBar.tsx)", () => {
  it("starts hidden and out of the tab order until the page's own button scrolls away", () => {
    const html = renderToStaticMarkup(createElement(PhoneActionBar, { watch: "hero-cta", children: createElement("a", { href: "/create" }, "Make your character") }));
    expect(html).toContain('class="phone-action-bar"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("inert");
  });
});

describe("vote shares a screen reader can read", () => {
  it("says the share as text, not as a label on a bare span", () => {
    const ballot: SeasonBallot = {
      season_id: "2026-12-01",
      season_label: "December 2026",
      closes_at: "2026-12-01T00:00:00.000Z",
      current: "classic",
      choices: [
        { slug: "classic", title: "Classic Botchelor", pitch: "p", emoji: "🌹", votes: 1 },
        { slug: "island", title: "The Villa", pitch: "p", emoji: "🏝️", votes: 3 },
      ],
      total: 4,
      my_pick: "island",
      leading: "island",
      min_votes: 3,
    };
    const html = renderToStaticMarkup(createElement(SeasonFormatVote, { ballot, now: Date.parse("2026-11-20T00:00:00Z") }));
    expect(html).toContain('75%<span class="sr-only"> of votes</span>');
    expect(html).not.toMatch(/class="situation-bar" aria-label/);
    expect(html).toContain("The Villa is ahead");
  });
});
