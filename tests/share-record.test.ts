import { describe, expect, it } from "vitest";
import { GET as getRecordCard } from "@/app/api/og/record/route";
import { shareOf } from "@/app/YourCalls";
import { nightCode, parseRecordShare, recordGrid, recordSharePath, recordShareText, SHARE_SQUARES, tonightOf, type RecordShare } from "@/lib/share-record";
import { NO_CALLS, recordOf } from "@/lib/streaks";

const SHARE: RecordShare = { recent: [true, true, false, true, true, true], right: 5, called: 6, streak: 3, best: 3, season: 1, night: 2 };

describe("the spoiler-free share card (lib/share-record.ts)", () => {
  it("is squares, the record and a link: no names, no picks, no endings", () => {
    const text = recordShareText(SHARE, `https://botchelor.com${recordSharePath(SHARE)}`);
    expect(text.split("\n")).toEqual([
      "My Botchelor calls · S1 · Night 2",
      "🟩🟩⬛🟩🟩🟩",
      "5 of 6 right · 3 in a row",
      "https://botchelor.com/calls?g=110111&w=5&c=6&s=3&b=3&n=1-2&ref=share-record",
    ]);
    expect(text).not.toMatch(/second date|friends|disaster/i);
  });

  it("shows at most SHARE_SQUARES of the latest calls", () => {
    const many = Array.from({ length: 25 }, (_, i) => i % 3 !== 0);
    expect([...recordGrid(many)]).toHaveLength(SHARE_SQUARES); // one code point a square
    expect(recordSharePath({ ...SHARE, recent: many, called: 25, right: 16 })).toMatch(/g=[01]{10}&/);
  });

  it("parses its own links back, and refuses anything that isn't just the numbers", () => {
    const q = Object.fromEntries(new URLSearchParams(recordSharePath(SHARE).split("?")[1]).entries());
    expect(parseRecordShare(q)).toEqual(SHARE);
    expect(parseRecordShare({ ...q, g: "11x" })).toBeNull();
    expect(parseRecordShare({ ...q, g: "1".repeat(SHARE_SQUARES + 1) })).toBeNull();
    expect(parseRecordShare({ ...q, w: "9" })).toBeNull(); // more right than called
    expect(parseRecordShare({ ...q, s: "<b>" })).toBeNull();
    expect(parseRecordShare({ ...q, n: "Ruby dumps Sol" })).toMatchObject({ season: null, night: null });
    expect(parseRecordShare({})).toBeNull();
  });

  it("dates the card by tonight's night, never an episode's", () => {
    expect(nightCode(tonightOf(new Date("2026-11-02T20:00:00Z")))).toBe("S2 · Night 2"); // November is the second monthly season
    expect(nightCode({ season: null, night: null })).toBeNull();
  });

  it("a record without calls has nothing to share", () => {
    expect(shareOf(NO_CALLS)).toBeNull();
    expect(shareOf({ ...recordOf([true, false]), recent: [true, false] })).toMatchObject({ right: 1, called: 2, recent: [true, false] });
  });

  it("draws the card from the numbers alone, and a bad link gets the plain invitation", async () => {
    const ok = await getRecordCard(new Request(`http://localhost:3000/api/og/record?${recordSharePath(SHARE).split("?")[1]}`));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toMatch(/image\/png/);
    const bad = await getRecordCard(new Request("http://localhost:3000/api/og/record?g=hello"));
    expect(bad.status).toBe(200);
  });
});
