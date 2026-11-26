import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { endedPass, endedPassOf, knowsAfterDark } from "@/lib/adult/lapsed";
import { startTestDb } from "./helpers";

// lib/adult/lapsed.ts: people who have been inside After Dark, or asked to be, are sent to the subscribe page and told
// what ran out, instead of a bare not-found or the invite form again.

const NOW = new Date("2026-12-02T12:00:00Z");
const PAST = "2026-12-01T00:00:00Z";
const FUTURE = "2026-12-20T00:00:00Z";

describe("endedPassOf", () => {
  it("is an ended beta month once its end has passed, and not before", () => {
    expect(endedPassOf({ subscription_status: "active", period_end: PAST, provider: "beta" }, NOW)).toEqual({ kind: "beta", ended: new Date(PAST) });
    expect(endedPassOf({ subscription_status: "active", period_end: FUTURE, provider: "beta" }, NOW)).toBeNull();
  });

  it("is an ended subscription when lapsed, or cancelled with no paid time left", () => {
    expect(endedPassOf({ subscription_status: "lapsed", period_end: PAST, provider: "segpay" }, NOW)?.kind).toBe("subscription");
    expect(endedPassOf({ subscription_status: "cancelled", period_end: PAST, provider: "ccbill" }, NOW)?.kind).toBe("subscription");
    expect(endedPassOf({ subscription_status: "cancelled", period_end: null, provider: "ccbill" }, NOW)?.kind).toBe("subscription");
    // Cancelled with paid-up time left is still open (lib/adult/entitlement.ts).
    expect(endedPassOf({ subscription_status: "cancelled", period_end: FUTURE, provider: "ccbill" }, NOW)).toBeNull();
  });

  it("leaves out a taste (the page says so itself), a reviewer's pass (ours), and no pass at all", () => {
    expect(endedPassOf({ subscription_status: "active", period_end: PAST, provider: "taste" }, NOW)).toBeNull();
    expect(endedPassOf({ subscription_status: "active", period_end: PAST, provider: "reviewer" }, NOW)).toBeNull();
    expect(endedPassOf({ subscription_status: "none", period_end: null, provider: null }, NOW)).toBeNull();
    expect(endedPassOf(null, NOW)).toBeNull();
  });
});

describe("knowsAfterDark and endedPass", () => {
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

  it("knows someone with a pass or an invite request, and no one else", async () => {
    expect(await knowsAfterDark(t.db, "stranger")).toBe(false);
    await t.db.query(`insert into adult_invites (user_id, email, status) values ('asked', 'asked@example.com', 'pending')`);
    expect(await knowsAfterDark(t.db, "asked")).toBe(true);
    await t.db.query(
      `insert into adult_entitlements (user_id, subscription_status, period_end, age_verified_at, provider) values ('was-beta', 'active', $1, now(), 'beta')`,
      [PAST],
    );
    expect(await knowsAfterDark(t.db, "was-beta")).toBe(true);
    expect(await endedPass(t.db, "was-beta", NOW)).toEqual({ kind: "beta", ended: new Date(PAST) });
    expect(await endedPass(t.db, "stranger", NOW)).toBeNull();
  });
});
