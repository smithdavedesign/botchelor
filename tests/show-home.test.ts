import { describe, expect, it } from "vitest";
import { showHome } from "@/lib/site";

describe("showHome (After Dark's \"Back to the show\")", () => {
  it("is / on the show", () => {
    expect(showHome({ SITE_URL: "https://botchelor.com" })).toBe("/");
    expect(showHome({ SITE_URL: "https://botchelor.com", AFTER_DARK_ORIGIN: "https://ad.botchelor.com" })).toBe("/");
  });
  it("is the show's address on After Dark's host, never its own /", () => {
    const env = { SITE_URL: "https://botchelor.com/", AFTER_DARK_ORIGIN: "https://ad.botchelor.com", AFTER_DARK_ONLY: "1" };
    expect(showHome(env)).toBe("https://botchelor.com");
  });
});
