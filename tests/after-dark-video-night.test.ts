import { describe, expect, it } from "vitest";
import { groupNights, makingNote, nightNumbers, videoNight } from "@/lib/adult/nights";

// David, 2026-11-04: "I generated a whole night clip for a new night and it says it's appending to the previous night's
// video reel". Each video belongs to the night it filmed.
const row = (id: string, chapter: number, at: string) => ({ id, chapter, created_at: at });
const groups = groupNights([row("n1c1", 1, "2026-10-21T07:38:00Z"), row("n1c2", 2, "2026-10-21T07:46:00Z"), row("n2c1", 1, "2026-11-04T04:24:00Z")], { chapter: 2 });
const numbers = nightNumbers(groups);

describe("which night a video filmed", () => {
  it("by the saved chapters it covers, else the scene being written then", () => {
    expect(videoNight({ chapters: [{ chapter: 1, night_id: "n1c1" }, { chapter: 2, night_id: "n1c2" }], created_at: "2026-10-25T04:02:00Z" }, groups, numbers)).toBe(1);
    expect(videoNight({ chapters: [{ chapter: 1, night_id: "n2c1" }, { chapter: 2, night_id: null }], created_at: "2026-11-04T04:36:00Z" }, groups, numbers)).toBe(2);
    // Chapter 1 of a new night, nothing of it saved yet: the night after the ones begun before it.
    expect(videoNight({ chapters: [{ chapter: 1, night_id: null }], created_at: "2026-11-01T10:00:00Z" }, groups, numbers)).toBe(2);
    // A later chapter of the latest night, still being written.
    expect(videoNight({ chapters: [{ chapter: 3, night_id: null }], created_at: "2026-10-21T08:00:00Z" }, groups, numbers)).toBe(1);
    // From before chapters were recorded.
    expect(videoNight({ chapters: null, created_at: "2026-10-21T16:10:00Z" }, groups, numbers)).toBeNull();
  });

  it("a video being made says how many of its shots are in (kept and not yet sent isn't in)", () => {
    expect(makingNote({ kind: "night", shots: [{ status: "ready" }, { status: "failed" }, { status: "queued" }, { status: "frame_ready" }] })).toBe("🎬 Making the video: 2 of 4 shots done");
    expect(makingNote({ kind: "clip", shots: [{ status: "queued" }] })).toBe("🎬 Making the clip…");
  });
});
