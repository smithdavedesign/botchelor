import { describe, expect, it } from "vitest";
import Vote from "@/app/vote/page";

// The short link a clip ends on (competitor review 2026-11-08, #1): tonight's situation vote, tagged with the clip's source.
async function target(params: Record<string, string>): Promise<string> {
  try {
    await Vote({ searchParams: Promise.resolve(params) });
  } catch (err) {
    const digest = (err as { digest?: string }).digest ?? "";
    return digest.split(";")[2] ?? digest;
  }
  throw new Error("no redirect");
}

describe("botchelor.com/vote", () => {
  it("lands on the situation vote, tagged with where the clip was", async () => {
    expect(await target({ s: "TikTok" })).toBe("/watch?utm_source=tiktok&utm_medium=clip&utm_campaign=vote#situation");
    expect(await target({ s: "youtube" })).toBe("/watch?utm_source=youtube&utm_medium=clip&utm_campaign=vote#situation");
  });
  it("falls back to 'clip' for no source or a strange one", async () => {
    expect(await target({})).toBe("/watch?utm_source=clip&utm_medium=clip&utm_campaign=vote#situation");
    expect(await target({ s: "<script>" })).toBe("/watch?utm_source=clip&utm_medium=clip&utm_campaign=vote#situation");
  });
});
