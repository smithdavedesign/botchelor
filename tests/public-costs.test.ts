import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import CostsPage from "@/app/costs/page";
import { publicCostsFrom } from "@/lib/public-costs";
import { PUBLIC_PATHS } from "@/lib/site";
import { addEntry, type MoneyEntry } from "@/lib/spend";
import { startTestDb } from "./helpers";

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

const entry = (over: Partial<MoneyEntry>): MoneyEntry => ({
  id: "e", kind: "cost", category: "infra", provider: "X", label: "x", usd: 10, every: "month", starts_on: "2026-10-15", ends_on: null, note: null, seed_key: null, ...over,
});
const NOV = new Date("2026-11-10T12:00:00Z");

describe("the public cost ledger (lib/public-costs.ts)", () => {
  it("adds up costs by month and provider, newest first, and leaves income out", () => {
    const c = publicCostsFrom(
      [
        entry({ provider: "DigitalOcean", usd: 10 }),
        entry({ provider: "DigitalOcean", usd: 12, label: "the other app" }),
        entry({ provider: "Hive", category: "api", usd: 111, every: "once", starts_on: "2026-10-13" }),
        entry({ provider: "OpenRouter", category: "api", usd: 50, every: "once", starts_on: "2026-11-02" }),
        entry({ kind: "income", provider: "Stripe", usd: 999, every: "once", starts_on: "2026-11-03" }),
      ],
      NOV,
    );
    expect(c.firstMonth).toBe("2026-10");
    expect(c.months.map((m) => m.month)).toEqual(["2026-11", "2026-10"]);
    expect(c.months[0]).toEqual({
      month: "2026-11",
      total: 72,
      byCategory: { api: 50, infra: 22, other: 0 },
      byProvider: [
        { provider: "OpenRouter", usd: 50 },
        { provider: "DigitalOcean", usd: 22 },
      ],
    });
    expect(c.months[1].total).toBe(133);
    expect(c.sinceStart).toBe(205);
  });

  it("is empty with nothing recorded, and never reaches back past six months", () => {
    expect(publicCostsFrom([], NOV)).toEqual({ months: [], sinceStart: 0, firstMonth: null });
    const c = publicCostsFrom([entry({ starts_on: "2025-01-01" })], NOV);
    expect(c.months).toHaveLength(6);
    expect(c.sinceStart).toBe(230);
  });
});

describe("/costs", () => {
  it("shows the ledger's costs, never its notes, labels or income, and is in the sitemap", async () => {
    await addEntry(t.db, { kind: "cost", category: "api", provider: "Hive", label: "a private label", usd: 111, every: "once", starts_on: "2026-10-13", ends_on: null, note: "a private note" }, null);
    await addEntry(t.db, { kind: "income", category: "other", provider: "Stripe", label: "sales", usd: 4321, every: "once", starts_on: "2026-10-20", ends_on: null, note: null }, null);
    const html = renderToStaticMarkup(await CostsPage());
    expect(html).toContain("What Botchelor costs");
    expect(html).toContain("Hive");
    expect(html).toContain("$111.00");
    for (const hidden of ["a private note", "a private label", "4,321", "4321"]) expect(html).not.toContain(hidden);
    // The running costs and the unit costs are there with or without a ledger.
    for (const s of ["DigitalOcean App Platform", "A date written by our model", "An age check (Didit)"]) expect(html).toContain(s);
    expect(html).toContain('href="/about"');
    expect(PUBLIC_PATHS).toContain("/costs");
  });

  it("says so when nothing is recorded", async () => {
    expect(renderToStaticMarkup(await CostsPage())).toContain("Nothing recorded yet.");
  });
});
