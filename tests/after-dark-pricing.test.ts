import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import AfterDarkTheater from "@/app/after-dark/[a]/[b]/AfterDarkTheater";
import { drawAheadNote, drawAheadView } from "@/lib/adult/draw-ahead";
import { includedClipsWords, priceWords } from "@/lib/adult/price-words";
import { clipPrice, hasSubscription, includedPlan, includedPrice } from "@/lib/adult/pricing";
import { DEFAULT_CHAPTER_TOKENS, DEFAULT_CLIP_TOKENS, DEFAULT_INCLUDED_CLIPS, DEFAULT_REEL_TOKENS, getAdultSettings, saveAdultSettings } from "@/lib/adult/settings";
import { DEFAULT_CAPS, takeIncludedClip } from "@/lib/adult/usage";
import { claimAdmin } from "@/lib/admins";
import type { CharacterRef } from "@/lib/game";
import { newUserCookie, startTestDb, userIdOf } from "./helpers";

// #1005, David 2026-10-30: "follow a similar payment methodology [to competitors: a subscription that includes an
// allowance, tokens for extras], but since we're brand new just break even overall is the goal until adoption is higher".
describe("After Dark's prices (#1005)", () => {
  it("defaults: chapters, menu pictures and Draw ahead included, 3 clips a month, extras at about cost", () => {
    expect({ reel: DEFAULT_REEL_TOKENS, clip: DEFAULT_CLIP_TOKENS, included: DEFAULT_INCLUDED_CLIPS, pictures: DEFAULT_CAPS.pictures, writes: DEFAULT_CAPS.writes }).toEqual({
      reel: 7,
      clip: 1,
      included: 3,
      pictures: 60,
      writes: 300,
    });
    // Kept for a viewer with no subscription (who can't open After Dark anyway).
    expect(DEFAULT_CHAPTER_TOKENS).toBe(1);
  });

  it("says included, free or the tokens, and the included clips left", () => {
    expect(priceWords(0, true)).toBe("included");
    expect(priceWords(0)).toBe("free");
    expect(priceWords(1)).toBe("1 token");
    expect(priceWords(7)).toBe("7 tokens");
    expect(includedClipsWords(2, 3)).toBe("2 of 3 clips left this month");
    expect(includedClipsWords(0, 3)).toBe("0 of 3 clips left this month");
    expect(includedClipsWords(null, 3)).toBeNull();
    expect(includedClipsWords(1, 0)).toBeNull();
  });

  it("the theater's Start, Next and Draw ahead say included for a subscriber, and the price otherwise", () => {
    const chars: [CharacterRef, CharacterRef] = [
      { id: "a", name: "Ada Vale", house: false, hue: 300, portrait: null },
      { id: "b", name: "Bo Reyes", house: false, hue: 200, portrait: null },
    ];
    const render = (lines: { who: "a" | "b"; text: string }[], props: Record<string, unknown>) =>
      renderToStaticMarkup(createElement(AfterDarkTheater, { scene: { lines, place: null, stage: 0, dateVenue: null }, characters: chars, onExit: () => {}, onWrite: async () => true, ...props }));
    const line = [{ who: "a" as const, text: "*smiles* Hi." }];
    expect(render(line, { chapterIncluded: true })).toContain("Next · included");
    expect(render([], { chapterIncluded: true })).toContain("▶ Start the night · included");
    expect(render([], { chapterTokens: 1 })).toContain("▶ Start the night · 1 token");
    // An admin: nothing to say.
    expect(render(line, {})).toMatch(/>Next</);
    // #1099: the scene's 📜 toggle says what it is on screen.
    expect(render(line, {})).toContain("📜 <span class=\"theater-icon-word\">Story</span>");
    expect(drawAheadNote({ price: 0, pictures: 4, included: true })).toContain("up to 4 more pictures a chapter, included with your subscription");
    expect(drawAheadNote({ price: 1, pictures: 4 })).toContain("1 token a chapter");
  });

  it("the subscribe page's plan: 300 scene steps, 60 pictures and 3 clips a month; extra clips 1 token, the video 7", () => {
    expect(includedPlan(null)).toEqual({ steps: 300, pictures: 60, clips: 3, clipTokens: 1, reelTokens: 7 });
  });
});

describe("who pays what (lib/adult/pricing.ts)", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
  });
  const subscriber = async (status = "active") => {
    const id = userIdOf(newUserCookie());
    await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, $2, now())`, [id, status]);
    return id;
  };

  it("a fresh database has the new defaults: the video at 7, 3 included clips, 60 pictures a month", async () => {
    expect(await getAdultSettings(t.db)).toMatchObject({ reel_tokens: 7, clip_tokens: 1, included_clips: 3, chapter_tokens: 1, caps: { pictures: 60, writes: 300 } });
    expect(includedPlan(await getAdultSettings(t.db))).toEqual({ steps: 300, pictures: 60, clips: 3, clipTokens: 1, reelTokens: 7 });
  });

  it("includes a chapter, a menu picture and Draw ahead for a subscriber or a reviewer; an admin is free; anyone else pays", async () => {
    const sub = await subscriber();
    const reviewer = userIdOf(newUserCookie());
    await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at, provider, period_end) values ($1, 'active', now(), 'reviewer', now() + interval '7 days')`, [reviewer]);
    const lapsed = await subscriber("lapsed");
    const admin = userIdOf(newUserCookie());
    await claimAdmin(t.db, admin);
    expect(await hasSubscription(t.db, sub)).toBe(true);
    expect(await hasSubscription(t.db, reviewer)).toBe(true);
    expect(await hasSubscription(t.db, lapsed)).toBe(false);
    expect(await includedPrice(t.db, sub, 1)).toEqual({ tokens: 0, included: true });
    expect(await includedPrice(t.db, reviewer, 1)).toEqual({ tokens: 0, included: true });
    expect(await includedPrice(t.db, admin, 1)).toEqual({ tokens: 0, included: false });
    expect(await includedPrice(t.db, lapsed, 1)).toEqual({ tokens: 1, included: false });
    expect(await drawAheadView(t.db, sub, "no-scene")).toMatchObject({ price: 0, included: true });
    expect(await drawAheadView(t.db, admin, "no-scene")).toMatchObject({ price: 0, included: false });
  });

  it("a clip is included for a subscriber's first included_clips a month, then costs clip_tokens", async () => {
    const sub = await subscriber();
    const admin = userIdOf(newUserCookie());
    await claimAdmin(t.db, admin);
    expect(await clipPrice(t.db, sub)).toEqual({ tokens: 0, included: true, included_left: 3, included_of: 3 });
    for (let i = 0; i < 3; i++) expect(await takeIncludedClip(t.db, sub, 3)).not.toBeNull();
    expect(await clipPrice(t.db, sub)).toEqual({ tokens: 1, included: false, included_left: 0, included_of: 3 });
    expect(await clipPrice(t.db, admin)).toEqual({ tokens: 0, included: false, included_left: null, included_of: 3 });
    expect(await clipPrice(t.db, await subscriber("lapsed"))).toEqual({ tokens: 1, included: false, included_left: null, included_of: 3 });
    // The allowance is a setting: 0 turns it off.
    await saveAdultSettings(t.db, { included_clips: 0 });
    expect(await clipPrice(t.db, await subscriber())).toEqual({ tokens: 1, included: false, included_left: null, included_of: 0 });
  });
});
