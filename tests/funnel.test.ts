import { describe, expect, it } from "vitest";
import { externalReferrer, shouldSend } from "@/app/funnel";

const live = { production: true, webdriver: false, notrack: false, consentDenied: false };

describe("RepoHQ funnel beacon: when to send", () => {
  it("sends from production for a real visitor", () => {
    expect(shouldSend(live)).toBe(true);
  });

  it("never from a preview or local run, an automated browser, the owner's browser, or a visitor who said no", () => {
    expect(shouldSend({ ...live, production: false })).toBe(false);
    expect(shouldSend({ ...live, webdriver: true })).toBe(false);
    expect(shouldSend({ ...live, notrack: true })).toBe(false);
    expect(shouldSend({ ...live, consentDenied: true })).toBe(false);
  });

  it("names another site as the referrer, never our own pages", () => {
    const origin = "https://botchelor.vercel.app";
    expect(externalReferrer("https://www.reddit.com/r/CharacterAI/", origin)).toBe("https://www.reddit.com/r/CharacterAI/");
    expect(externalReferrer("https://botchelor.vercel.app/feed", origin)).toBeNull();
    expect(externalReferrer("", origin)).toBeNull();
    expect(externalReferrer("not a url", origin)).toBeNull();
  });
});
