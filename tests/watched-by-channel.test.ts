// Measurement first (the 2026-11-11 growth plan): "Watched it end" counts readers, shares tag themselves, and a date
// agreed through a shared link is a date started.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ShareButton from "@/app/ShareButton";
import { BEACON_REFS, beaconRef } from "@/app/funnel";

const src = (p: string) => readFileSync(p, "utf8");

describe("watched it end, for readers too", () => {
  it("the episode page marks the recap's ending block once it's on screen; the theater says it was the theater", () => {
    const page = src("app/episodes/[id]/page.tsx");
    const beat = page.slice(page.indexOf('className="ending-beat"'), page.indexOf('className="ending-beat"') + 400);
    expect(beat).toContain("<EndingSeen />");
    expect(beat).toContain("episode.revealed &&"); // never before the finale airs
    const seen = src("app/episodes/[id]/EndingSeen.tsx");
    expect(seen).toContain("IntersectionObserver");
    expect(seen).toContain('queueEvent("date_watched", { via: "page" })');
    expect(seen).toContain("threshold: 0.5");
    expect(src("app/episodes/[id]/EpisodeTheater.tsx")).toContain('queueEvent("date_watched", { via: "theater"');
  });
});

describe("shares that say where their visitors came from", () => {
  it("knows the four share tags, through the 18+ gate too, and nothing else", () => {
    expect([...BEACON_REFS]).toEqual(["share", "invite", "double", "owner"]);
    expect(beaconRef("/date/abc", "?ref=invite")).toBe("invite");
    expect(beaconRef("/gate", "?from=%2Fdouble%2Fabc%3Fref%3Ddouble")).toBe("double");
    expect(beaconRef("/episodes/x", "?ref=owner")).toBe("owner");
    expect(beaconRef("/episodes/x", "?ref=typed")).toBeNull();
  });

  it("the share button and each of its targets carry the engagement name", () => {
    const html = renderToStaticMarkup(
      createElement(ShareButton, { path: "/episodes/x?ref=share", title: "t", track: "share-episode", targets: [{ label: "Bluesky", href: "https://bsky.app/intent/compose" }] }),
    );
    expect(html.match(/data-track="share-episode"/g)).toHaveLength(3); // the button, Copy link, Bluesky
    expect(html).toContain('data-track-target="copy"');
    expect(html).toContain('data-track-target="bluesky"');
    expect(renderToStaticMarkup(createElement(ShareButton, { path: "/x", title: "t" }))).not.toContain("data-track");
    expect(src("app/episodes/[id]/EpisodeShare.tsx")).toContain('track="share-episode"');
    expect(src("app/ShareDateLink.tsx")).toContain('data-track="share-date-link"');
  });

  it("date links and double links are handed out tagged, and taking one is a date started", () => {
    expect(src("app/api/date-links/route.ts")).toContain("?ref=invite");
    expect(src("app/api/double-links/route.ts")).toContain("?ref=double");
    expect(src("app/date/[code]/AcceptDateLink.tsx")).toContain('trackConversion("date_started", { mode: "date_link" })');
    expect(src("app/double/[code]/TakeDoubleLink.tsx")).toContain('trackConversion("date_started", { mode: "double_link" })');
  });
});
