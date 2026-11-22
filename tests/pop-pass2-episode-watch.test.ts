import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DiaryCam from "@/app/episodes/[id]/DiaryCam";

const ROOT = join(__dirname, "..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");
const css = src("app/globals.css");

describe("the episode page (pass 2 of the visual pop audit)", () => {
  it("pushes in on the venue like the theater's camera, on its own layer, still under reduced motion", () => {
    expect(src("app/episodes/[id]/page.tsx")).toContain('<span className="episode-hero-art" aria-hidden="true" style={{ backgroundImage: background }} />');
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*\.episode-hero-art \{\s*animation: set-push-in 30s/);
    expect(css).toMatch(/\.episode-hero \{\s*overflow: hidden;\s*isolation: isolate;/);
  });

  it("raises each line of the read-through as it scrolls in, only where view timelines exist", () => {
    // Forwards, not both (2026-11-22 audit): a line further down sits at full strength until it starts to come in.
    expect(css).toMatch(/@supports \(animation-timeline: view\(\)\) \{\s*@media \(prefers-reduced-motion: no-preference\) \{\s*\.episode-read \.chat-row \{\s*animation: rise-in linear forwards;/);
  });

  it("puts the diary cam on the confessional set with the camera rolling", () => {
    const html = renderToStaticMarkup(
      createElement(DiaryCam, {
        characters: [{ id: "house-nell", name: "Nell Abiodun", house: true, hue: 30, portrait: null }],
        diary: [{ character_id: "house-nell", line: "The clay won." }],
      } as never),
    );
    expect(html).toMatch(/<ul class="diary-cam-list on-set diary-cam-set" style="background-image:[^"]*set-confessional-v\d+\.webp/);
    expect(html).toContain("The clay won.");
    expect(css).toContain('content: "REC" / "";');
  });
});

describe("Watch (pass 2 of the visual pop audit)", () => {
  it("says nothing's live with a dimmed OFF AIR light", () => {
    const page = src("app/watch/page.tsx");
    expect(page).toContain('<span className="off-air" aria-hidden="true">');
    expect(page).not.toContain('<span className="watch-dot off" aria-hidden />');
  });

  it("shows where a room still to start is, from the lobby's own venue", () => {
    expect(src("app/watch/page.tsx")).toContain('{(room.status === "ready" || room.status === "upcoming") && room.venue && <VenuePhoto venue={room.venue} className="watch-lobby-top" />}');
    expect(src("lib/watch.ts")).toContain("(e.setup->>'date_number')::int as date_number, e.setup->>'venue' as venue,");
  });
});
