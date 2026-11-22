import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The test files still on bare-cookie personas (tests/setup-legacy-ids.ts): every other file runs under production's
// identity rule. The list only shrinks: a file whose personas sign in (helpers.ts signedInCookie) comes off it, and a
// new file never goes on.
describe("test files on the legacy identity rule", () => {
  const list = JSON.parse(readFileSync("tests/legacy-bare-id-files.json", "utf8")) as string[];

  it("only shrinks: 72 on 2026-11-22", () => {
    expect(list.length).toBeLessThanOrEqual(72);
  });

  it("names test files that exist, once each, in order", () => {
    for (const f of list) expect(existsSync(`tests/${f}`), f).toBe(true);
    expect(new Set(list).size).toBe(list.length);
    expect([...list].sort()).toEqual(list);
  });

  it("leaves every other file, this one included, under production's rule", () => {
    expect(list).not.toContain("legacy-bare-ids.test.ts");
    expect(process.env.LEGACY_BARE_UID).toBeUndefined();
  });
});
