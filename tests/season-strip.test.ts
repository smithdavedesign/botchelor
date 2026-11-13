import { describe, expect, it } from "vitest";
import { onSpectatorPage } from "@/app/SeasonStrip";

/** Where the season's arc runs under the header (app/SeasonStrip.tsx). */
describe("the season strip's pages", () => {
  it("runs on the show's spectator pages, the characters directory and the seasons index included (2026-11-13)", () => {
    for (const path of ["/", "/watch", "/showcase", "/reunion", "/seasons", "/seasons/october-2026", "/characters", "/cast", "/reviews", "/graph", "/episodes/abc", "/couples/a/b", "/casting", "/mixers/x", "/doubles/y"]) {
      expect(onSpectatorPage(path), path).toBe(true);
    }
  });

  it("stays off the theater and the pages about you", () => {
    for (const path of ["/watch/room-1", "/characters/house-nell", "/characters/abc/edit", "/create", "/matches", "/account", "/pricing", "/companion", "/swipe", "/after-dark"]) {
      expect(onSpectatorPage(path), path).toBe(false);
    }
  });
});
