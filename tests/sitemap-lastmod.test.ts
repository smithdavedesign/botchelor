// The sitemap's <lastmod> for rewritten landings (lib/landing-changes.ts, 2026-11-23): the day each one shipped, never a
// day still to come, and nothing at all for a page with no recorded change. Google ignores changefreq and priority, so
// an honest lastmod is the sitemap's one way to say "this page has new words".
import { describe, expect, it } from "vitest";
import { LANDING_CHANGES as FROM_INDEXNOW } from "@/lib/indexnow";
import { LANDING_CHANGES, landingLastModified } from "@/lib/landing-changes";
import { staticSitemap } from "@/lib/seo";

const base = "https://botchelor.com";
const entry = (path: string, now: Date) => staticSitemap(base, now).find((e) => e.url === `${base}${path}`);

describe("lastmod for rewritten landings", () => {
  it("is the merge day: a day before the line's changedAt", () => {
    expect(landingLastModified("/x", new Date("2026-12-01T00:00:00Z"), [{ path: "/x", changedAt: "2026-11-24T00:00:00Z" }])).toBe("2026-11-23");
  });

  it("is the newest change that has shipped, never one still to come, and nothing without a line", () => {
    const changes = [
      { path: "/x", changedAt: "2026-11-15T00:00:00Z" },
      { path: "/x", changedAt: "2026-11-24T00:00:00Z" },
      { path: "/x", changedAt: "2026-12-10T00:00:00Z" },
    ];
    expect(landingLastModified("/x", new Date("2026-11-23T18:00:00Z"), changes)).toBe("2026-11-23");
    expect(landingLastModified("/x", new Date("2026-11-20T00:00:00Z"), changes)).toBe("2026-11-14");
    expect(landingLastModified("/x", new Date("2026-11-10T00:00:00Z"), changes)).toBeUndefined();
    expect(landingLastModified("/y", new Date("2026-12-31T00:00:00Z"), changes)).toBeUndefined();
  });

  it("goes in the sitemap for the rewritten landings, and only for them", () => {
    const now = new Date("2026-11-23T19:00:00Z");
    for (const slug of ["character-ai", "janitor-ai", "spicychat", "chai"]) expect(entry(`/alternatives/${slug}`, now)?.lastModified).toBe("2026-11-23");
    expect(entry("/tools/random-ship-generator", now)?.lastModified).toBe("2026-11-23");
    expect(entry("/import", now)?.lastModified).toBe("2026-11-22");
    // A listed page with no recorded change says nothing rather than guess.
    expect(entry("/terms", now)).toBeDefined();
    expect(entry("/terms", now)?.lastModified).toBeUndefined();
    // Every page the sitemap dates is one LANDING_CHANGES names.
    const dated = staticSitemap(base, now).filter((e) => e.lastModified).map((e) => e.url.replace(base, ""));
    const named = new Set(LANDING_CHANGES.map((c) => c.path));
    for (const path of dated) expect(named.has(path)).toBe(true);
  });

  it("reads the same list as IndexNow's daily job", () => {
    expect(FROM_INDEXNOW).toBe(LANDING_CHANGES);
  });
});
