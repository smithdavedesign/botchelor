import { describe, expect, it } from "vitest";
import { freshJobs, JOB_DEAL_MINUTES, JOB_IDEAS, type SheetDraft } from "@/lib/originality";

// #1016 (run 2026-10-30-1924): two agents on one model, near-identical names, both offered "a lock restorer" first.
const sheet: SheetDraft = { name: "Odalys Varga", extras: { occupation: "a lighthouse keeper" } };
const NOW = Date.UTC(2026, 9, 30, 19, 24);
const WINDOW = JOB_DEAL_MINUTES * 60_000;

describe("freshJobs (#1016)", () => {
  it("is the same for one caller within a window, so check_only and create agree", () => {
    const start = Math.floor(NOW / WINDOW) * WINDOW;
    expect(freshJobs(sheet, [], 3, "agent-a", start)).toEqual(freshJobs(sheet, [], 3, "agent-a", start + WINDOW - 1));
  });

  it("deals different jobs to different agents with the same character name", () => {
    const lists = ["agent-a", "agent-b", "agent-c", "agent-d", "agent-e", "agent-f"].map((by) => freshJobs(sheet, [], 3, by, NOW));
    expect(new Set(lists.map((l) => l[0])).size).toBeGreaterThan(3);
    for (const l of lists) expect(l).toHaveLength(3);
  });

  it("moves on in the next window", () => {
    const windows = [0, 1, 2, 3, 4].map((k) => freshJobs(sheet, [], 3, "agent-a", NOW + k * WINDOW).join("|"));
    expect(new Set(windows).size).toBeGreaterThan(1);
  });

  it("never offers a job a character already has, nor one sharing a word with it", () => {
    const first = freshJobs(sheet, [], 3, "agent-a", NOW);
    const others: SheetDraft[] = first.map((job) => ({ extras: { occupation: job } }));
    const next = freshJobs(sheet, others, 3, "agent-a", NOW);
    expect(next).toHaveLength(3);
    for (const job of next) expect(first).not.toContain(job);
    expect(freshJobs(sheet, [{ extras: { occupation: "Lock restorer" } }], 40, "agent-a", NOW)).not.toContain("a lock restorer");
  });

  it("still deals different jobs when the hand-picked ones are all taken (#1096)", () => {
    // On the live show every hand-picked idea is somebody's job: everyone used to be dealt the same few leftovers.
    const taken: SheetDraft[] = JOB_IDEAS.map((job) => ({ extras: { occupation: job } }));
    const lists = ["agent-a", "agent-b", "agent-c", "agent-d"].map((by) => freshJobs(sheet, taken, 3, by, NOW));
    for (const l of lists) expect(l).toHaveLength(3);
    expect(new Set(lists.flat()).size).toBeGreaterThan(9);
    // One per thing in a deal, and none on a thing a character already looks after.
    for (const l of lists) expect(new Set(l.map((j) => j.split(" ").slice(1, -1).join(" "))).size).toBe(3);
    expect(freshJobs(sheet, [...taken, { extras: { occupation: "jukebox repair" } }], 40, "agent-a", NOW).some((j) => /jukebox/.test(j))).toBe(false);
  });

  it("knows two names for one job: an elevator inspector on the show keeps 'a lift inspector' out of the deal (#1110)", () => {
    // Every other hand-picked job taken, so the one hand-picked slot can only be the lift inspector.
    const rest: SheetDraft[] = JOB_IDEAS.filter((j) => j !== "a lift inspector").map((job) => ({ extras: { occupation: job } }));
    expect(freshJobs(sheet, rest, 3, "agent-a", NOW)[0]).toBe("a lift inspector");
    expect(freshJobs(sheet, [...rest, { extras: { occupation: "Elevator inspector" } }], 3, "agent-a", NOW)).not.toContain("a lift inspector");
    expect(freshJobs(sheet, [{ extras: { occupation: "a truck driver" } }], 200, "agent-a", NOW).some((j) => /lorry/.test(j))).toBe(false);
  });
});
