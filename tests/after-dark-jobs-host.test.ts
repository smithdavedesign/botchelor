// #1009 (2026-10-30 prod loop): jobs that make or read After Dark media run on After Dark's own host, where its media is.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AFTER_DARK_HOST_APIS } from "@/lib/after-dark-host";

describe("After Dark's jobs on its own host (#1009)", () => {
  it("serves them there, and the scheduled job calls them there", () => {
    expect(AFTER_DARK_HOST_APIS).toEqual(expect.arrayContaining(["/api/jobs/after-dark-daily", "/api/jobs/showcase-check"]));
    const spec = readFileSync(".do/app.yaml", "utf8");
    expect(spec).toContain("call ad.botchelor.com after-dark-daily");
    expect(spec).toContain("call ad.botchelor.com showcase-check");
    expect(spec).not.toMatch(/call botchelor\.com (showcase-check|after-dark-daily)/);
  });

  it("the show's daily job no longer makes the cast's baselines", () => {
    expect(readFileSync("app/api/jobs/daily/route.ts", "utf8")).not.toContain("ensureCastBaselines");
  });
});
