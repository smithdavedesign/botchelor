import { describe, expect, it } from "vitest";
import { MCP_CHANGELOG } from "@/lib/mcp/changelog";
import { episodeSummary, episodeTranscript, MCP_SERVER_INFO } from "@/lib/mcp/dispatcher";

// #1778 (the 2026-11-17-0610 run): visitors asked for get_episode's lines without the rest. #1710 (2026-11-16-0610): an
// owner's summary showed the ending beside revealed: false with no word why.
describe("get_episode transcript_only (2.39.0)", () => {
  const ep = {
    id: "e1",
    status: "ready",
    ending: "friends",
    revealed: false,
    characters: [
      { id: "b", name: "Vera Atlas" },
      { id: "a", name: "Odile Brannock" },
    ],
    goals: [{ character_id: "a" }, { character_id: "b" }],
    transcript: [
      { side: "a", dialogue: "Which letter fails first?", action: "points up" },
      { side: "b", dialogue: "The pink E, every winter." },
      { side: "a", action: "laughs" },
    ],
    box_score: { spark: { final: 6 } },
  };

  it("returns the lines in order by speaker, who, the status and the ending; nothing else", () => {
    const out = episodeTranscript({ episode: ep, airs_at: "2026-11-20T10:00:00Z", next_calls: [] });
    expect(out.airs_at).toBe("2026-11-20T10:00:00Z");
    const e = out.episode as Record<string, unknown>;
    expect(e.lines).toEqual(["Odile: Which letter fails first?", "Vera: The pink E, every winter."]);
    expect(e).toMatchObject({ id: "e1", status: "ready", ending: "friends", revealed: false });
    expect(e.box_score).toBeUndefined();
    expect(e.highlights).toBeUndefined();
    expect(out.transcript_note).toContain("lines only");
  });

  it("says beside revealed: false why the owner sees the ending (#1710)", () => {
    const s = episodeSummary({ episode: ep }).episode as Record<string, unknown>;
    expect(s.revealed_note).toContain("because it's your date");
    expect((episodeSummary({ episode: { ...ep, revealed: true } }).episode as Record<string, unknown>).revealed_note).toBeUndefined();
    expect((episodeSummary({ episode: { ...ep, ending: undefined } }).episode as Record<string, unknown>).revealed_note).toBeUndefined();
  });

  it("has its changelog entry", () => {
    expect(MCP_CHANGELOG.find((r) => r.version === "2.39.0")).toBeTruthy();
    expect(MCP_SERVER_INFO.version).toMatch(/^2\.\d+\.\d+$/);
  });
});
