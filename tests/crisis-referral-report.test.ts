import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as report } from "@/app/api/admin/crisis-report/route";
import { countReferral, crisisCheck, referralReport } from "@/lib/crisis";
import { startTestDb } from "./helpers";

// California SB 243's yearly report counts every crisis referral, on every surface (competitor review 2026-11-08, #5).

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

const total = async () => (await t.db.query<{ n: number }>(`select coalesce(sum(n), 0)::int as n from crisis_referrals`)).rows[0].n;

describe("crisis referrals for the SB 243 report", () => {
  it("counts a referral from any surface that checks a person's words, and nothing for ordinary words", async () => {
    expect(crisisCheck("text_hint", "I'd kill for a coffee")).toBeNull();
    expect(crisisCheck("mcp_after_dark", "i want to kill myself")).not.toBeNull();
    await vi.waitFor(async () => expect(await total()).toBe(1));
    const row = (await t.db.query<{ surface: string }>(`select surface from crisis_referrals`)).rows[0];
    expect(row.surface).toBe("mcp_after_dark");
  });

  it("reports a calendar year by surface", async () => {
    await countReferral(t.db, "companion", new Date("2026-03-01T12:00:00Z"));
    await countReferral(t.db, "companion", new Date("2026-07-01T12:00:00Z"));
    await countReferral(t.db, "text_hint", new Date("2026-12-31T23:00:00Z"));
    await countReferral(t.db, "text_hint", new Date("2027-01-01T01:00:00Z"));
    expect(await referralReport(t.db, 2026)).toEqual({ year: 2026, total: 3, by_surface: { companion: 2, text_hint: 1 }, protocol: "/safety" });
  });

  it("is admin only", async () => {
    const res = await report(new Request("http://localhost/api/admin/crisis-report?year=2026"));
    expect(res.status).toBe(403);
  });
});
