import { describe, expect, it } from "vitest";
import { POST as ageRoute } from "@/app/api/age/route";
import { safeFrom } from "@/lib/age";
import { BASE_URL } from "./helpers";

describe("the 18+ entry gate", () => {
  it("only returns to safe, local paths (no open redirect, no gate loop)", () => {
    expect(safeFrom("/feed")).toBe("/feed");
    expect(safeFrom("/episodes/x?y=1")).toBe("/episodes/x?y=1");
    expect(safeFrom("//evil.example")).toBe("/");
    expect(safeFrom("https://evil.example")).toBe("/");
    expect(safeFrom("/gate?from=/x")).toBe("/");
    expect(safeFrom(null)).toBe("/");
    expect(safeFrom(undefined)).toBe("/");
  });

  it("confirming sets the year-long adult cookie and returns to where they were headed", async () => {
    const res = await ageRoute(new Request(`${BASE_URL}/api/age`, { method: "POST", body: new URLSearchParams({ from: "/feed" }) }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${BASE_URL}/feed`);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/bz_adult=1/);
    expect(setCookie).toMatch(/Max-Age=31536000/i);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
  });

  it("falls back to home for an unsafe or missing destination", async () => {
    const res = await ageRoute(new Request(`${BASE_URL}/api/age`, { method: "POST", body: new URLSearchParams({ from: "https://evil.example" }) }));
    expect(res.headers.get("location")).toBe(`${BASE_URL}/`);
    const noBody = await ageRoute(new Request(`${BASE_URL}/api/age`, { method: "POST" }));
    expect(noBody.status).toBe(303);
    expect(noBody.headers.get("location")).toBe(`${BASE_URL}/`);
  });
});
