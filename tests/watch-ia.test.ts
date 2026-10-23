import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import RecapToggle, { RECAP_TOGGLE_LABEL } from "@/app/episodes/[id]/RecapToggle";
import { listAiredPage, listAiringSoon, parsePage, WATCH_PAGE_SIZE } from "@/lib/game";
import { formatCountdown, preshowCountdownLabel, WATCH_FIRST_LINE_AT } from "@/lib/rules";
import { watchClock } from "@/lib/watch";
import { api, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

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

const userOf = (cookie: string) => cookie.split("=")[1];

/** One date for a new host; `airedMinutesAgo` airs it that long ago (null leaves it unaired). */
async function makeDate(opts: { airedMinutesAgo?: number | null; visibility?: string; host?: string } = {}) {
  const host = opts.host ?? newUserCookie();
  const character = await (await api.createCharacter(validCharacter(), host)).json();
  scriptOutcome({ ending: "friends" });
  scriptedModel([episodeJson()]);
  const res = await api.createEpisode(
    { character_id: character.id, partner_id: HOUSE_PARTNER_ID, ...(opts.visibility ? { visibility: opts.visibility } : {}) },
    host,
  );
  if (res.status !== 200) throw new Error(`episode setup failed with ${res.status}`);
  const episode = (await res.json()) as { id: string };
  if (opts.airedMinutesAgo !== undefined && opts.airedMinutesAgo !== null) {
    await t.db.query(`update episodes set revealed_at = now() - $2 * interval '1 minute', air_after = null where id = $1`, [
      episode.id,
      opts.airedMinutesAgo,
    ]);
  }
  return { host, id: episode.id };
}

describe("Watch's ?page param is parsed safely", () => {
  it("reads whole numbers from 1 and everything else as page 1", () => {
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage(null)).toBe(1);
    expect(parsePage("")).toBe(1);
    expect(parsePage("1")).toBe(1);
    expect(parsePage("2")).toBe(2);
    expect(parsePage(" 3 ")).toBe(3);
    expect(parsePage(["4", "9"])).toBe(4);
    for (const junk of ["0", "-2", "2.5", "1e3", "abc", "2abc", "0x10", "Infinity", "NaN", "999999999", "12345678901234567890"]) {
      expect(parsePage(junk)).toBe(1);
    }
  });
});

describe("Watch's latest episodes: aired dates, newest first, a page at a time", () => {
  it("pages 1 and 2 hold the newest aired dates in order; unaired, private and the viewer's own are left out", async () => {
    // Five aired dates, aired 10, 20, 30, 40, 50 minutes ago (newest first: d10, d20, ...).
    const aired = [];
    for (const minutes of [30, 10, 50, 20, 40]) aired.push({ minutes, ...(await makeDate({ airedMinutesAgo: minutes })) });
    const newestFirst = [...aired].sort((x, y) => x.minutes - y.minutes).map((d) => d.id);
    const unaired = await makeDate();
    const priv = await makeDate({ visibility: "private" });
    const viewer = newUserCookie();
    const own = await makeDate({ airedMinutesAgo: 1, host: viewer });

    const page1 = await listAiredPage(t.db, userOf(viewer), 1, 2);
    expect(page1.episodes.map((e) => e.id)).toEqual(newestFirst.slice(0, 2));
    expect(page1).toMatchObject({ page: 1, pages: 3, total: 5, per_page: 2 });
    const page2 = await listAiredPage(t.db, userOf(viewer), 2, 2);
    expect(page2.episodes.map((e) => e.id)).toEqual(newestFirst.slice(2, 4));
    const page3 = await listAiredPage(t.db, userOf(viewer), 3, 2);
    expect(page3.episodes.map((e) => e.id)).toEqual(newestFirst.slice(4));

    const everything = (await listAiredPage(t.db, userOf(viewer), 1)).episodes.map((e) => e.id);
    expect(everything).toEqual(newestFirst);
    expect(everything).not.toContain(unaired.id);
    expect(everything).not.toContain(priv.id);
    expect(everything).not.toContain(own.id); // the viewer's own date is on their account page
    expect((await listAiredPage(t.db, null, 1)).episodes.map((e) => e.id)).toContain(own.id); // everyone else sees it
    expect(page1.episodes.every((e) => e.revealed)).toBe(true);
  });

  it("an out-of-range page comes back empty with the real page count", async () => {
    await makeDate({ airedMinutesAgo: 5 });
    await makeDate({ airedMinutesAgo: 6 });
    await makeDate({ airedMinutesAgo: 7 });
    const past = await listAiredPage(t.db, null, 9, 2);
    expect(past.episodes).toEqual([]);
    expect(past).toMatchObject({ page: 9, pages: 2, total: 3 });
    const empty = await listAiredPage(t.db, null, 1);
    expect(empty.pages).toBe(1);
  });

  it("shows 12 a page by default", async () => {
    expect(WATCH_PAGE_SIZE).toBe(12);
    expect((await listAiredPage(t.db, null)).per_page).toBe(12);
  });
});

