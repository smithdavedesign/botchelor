import { describe, expect, it } from "vitest";
import { analyticsConsent, consentDefaultScript, consentRequired } from "@/lib/consent";

describe("analytics cookie consent", () => {
  it("asks in the EEA, the UK and Switzerland, and when the country is unknown", () => {
    for (const c of ["DE", "fr", "GB", "CH", "NO"]) expect(consentRequired(c)).toBe(true);
    expect(consentRequired(null)).toBe(true);
    expect(consentRequired("US")).toBe(false);
  });

  it("starts denied with a banner in consent regions, granted without one elsewhere", () => {
    expect(analyticsConsent(undefined, "DE")).toEqual({ granted: false, ask: true });
    expect(analyticsConsent(undefined, "US")).toEqual({ granted: true, ask: false });
  });

  it("a stored choice wins everywhere and hides the banner", () => {
    expect(analyticsConsent("granted", "DE")).toEqual({ granted: true, ask: false });
    expect(analyticsConsent("denied", "US")).toEqual({ granted: false, ask: false });
    expect(analyticsConsent("junk", "DE")).toEqual({ granted: false, ask: true });
  });

  it("the default always denies ad storage and sets analytics from the choice", () => {
    const denied = consentDefaultScript(false);
    expect(denied).toContain("gtag('consent','default'");
    expect(denied).toContain('"analytics_storage":"denied"');
    expect(denied).toContain('"ad_storage":"denied"');
    expect(consentDefaultScript(true)).toContain('"analytics_storage":"granted"');
  });
});
