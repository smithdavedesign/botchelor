import { afterEach, describe, expect, it } from "vitest";
import { checkRateLimit, rateLimitMessage, resetRateLimitsForTests } from "@/lib/rate-limit";

afterEach(() => resetRateLimitsForTests());

describe("rate limiting", () => {
  it("allows up to the limit, then refuses with a retry window", () => {
    // swipe = 60 in 60 s
    const uid = "u1";
    for (let i = 0; i < 60; i++) {
      const r = checkRateLimit(uid, "swipe");
      expect(r.ok).toBe(true);
    }
    const r = checkRateLimit(uid, "swipe");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.limit).toBe(60);
      expect(r.retry_after_seconds).toBeGreaterThan(0);
      expect(r.retry_after_seconds).toBeLessThanOrEqual(60);
      expect(rateLimitMessage(r)).toMatch(/Too many swipe calls/);
      expect(rateLimitMessage(r)).toMatch(/BYOK or a paid pass/);
    }
  });

  it("isolates buckets per user and per bucket", () => {
    // Different user: not affected.
    for (let i = 0; i < 10; i++) checkRateLimit("same", "create_character");
    const u2 = checkRateLimit("other", "create_character");
    expect(u2.ok).toBe(true);
    // Same user, different bucket: not affected.
    const otherKind = checkRateLimit("same", "swipe");
    expect(otherKind.ok).toBe(true);
  });

  it("recovers after the window passes", () => {
    const start = Date.now();
    for (let i = 0; i < 10; i++) checkRateLimit("rolling", "create_character", start + i);
    // 11th at the same time: refused.
    const refused = checkRateLimit("rolling", "create_character", start + 11);
    expect(refused.ok).toBe(false);
    // The window is 300 s; advance past it.
    const ok = checkRateLimit("rolling", "create_character", start + 300_001);
    expect(ok.ok).toBe(true);
  });

  it("the message tells the user what the cap is for and when to retry", () => {
    const uid = "fb";
    for (let i = 0; i < 10; i++) checkRateLimit(uid, "feedback");
    const r = checkRateLimit(uid, "feedback");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const msg = rateLimitMessage(r);
      expect(msg).toMatch(/limit 10/);
      expect(msg).toMatch(/try again/);
    }
  });
});