describe("Watch's airing soon: public dates still open to predictions, soonest first", () => {
  it("lists unaired public dates by when they air, never aired, private or the viewer's own", async () => {
    const later = await makeDate();
    const sooner = await makeDate();
    // `sooner` was booked earlier, so its window closes first; `later` is scheduled further out.
    await t.db.query(`update episodes set created_at = now() - interval '8 minutes' where id = $1`, [sooner.id]);
    await t.db.query(`update episodes set created_at = now() - interval '2 minutes' where id = $1`, [later.id]);
    const aired = await makeDate({ airedMinutesAgo: 3 });
    const priv = await makeDate({ visibility: "private" });
    const viewer = newUserCookie();
    const own = await makeDate({ host: viewer });

    const soon = await listAiringSoon(t.db, userOf(viewer), 10);
    expect(soon.map((e) => e.id)).toEqual([sooner.id, later.id]);
    expect(soon.map((e) => e.id)).not.toContain(aired.id);
    expect(soon.map((e) => e.id)).not.toContain(priv.id);
    expect(soon.map((e) => e.id)).not.toContain(own.id);
    // When each airs: its booking plus the 10-minute window.
    const minsLeft = (iso: string) => Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
    expect(minsLeft(soon[0].airs_at)).toBe(2);
    expect(minsLeft(soon[1].airs_at)).toBe(8);
    expect(soon.every((e) => !e.revealed && !e.ending)).toBe(true); // nothing spoils on Watch
  });
});

describe("the episode page's written recap sits behind a toggle when the theater exists", () => {
  it("wraps the recap in a closed <details> with a spoiler warning when there's a theater", () => {
    const html = renderToStaticMarkup(createElement(RecapToggle, { hasTheater: true, children: createElement("p", null, "Ending: Friends") }));
    expect(html).toMatch(/^<details class="recap-toggle"><summary>Show the written recap \(it gives away the ending\)<\/summary>/);
    expect(html).not.toMatch(/<details[^>]*\sopen/);
    expect(html.indexOf("Ending: Friends")).toBeGreaterThan(html.indexOf("</summary>"));
    expect(html).toMatch(/Ending: Friends<\/p><\/div><\/details>$/);
    expect(RECAP_TOGGLE_LABEL).toBe("Show the written recap (it gives away the ending)");
  });

  it("keeps the recap open, as before, without a transcript", () => {
    const html = renderToStaticMarkup(createElement(RecapToggle, { hasTheater: false, children: createElement("p", null, "Ending: Friends") }));
    expect(html).toBe("<p>Ending: Friends</p>");
  });

  it("the page puts the recap, the ending, the drama answer, the box score and the why inside the toggle", () => {
    const page = readFileSync(new URL("../app/episodes/[id]/page.tsx", import.meta.url), "utf8");
    const open = page.indexOf("<RecapToggle hasTheater={hasTheater}>");
    const close = page.indexOf("</RecapToggle>");
    expect(open).toBeGreaterThan(0);
    expect(close).toBeGreaterThan(open);
    for (const reveal of ["<h2>The date</h2>", "<h2>The twist</h2>", "<h2>The finale</h2>", "Ending: {endingLabel(episode.ending, dateNo)}", "dramaAnswerLabel(episode.drama_question, episode.drama_answer", "<BoxScore", "why={episode.why}", "your AI landed on"]) {
      const at = page.indexOf(reveal);
      expect(at, reveal).toBeGreaterThan(open);
      expect(at, reveal).toBeLessThan(close);
    }
    // The theater button stays at the top, above the toggle (#516).
    expect(page.indexOf("<EpisodeTheater")).toBeLessThan(open);
    expect(page).toContain("const hasTheater = Boolean(episode.ending && episode.transcript && episode.transcript.length > 0)");
  });
});

describe("the watch room's pre-show countdown", () => {
  it("formats the time left as m:ss (h:mm:ss from an hour)", () => {
    expect(formatCountdown(23)).toBe("0:23");
    expect(formatCountdown(5)).toBe("0:05");
    expect(formatCountdown(65)).toBe("1:05");
    expect(formatCountdown(600)).toBe("10:00");
    expect(formatCountdown(22.2)).toBe("0:23");
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(-4)).toBe("0:00");
    expect(formatCountdown(Number.NaN)).toBe("0:00");
    expect(formatCountdown(7230)).toBe("2:00:30");
  });

  it("reads 'Starts in 0:23', then 'Starting now…', and 'Starting…' before the clock starts", () => {
    expect(preshowCountdownLabel(23)).toBe("Starts in 0:23");
    expect(preshowCountdownLabel(1)).toBe("Starts in 0:01");
    expect(preshowCountdownLabel(0)).toBe("Starting now…");
    expect(preshowCountdownLabel(null)).toBe("Starting…");
  });

  it("the room's clock says how long the pre-show has left, only during the pre-show", () => {
    const T0 = new Date("2026-10-21T12:00:00Z");
    const at = (s: number) => new Date(T0.getTime() + s * 1000);
    expect(WATCH_FIRST_LINE_AT).toBe(30);
    expect(watchClock(T0, at(7)).preshow_left).toBe(23);
    expect(watchClock(T0, at(0)).preshow_left).toBe(30);
    expect(watchClock(T0, at(29)).preshow_left).toBe(1);
    expect(watchClock(T0, at(30)).preshow_left).toBeNull(); // first impressions: the lines are playing
    expect(watchClock(T0, at(200)).preshow_left).toBeNull();
    expect(watchClock(T0, at(-60)).preshow_left).toBe(90); // a premiere set for a minute from now
    expect(watchClock(null, at(0)).preshow_left).toBeNull(); // not started: the first viewer starts it
  });

  it("the room shows the countdown and who's on stage instead of an empty thread during the pre-show", () => {
    const room = readFileSync(new URL("../app/watch/[id]/WatchRoom.tsx", import.meta.url), "utf8");
    expect(room).toContain('empty={preshow ? null : "The conversation appears here, line by line."}');
    expect(room).toContain("{preshow && <Preshow state={state} left={preshowLeft} tone=\"dark\" />}");
    expect(room).toMatch(/On stage: <strong>\{a\.name\}<\/strong> and <strong>\{b\.name\}<\/strong>/);
    expect(room).toContain("useCountdown(state.clock.started && !state.clock.ended ? state.clock.preshow_left : null)");
  });
});
