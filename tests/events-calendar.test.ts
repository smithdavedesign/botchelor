import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as adminEvents } from "@/app/api/admin/events/route";
import { addShowEvent, calendarIcs, cancelShowEvent, showCalendar } from "@/lib/events-calendar";
import { handleMcpMessage } from "@/lib/mcp";
import { setSeasonFormatForTests } from "@/lib/season-format-store";
import { startTestDb } from "./helpers";

// The events calendar (lib/events-calendar.ts): the show's own schedule, the admin's one-off nights, a feed and a tool.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});
afterEach(() => {
  setSeasonFormatForTests(null);
});

// Thursday 3 December 2026, in a December season.
const NOW = new Date("2026-12-03T10:00:00Z");
const ENV = { SUNDAY_PREMIERE: "1" };

describe("the show's own schedule", () => {
  it("lists a lead season's ceremonies, their votes, the final rose and the Reunion, in order", async () => {
    setSeasonFormatForTests("botchelor");
    const cal = await showCalendar(t.db, NOW, 35, ENV);
    const ids = cal.events.map((e) => e.id);
    expect(ids).toContain("ceremony:2026-12-06");
    expect(ids).toContain("vote:2026-12-13");
    expect(cal.events.find((e) => e.id === "ceremony:2026-12-27")).toMatchObject({ kind: "finale", title: "The final rose" });
    expect(cal.events.find((e) => e.kind === "reunion")?.starts_at).toBe("2027-01-01T00:00:00.000Z");
    // Sorted, and nothing that already ended (the 1st's premiere) or past the window.
    expect([...cal.events].sort((a, b) => a.starts_at.localeCompare(b.starts_at))).toEqual(cal.events);
    expect(ids).not.toContain("season:2026-12-01");
    expect(cal.events.every((e) => e.starts_at < cal.until && e.source === "show")).toBe(true);
    // The next season premieres inside a 35-day window.
    expect(cal.events.some((e) => e.kind === "season" && e.starts_at === "2027-01-01T00:00:00.000Z")).toBe(true);
  });

  it("lists recoupling nights and twist weeks for an open season, and casting from the 20th", async () => {
    setSeasonFormatForTests("classic");
    const cal = await showCalendar(t.db, NOW, 30, ENV);
    expect(cal.events.some((e) => e.kind === "recoupling")).toBe(true);
    expect(cal.events.some((e) => e.kind === "twist")).toBe(true);
    expect(cal.events.find((e) => e.kind === "casting")?.starts_at).toBe("2026-12-20T00:00:00.000Z");
    expect(cal.events.some((e) => e.kind === "ceremony")).toBe(false);
  });

  it("says the nightly mixer once, unless the house fill is off", async () => {
    expect((await showCalendar(t.db, NOW, 7, ENV)).every_night.map((e) => e.id)).toContain("nightly:mixer");
    expect((await showCalendar(t.db, NOW, 7, { ...ENV, MIXER_HOUSE_FILL: "0" })).every_night.map((e) => e.id)).not.toContain("nightly:mixer");
  });
});

describe("one-off nights", () => {
  it("an admin adds a themed party, it shows, and calling it off takes it away", async () => {
    const r = await addShowEvent(t.db, { title: "Masquerade mixer", blurb: "Masks on.", kind: "party", starts_at: "2026-12-12T20:00:00Z", path: "/watch" }, "admin-1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const cal = await showCalendar(t.db, NOW, 35, ENV);
    expect(cal.events.find((e) => e.id === r.id)).toMatchObject({ title: "Masquerade mixer", kind: "party", source: "admin", path: "/watch" });
    expect(await cancelShowEvent(t.db, r.id)).toBe(true);
    expect((await showCalendar(t.db, NOW, 35, ENV)).events.some((e) => e.id === r.id)).toBe(false);
  });

  it("refuses an event that ends before it starts, or a link off the site", async () => {
    expect(await addShowEvent(t.db, { title: "Backwards", starts_at: "2026-12-12T20:00:00Z", ends_at: "2026-12-12T19:00:00Z" }, "a")).toEqual({ ok: false, reason: expect.stringContaining("after") });
    expect((await addShowEvent(t.db, { title: "Elsewhere", starts_at: "2026-12-12T20:00:00Z", path: "https://example.com" }, "a")).ok).toBe(false);
  });

  it("is admin-only over the API", async () => {
    const res = await adminEvents(new Request("http://localhost:3000/api/admin/events", { method: "POST", body: JSON.stringify({ action: "add", title: "Party", starts_at: "2026-12-12T20:00:00Z" }) }));
    expect(res.status).toBe(403);
  });
});

describe("the feed and the tool", () => {
  it("is a valid iCalendar feed with the nightly mixer repeating", async () => {
    setSeasonFormatForTests("botchelor");
    const ics = calendarIcs(await showCalendar(t.db, NOW, 35, ENV), "https://botchelor.com", NOW);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect(ics).toContain("SUMMARY:The final rose");
    expect(ics).toContain("RRULE:FREQ=DAILY");
    expect(ics.split("\r\n").every((l) => l.length <= 75)).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(ics.match(/END:VEVENT/g)?.length);
  });

  it("get_events answers anyone, with what an agent can do", async () => {
    setSeasonFormatForTests("botchelor");
    const reply = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_events", arguments: { days: 70 } } }, {});
    const r = (reply as { result: { isError?: boolean; structuredContent: { events: { kind: string; for_agents?: string }[]; note: string } } }).result;
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.note).toContain("UTC");
  });
});
