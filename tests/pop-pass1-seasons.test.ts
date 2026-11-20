// The visual pop audit's first pass, part C (docs/audits/2026-11-20-visual-pop-audit.md): /seasons and a lead season's
// page open on the elimination set, the lead large, and the next premiere's clock (app/seasons/PremiereCountdown.tsx),
// which the server draws with its time in words and "--" for the numbers, so the HTML never disagrees with the
// browser's clock; it ticks once the page is live, and turns into an ON AIR light while the premiere plays.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PremiereCountdown, { leftUntil, premiereState } from "@/app/seasons/PremiereCountdown";
import { premiereLabel } from "@/app/seasons/season-visuals";
import { premiereAt, premiereTimeWords } from "@/lib/premiere-clock";
import { premiereEndsAt } from "@/lib/sunday-premiere";

const source = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const lead = { id: "house-juniper", name: "Juniper Vale", hue: null, portrait: null, house: true };
const AT = premiereAt("2026-11-29", {}).toISOString();

describe("the premiere's clock", () => {
  it("counts days, hours, minutes and seconds, never below zero", () => {
    const at = Date.parse(AT);
    expect(leftUntil(at, at - ((2 * 24 + 3) * 3600 + 4 * 60 + 5) * 1000)).toEqual({ d: 2, h: 3, m: 4, s: 5 });
    expect(leftUntil(at, at + 60_000)).toEqual({ d: 0, h: 0, m: 0, s: 0 });
  });

  it("is on the air from the start to the room's end, then aired", () => {
    const at = Date.parse(AT);
    const until = Date.parse(premiereEndsAt(AT));
    expect(until - at).toBe(285_000);
    expect(premiereState(at, until, at - 1)).toBe("soon");
    expect(premiereState(at, until, at)).toBe("live");
    expect(premiereState(at, until, until - 1)).toBe("live");
    expect(premiereState(at, until, until)).toBe("aired");
  });

  it("the December pilot is Sunday 29 November at 23:00 UTC, from the premiere's own clock", () => {
    expect(AT).toBe("2026-11-29T23:00:00.000Z");
    expect(premiereTimeWords(AT, { day: true })).toMatch(/^Sunday 29 November, 23:00 UTC \(6 pm ET, 3 pm PT\)$/);
  });

  it("names the premiere, with who the lead dates once it's built", () => {
    expect(premiereLabel({ kind: "pilot", finale: false, lead, suitor: null })).toBe("The pilot, Meet the lead");
    expect(premiereLabel({ kind: "weekly", finale: false, lead, suitor: { ...lead, id: "x", name: "Dex Okafor" } })).toBe("Sunday's premiere: Juniper and Dex");
    expect(premiereLabel({ kind: "weekly", finale: true, lead, suitor: null })).toBe("The finale's premiere");
  });

  it("is drawn on the server with its time in words and blank numbers: nothing that depends on the clock", () => {
    const words = premiereTimeWords(AT, { day: true });
    const html = renderToStaticMarkup(createElement(PremiereCountdown, { at: AT, until: premiereEndsAt(AT), live: false, label: "The pilot, Meet the lead", words, href: null }));
    expect(html).toContain('class="premiere-countdown is-soon"');
    expect(html).toContain("Next</span> <strong class=\"premiere-label\">The pilot, Meet the lead</strong>");
    expect(html).toContain(`role="timer" aria-label="Starts ${words}"`);
    expect(html.match(/<b>--<\/b>/g)).toHaveLength(4);
    expect(html).toContain(`<p class="premiere-words">${words}</p>`);
    // No room yet: no seat to take.
    expect(html).not.toContain("premiere-go");
  });

  it("is an ON AIR light with the room's link while it plays", () => {
    const html = renderToStaticMarkup(createElement(PremiereCountdown, { at: AT, until: premiereEndsAt(AT), live: true, label: "Sunday's premiere", words: "x", href: "/watch/p-1" }));
    expect(html).toContain('class="premiere-countdown is-live"');
    expect(html).toContain("On air</span>");
    expect(html).not.toContain('role="timer"');
    expect(html).toContain('<a class="button" data-track="season-premiere-go" href="/watch/p-1">Watch now</a>');
  });

  it("only lights up (pulses) with motion allowed", () => {
    const css = source("app/ux/seasons.css");
    const calm = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(calm).toMatch(/\.premiere-countdown\.is-live \.premiere-light-dot \{\s*animation: none;/);
  });
});

describe("the season pages' heroes", () => {
  it("open on the elimination set with the lead large and the clock; the finale's frozen recap is left alone", () => {
    for (const file of ["app/seasons/page.tsx", "app/seasons/[slug]/SeasonLive.tsx"]) {
      const src = source(file);
      expect(src, file).toMatch(/<SetHero\s+set="elimination"/);
      expect(src, file).toContain("<SeasonLeadFace");
      expect(src, file).toContain("<PremiereCountdown");
    }
    expect(source("app/seasons/[slug]/page.tsx")).not.toMatch(/SetHero|PremiereCountdown/);
  });
});
