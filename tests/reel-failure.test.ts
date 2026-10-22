// A video of the night that doesn't come through says why (lib/adult/reel-failure.ts, app/after-dark/[a]/[b]/Reels.tsx).
// 2026-10-22: Venice ran out of credits, every video failed within two minutes, and the page only said "That video didn't
// come through"; a part-failed one called its failed shots "discarded by the check".
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Reels from "@/app/after-dark/[a]/[b]/Reels";
import { reelFailureNote } from "@/lib/adult/reel-failure";
import type { Reel, ReelShot } from "@/lib/adult/reels";

const VENICE_402 = 'Venice 402: {"error":"Insufficient USD or Diem balance to complete request. Visit https://venice.ai/settings/api to add credits."}';
const shot = (status: ReelShot["status"], reason?: string, media_id?: string) => ({ status, reason, media_id }) as ReelShot;
const reel = (status: Reel["status"], shots: ReelShot[]): Reel => ({ id: "r1", status, tokens: 0, shots, created_at: new Date().toISOString() });
const page = (r: Reel) => renderToStaticMarkup(createElement(Reels, { reels: [r], onChange: () => {} })).replace(/&#x27;|&apos;/g, "'");

describe("why a video didn't come through", () => {
  it("names Venice running out of credits, with where to top up", () => {
    expect(reelFailureNote([shot("failed", VENICE_402), shot("failed", "Venice 402")])).toBe(
      "Venice, which makes the videos, is out of credits: top it up at venice.ai/settings/api, then make the video again.",
    );
  });

  it("says what to do for the other provider answers, and quotes anything else", () => {
    expect(reelFailureNote([shot("failed", "Venice 401")])).toMatch(/refused the key/);
    expect(reelFailureNote([shot("failed", "Venice 429")])).toMatch(/limiting requests/);
    expect(reelFailureNote([shot("failed", "Venice 503")])).toMatch(/error on its side/);
    expect(reelFailureNote([shot("failed", "gave up waiting")])).toMatch(/took too long/);
    expect(reelFailureNote([shot("failed", "voice: no audio")])).toBe("The first error: voice: no audio.");
  });

  it("adds nothing when there's no reason, the owner stopped it, or the shots were the check's call", () => {
    expect(reelFailureNote([shot("failed")])).toBeNull();
    expect(reelFailureNote([shot("failed", "stopped")])).toBeNull();
    expect(reelFailureNote([shot("discarded", "the check: underage cue"), shot("ready", undefined, "m1")])).toBeNull();
  });

  it("on the page: a failed video says why, and a part-failed one doesn't blame the check", () => {
    const failed = page(reel("failed", [shot("failed", VENICE_402), shot("failed", VENICE_402)]));
    expect(failed).toContain("That video didn't come through, and its tokens are back. Venice, which makes the videos, is out of credits");
    expect(failed).toContain('class="error small"');

    const part = page(reel("ready", [shot("ready", undefined, "m1"), shot("discarded", "the check"), shot("failed", VENICE_402)]));
    expect(part).toContain("1 shot(s) discarded by the check.");
    expect(part).toContain("1 shot(s) didn't come through, and their share of the tokens is back. Venice, which makes the videos, is out of credits");

    // The owner's own stop keeps its plain line.
    expect(page(reel("failed", [shot("failed", "stopped")]))).toContain("Stopped before any shot came through. Its tokens are back.");
  });
});
