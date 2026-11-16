import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import TonightBand from "@/app/TonightBand";
import BotchelorCard from "@/app/watch/BotchelorCard";
import { airIfDue } from "@/lib/air";
import { ceremonyBoard, ceremonyRunsAt, runDueCeremony, type Verdict } from "@/lib/ceremony";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { renderLetter } from "@/lib/newsletter-issue";
import { pilotSundayFor, premiereAt, premiereHourUtc, premierePilotOn, premiereTimeWords, sundayPremiereOn, type NextPremiere } from "@/lib/premiere-clock";
import { setLeadOverride } from "@/lib/season-cast";
import { seasonFormat } from "@/lib/season-format";
import { setSeasonFormat, setSeasonFormatForTests } from "@/lib/season-format-store";
import { letterPremiere, nextPremiere, pickInDanger, premiereAdminView, premiereSlots, premiereSuitor, runSundayPremiere } from "@/lib/sunday-premiere";
import { listLobby } from "@/lib/watch";
import { episodeJson, scriptedModel, scriptOutcome, startTestDb } from "./helpers";

// The Botchelor card is a client component (its vote calls the router): rendered here outside an app.
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await t.db.query(`delete from notifications`);
  await t.db.query(`delete from push_subscriptions`);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  setSeasonFormatForTests(null);
  vi.restoreAllMocks();
});

// December 2026 is a full calendar-month season, Dec 1 (a Tuesday) to Jan 1; its ceremony Sundays are 6, 13, 20, 27.
// November 2026 is classic; its last Sunday, the 29th, is the pilot's.
const DEC = (day: number, hour = 12, minute = 0) => new Date(Date.UTC(2026, 11, day, hour, minute));
const NOV = (day: number, hour = 12, minute = 0) => new Date(Date.UTC(2026, 10, day, hour, minute));
const SEASON = "2026-12-01";
const LEAD = HOUSE_CHARACTERS[0].id;
const LEAD_NAME = HOUSE_CHARACTERS[0].name;
const LEAD_FIRST = LEAD_NAME.split(" ")[0];
/** The switches as production has them (on), and dates air the moment their room's decision has passed. */
const ENV = { BOTCHELOR_AIR_WINDOW_MINUTES: "0" };

/** A person's character, public and open to dates. */
async function person(id: string, name: string, owner: string, extra: { createdVia?: string } = {}) {
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility, open_to_dates, created_via)
     values ($1, $2, false, $3, 30, 'A suitor with a story.', '["bold","warm","odd"]'::jsonb, 'love', 'rudeness', 'public', true, $4)`,
    [id, owner, name, extra.createdVia ?? "web"],
  );
}

/** The December house: the lead and `n` suitors (Ansel, Bea, Cato, Dex, Elin), owners owner-1..n. */
async function house(n = 5) {
  await t.db.query(`insert into season_casts (season_id, character_id, slot, source) values ($1, $2, 0, 'lead')`, [SEASON, LEAD]);
  const ids: string[] = [];
  for (let i = 1; i <= n; i++) {
    await person(`suitor-${i}`, ["Ansel", "Bea", "Cato", "Dex", "Elin"][i - 1], `owner-${i}`);
    await t.db.query(`insert into season_casts (season_id, character_id, slot, source) values ($1, $2, $3, 'suitor')`, [SEASON, `suitor-${i}`, i]);
    ids.push(`suitor-${i}`);
  }
  return ids;
}

/** A public date between the lead and a suitor that aired on a December day (the lead's "see again": a second date). */
async function dated(id: string, suitorId: string, day: number, ending: "second_date" | "friends" | "disaster") {
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, seed, status, visibility, revealed_at, transcript, sides, setup)
     values ($1, 'u-show', $2, $3, 'a table', '[]'::jsonb, '[]'::jsonb, 'a twist', 'a finale', $4, 1, 'ready', 'public', $5, '[]'::jsonb, $6::jsonb, '{"venue":"jazz_bar"}'::jsonb)`,
    [id, LEAD, suitorId, ending, DEC(day).toISOString(), JSON.stringify([{ wants_another: ending === "second_date", satisfied: true }, { wants_another: true, satisfied: true }])],
  );
}

const count = async (table: string, where = "true") => (await t.db.query<{ n: number }>(`select count(*)::int as n from ${table} where ${where}`)).rows[0].n;

describe("the clock and the switches (lib/premiere-clock.ts)", () => {
  it("premieres at 23:00 UTC unless PREMIERE_HOUR_UTC names another Sunday hour, and says the time for the US too", () => {
    expect(premiereHourUtc({})).toBe(23);
    expect(premiereHourUtc({ PREMIERE_HOUR_UTC: "21" })).toBe(21);
    // 0 would build it on Saturday's last pass: it has to stay a Sunday hour, so anything outside 1..23 reads as 23.
    for (const bad of ["0", "24", "-1", "7.5", "soon", ""]) expect(premiereHourUtc({ PREMIERE_HOUR_UTC: bad })).toBe(23);
    expect(premiereAt("2026-12-06", {}).toISOString()).toBe("2026-12-06T23:00:00.000Z");
    expect(premiereAt("2026-12-06", { PREMIERE_HOUR_UTC: "21" }).toISOString()).toBe("2026-12-06T21:00:00.000Z");
    expect(premiereTimeWords("2026-11-29T23:00:00.000Z")).toBe("23:00 UTC (6 pm ET, 3 pm PT)");
    expect(premiereTimeWords("2026-11-29T23:00:00.000Z", { day: true })).toBe("Sunday 29 November, 23:00 UTC (6 pm ET, 3 pm PT)");
    expect(premiereTimeWords("2027-07-04T23:00:00.000Z")).toBe("23:00 UTC (7 pm ET, 4 pm PT)"); // US summer time
    expect(premiereTimeWords("2026-12-06T02:00:00.000Z")).toBe("02:00 UTC (Sat 9 pm ET, Sat 6 pm PT)");
    expect(pilotSundayFor("2026-12-01")).toBe("2026-11-29");
    expect(pilotSundayFor(new Date("2027-02-01T00:00:00Z"))).toBe("2027-01-31");
    expect([sundayPremiereOn({}), sundayPremiereOn({ SUNDAY_PREMIERE: "0" }), sundayPremiereOn({ SUNDAY_PREMIERE: "1" })]).toEqual([true, false, true]);
    expect([premierePilotOn({}), premierePilotOn({ PREMIERE_PILOT: "0" }), premierePilotOn({ SUNDAY_PREMIERE: "0" })]).toEqual([true, false, false]);
  });

  it("weekly on every ceremony Sunday of a lead season, the finale last; the pilot the Sunday before it; none without a lead or with the switch off", async () => {
    // November is classic; December picked as The Botchelor, but no lead picked yet: nothing to premiere.
    expect(await premiereSlots(t.db, NOV(16), ENV)).toEqual([]);
    await setSeasonFormat(t.db, SEASON, "botchelor");
    expect(await premiereSlots(t.db, NOV(16), ENV)).toEqual([]);
    await setLeadOverride(t.db, SEASON, LEAD);
    const ahead = await premiereSlots(t.db, NOV(16), ENV);
    expect(ahead.map((s) => [s.sunday, s.kind, s.finale])).toEqual([
      ["2026-11-29", "pilot", false],
      ["2026-12-06", "weekly", false],
      ["2026-12-13", "weekly", false],
      ["2026-12-20", "weekly", false],
      ["2026-12-27", "weekly", true],
    ]);
    expect(ahead.every((s) => s.at.toISOString() === `${s.sunday}T23:00:00.000Z` && s.lead.id === LEAD && s.season_id === SEASON)).toBe(true);
    expect((await premiereSlots(t.db, NOV(16), { ...ENV, PREMIERE_HOUR_UTC: "21" }))[0].at.toISOString()).toBe("2026-11-29T21:00:00.000Z");
    expect((await premiereSlots(t.db, NOV(16), { ...ENV, PREMIERE_PILOT: "0" })).map((s) => s.kind)).not.toContain("pilot");
    expect(await premiereSlots(t.db, NOV(16), { ...ENV, SUNDAY_PREMIERE: "0" })).toEqual([]);
    // In season, from the cast's lead: this month's Sundays (January is classic: no pilot ahead).
    await house(5);
    expect((await premiereSlots(t.db, DEC(2), ENV)).map((s) => s.sunday)).toEqual(["2026-12-06", "2026-12-13", "2026-12-20", "2026-12-27"]);
  });
});

describe("the suitor in most danger", () => {
  it("is the bottom of the lead's verdicts since the last ceremony, a tie going to whoever the lead saw least", async () => {
    const v = (suitor: string, score: number, see_again: number, dates: number): Verdict => ({ suitor, score, see_again, dates, worst: null, best: null });
    expect(pickInDanger([v("a", 3, 1, 1), v("b", 1, 0, 2), v("c", 1, 0, 1)])?.suitor).toBe("c");
    expect(pickInDanger([v("a", 1, 1, 1), v("b", 1, 0, 3)])?.suitor).toBe("b"); // fewer "see again" first
    expect(pickInDanger([v("a", 0, 0, 1), v("b", -1, 0, 0)])?.suitor).toBe("b"); // never dated this week: lowest of all
    expect(pickInDanger([])).toBeNull();

    setSeasonFormatForTests("botchelor");
    await house(4);
    await dated("d1", "suitor-1", 2, "second_date");
    await dated("d2", "suitor-2", 3, "friends");
    await dated("d3", "suitor-2", 4, "disaster"); // Bea: 1 over two dates
    await dated("d4", "suitor-3", 4, "friends"); // Cato: 1 over one date, so the lead saw him least
    await dated("d5", "suitor-4", 5, "second_date");
    const [slot] = await premiereSlots(t.db, DEC(6, 22, 20), ENV);
    expect(slot.sunday).toBe("2026-12-06");
    expect(await premiereSuitor(t.db, slot, DEC(6, 22, 20))).toBe("suitor-3");
    // A person's character closed to dates since it was cast sits it out: no consent is assumed back.
    await t.db.query(`update characters set open_to_dates = false where id = 'suitor-3'`);
    expect(await premiereSuitor(t.db, slot, DEC(6, 22, 20))).toBe("suitor-2");
  });
});

describe("a premiere Sunday (runSundayPremiere, from the hourly lobby job)", () => {
  it("the pass the hour before builds the room once with its start set; the date is held until its decision, aired after, and the ceremony counts it", async () => {
    setSeasonFormatForTests("botchelor");
    await house(5);
    await dated("d1", "suitor-1", 2, "second_date");
    await dated("d2", "suitor-2", 3, "second_date");
    await dated("d3", "suitor-3", 4, "friends");
    await dated("d4", "suitor-4", 4, "friends");
    await dated("d5", "suitor-4", 5, "friends");
    // Elin (suitor-5) never had a date with the lead this week: the most danger.
    expect(await nextPremiere(t.db, DEC(6, 12), ENV)).toMatchObject({
      sunday: "2026-12-06",
      at: "2026-12-06T23:00:00.000Z",
      time_words: "23:00 UTC (6 pm ET, 3 pm PT)",
      kind: "weekly",
      season_id: SEASON,
      lead: { id: LEAD },
      suitor: null,
      room_path: null,
      roses_at: "2026-12-06T23:20:00.000Z",
      finale: false,
      state: "scheduled",
    });
    // Not before the pass the hour before, never on another day.
    expect(await runSundayPremiere(t.db, DEC(6, 21, 20), ENV)).toBeNull();
    expect(await runSundayPremiere(t.db, DEC(5, 22, 20), ENV)).toBeNull();
    expect(await count("premieres")).toBe(0);

    scriptOutcome({ ending: "second_date" });
    scriptedModel([episodeJson()]);
    const run = (await runSundayPremiere(t.db, DEC(6, 22, 20), ENV))!;
    expect(run).toMatchObject({ sunday: "2026-12-06", kind: "weekly", built: true, suitor_id: "suitor-5", aired: false, note: null });
    const rooms = (await t.db.query<{ id: string; kind: string; starts_at: string | Date; episode_id: string }>(`select id, kind, starts_at, episode_id from watch_parties`)).rows;
    expect(rooms).toHaveLength(1);
    const [room] = rooms;
    expect(room.kind).toBe("premiere");
    expect(new Date(room.starts_at).toISOString()).toBe("2026-12-06T23:00:00.000Z");
    expect(run.room_path).toBe(`/watch/${room.id}`);
    // The show's own date, through the template path (the house pays), between the lead and Elin, unaired.
    expect((await t.db.query(`select creator_id, character_a, character_b, revealed_at from episodes where id = $1`, [room.episode_id])).rows[0]).toEqual({
      creator_id: "system",
      character_a: LEAD,
      character_b: "suitor-5",
      revealed_at: null,
    });

    // Once: a later pass builds nothing (the scripted model has no output left to give), and the row counts one try.
    expect(await runSundayPremiere(t.db, DEC(6, 22, 40), ENV)).toMatchObject({ built: true, room_path: run.room_path, notified: 0 });
    expect(await count("watch_parties")).toBe(1);
    expect((await t.db.query(`select tries, built_at is not null as built, note from premieres where held_on = '2026-12-06'`)).rows[0]).toEqual({ tries: 1, built: true, note: null });

    // Listed ahead of time, first even past the lobby's limit, coming up with its start; the next premiere names Elin.
    await t.db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, seed, transcript)
       values ('open-1', 'system', $1, $2, 'a bar', '[]'::jsonb, '[]'::jsonb, 't', 'f', 'friends', 1, '[{"side":"a","act":0,"dialogue":"hi","action":"","emotion":"","interest":0.5}]'::jsonb)`,
      [HOUSE_CHARACTERS[1].id, HOUSE_CHARACTERS[2].id],
    );
    await t.db.query(`insert into watch_parties (id, episode_id, kind) values ('open-room', 'open-1', 'template')`);
    const [first] = await listLobby(t.db, DEC(6, 22, 30), 1);
    expect(first).toMatchObject({ id: room.id, kind: "premiere", status: "upcoming", started: false, phase_label: "Coming up", starts_at: "2026-12-06T23:00:00.000Z" });
    expect(await nextPremiere(t.db, DEC(6, 22, 30), ENV)).toMatchObject({ state: "built", suitor: { id: "suitor-5", name: "Elin" }, room_path: run.room_path, episode_id: room.episode_id });
    expect(await nextPremiere(t.db, DEC(6, 23, 2), ENV)).toMatchObject({ sunday: "2026-12-06", state: "live", room_path: run.room_path });
    // After the room's last phase, the next Sunday's takes its place.
    expect(await nextPremiere(t.db, DEC(6, 23, 10), ENV)).toMatchObject({ sunday: "2026-12-13", state: "scheduled", suitor: null });

    // Held until the room's decision (the database's clock: its start is still ahead), by the pass and by anything else.
    expect(await airIfDue(t.db, room.episode_id, ENV)).toBeNull();
    expect(await runSundayPremiere(t.db, DEC(6, 23, 2), ENV)).toBeNull();
    // Past the decision (its start moved into the database's past, as the clock would): the next pass airs it.
    await t.db.query(`update watch_parties set starts_at = now() - interval '5 minutes' where id = $1`, [room.id]);
    expect(await runSundayPremiere(t.db, DEC(6, 23, 20), ENV)).toMatchObject({ aired: true, built: true, room_path: run.room_path });
    expect((await t.db.query(`select revealed_at is not null as aired from episodes where id = $1`, [room.episode_id])).rows[0]).toEqual({ aired: true });

    // The ceremony on the same pass counts it: Elin's second date saves her, so the lead's verdicts send home the two
    // weakest weeks left (nobody voted). Aired on the simulated Sunday, inside the ceremony's week.
    await t.db.query(`update episodes set revealed_at = $2 where id = $1`, [room.episode_id, DEC(6, 23, 4).toISOString()]);
    const ceremony = await runDueCeremony(t.db, DEC(6, 23, 20));
    expect(ceremony).toMatchObject({ held: true, held_on: "2026-12-06", week: 1 });
    expect([...(ceremony as { went_home: string[] }).went_home].sort()).toEqual(["suitor-3", "suitor-4"]);
    // Without the premiere's date she would have gone home: she never dated the lead otherwise.
    expect((await t.db.query(`select count(*)::int as n from episodes where character_b = 'suitor-5'`)).rows[0].n).toBe(1);
  });

  it("tells the suitor's owner, the followers of the lead or the suitor and the show's news, once each; a mute holds", async () => {
    setSeasonFormatForTests("botchelor");
    await house(5);
    for (const [id, suitor] of [["d1", "suitor-1"], ["d2", "suitor-2"], ["d3", "suitor-3"], ["d4", "suitor-4"]]) await dated(id, suitor, 3, "second_date");
    await t.db.query(
      `insert into character_follows (user_id, character_id) values ('fan-lead', $1), ('fan-both', $1), ('fan-both', 'suitor-5'), ('fan-suitor', 'suitor-5'), ('fan-muted', $1)`,
      [LEAD],
    );
    // Browser notifications on: the show's news. One of them muted the show; the owner and a follower are here too.
    await t.db.query(
      `insert into push_subscriptions (endpoint, user_id, p256dh, auth) values
         ('https://push.example/1', 'news-on', 'k', 'a'), ('https://push.example/2', 'news-muted', 'k', 'a'),
         ('https://push.example/3', 'fan-lead', 'k', 'a'), ('https://push.example/4', 'owner-5', 'k', 'a')`,
    );
    await t.db.query(`insert into notification_mutes (user_id, type) values ('fan-muted', 'show'), ('news-muted', 'show')`);
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const run = (await runSundayPremiere(t.db, DEC(6, 22, 20), ENV))!;
    expect(run).toMatchObject({ built: true, suitor_id: "suitor-5", notified: 6 });
    const rows = (
      await t.db.query<{ user_id: string; title: string; body: string; link: string; read: boolean }>(
        `select user_id, title, body, link, read_at is not null as read from notifications where kind = 'premiere' order by user_id`,
      )
    ).rows;
    expect(rows.map((r) => r.user_id)).toEqual(["fan-both", "fan-lead", "fan-muted", "fan-suitor", "news-on", "owner-5"]);
    expect(rows.every((r) => r.link === run.room_path)).toBe(true);
    const owner = rows.find((r) => r.user_id === "owner-5")!;
    expect(owner.title).toBe(`📺 Elin has Sunday's premiere date with ${LEAD_FIRST}`);
    expect(owner.body).toContain("premieres at 23:00 UTC (6 pm ET, 3 pm PT), live in one room on Watch");
    expect(owner.body).toContain("The roses follow at 23:20 UTC.");
    expect(rows.find((r) => r.user_id === "news-on")!.title).toBe(`📺 Tonight's premiere: ${LEAD_FIRST} × Elin`);
    // A mute holds: in the inbox already read (no bell, no push); a muted show's news isn't sent at all.
    expect(rows.filter((r) => r.read).map((r) => r.user_id)).toEqual(["fan-muted"]);
    // Once: the next pass sends nothing.
    expect(await runSundayPremiere(t.db, DEC(6, 22, 40), ENV)).toMatchObject({ notified: 0 });
    expect(await count("notifications", "kind = 'premiere'")).toBe(6);
  });

  it("the week with two suitors left promises no roses after it: there is no ceremony until the finale", async () => {
    setSeasonFormatForTests("botchelor");
    await house(2);
    expect(await nextPremiere(t.db, DEC(13, 12), ENV)).toMatchObject({ sunday: "2026-12-13", roses_at: null, finale: false });
    expect(await nextPremiere(t.db, DEC(27, 12), ENV)).toMatchObject({ sunday: "2026-12-27", roses_at: "2026-12-27T23:20:00.000Z", finale: true });
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    await runSundayPremiere(t.db, DEC(13, 22, 20), ENV);
    const body = (await t.db.query<{ body: string }>(`select body from notifications where kind = 'premiere' limit 1`)).rows[0].body;
    expect(body).not.toContain("roses");
  });
});

describe("the pilot", () => {
  it("the Sunday before a lead season: the coming lead's first date with the top of the casting shortlist, in the same kind of room, with no roses", async () => {
    await setSeasonFormat(t.db, SEASON, "botchelor");
    await setLeadOverride(t.db, SEASON, LEAD);
    await person("fan-a", "Fen Okafor", "owner-a");
    await person("fan-b", "Gil Marsh", "owner-b");
    await t.db.query(
      `insert into cast_auditions (season_id, character_id, owner_id, status, decided_at) values ($1, 'fan-a', 'owner-a', 'approved', now()), ($1, 'fan-b', 'owner-b', 'approved', now())`,
      [SEASON],
    );
    await t.db.query(`insert into audition_votes (season_id, voter_id, character_id) values ($1, 'v1', 'fan-b'), ($1, 'v2', 'fan-b'), ($1, 'v3', 'fan-a')`, [SEASON]);
    expect(await nextPremiere(t.db, NOV(16), ENV)).toMatchObject({
      sunday: "2026-11-29",
      at: "2026-11-29T23:00:00.000Z",
      time_words: "23:00 UTC (6 pm ET, 3 pm PT)",
      kind: "pilot",
      season_id: SEASON,
      lead: { id: LEAD, name: LEAD_NAME },
      suitor: null,
      room_path: null,
      roses_at: null,
      state: "scheduled",
    });
    expect(await runSundayPremiere(t.db, NOV(22, 22, 20), ENV)).toBeNull(); // the Sunday before: nothing

    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const run = (await runSundayPremiere(t.db, NOV(29, 22, 20), ENV))!;
    expect(run).toMatchObject({ sunday: "2026-11-29", kind: "pilot", built: true, suitor_id: "fan-b", note: null });
    const room = (await t.db.query<{ kind: string; starts_at: string | Date }>(`select kind, starts_at from watch_parties`)).rows[0];
    expect([room.kind, new Date(room.starts_at).toISOString()]).toEqual(["premiere", "2026-11-29T23:00:00.000Z"]);
    const notice = (await t.db.query<{ title: string; body: string }>(`select title, body from notifications where user_id = 'owner-b' and kind = 'premiere'`)).rows[0];
    expect(notice.title).toBe(`📺 Gil has the pilot: a first date with ${LEAD_FIRST}`);
    expect(notice.body).toContain("No roses tonight: the season starts on 1 December.");
    expect(await nextPremiere(t.db, NOV(29, 22, 30), ENV)).toMatchObject({ kind: "pilot", state: "built", suitor: { id: "fan-b", name: "Gil Marsh" } });
    // No ceremony: November is classic.
    expect(await runDueCeremony(t.db, NOV(29, 23, 20))).toBeNull();
    expect(await count("ceremonies")).toBe(0);
    // The admin's line.
    expect(await premiereAdminView(t.db, NOV(29, 22, 30), ENV)).toMatchObject({
      switched_on: true,
      pilot_on: true,
      hour: 23,
      next: { kind: "pilot", state: "built", suitor: { id: "fan-b" } },
      would_pick: null,
      last: { sunday: "2026-11-29", kind: "pilot", built: true, suitor: "Gil Marsh", note: null, tries: 1 },
    });
  });

  it("with an empty shortlist the house's first suitor dates the lead; with nobody at all nothing is built, and the row says why", async () => {
    await setSeasonFormat(t.db, SEASON, "botchelor");
    await setLeadOverride(t.db, SEASON, LEAD);
    expect(await premiereAdminView(t.db, NOV(29, 12), ENV)).toMatchObject({ next: { kind: "pilot", state: "scheduled" }, would_pick: null, last: null });
    expect(await runSundayPremiere(t.db, NOV(29, 22, 20), ENV)).toMatchObject({ kind: "pilot", built: false, note: "no_suitor" });
    expect(await count("watch_parties")).toBe(0);
    expect(await count("notifications", "kind = 'premiere'")).toBe(0);
    expect(await premiereAdminView(t.db, NOV(29, 22, 25), ENV)).toMatchObject({ last: { sunday: "2026-11-29", built: false, note: "no_suitor" } });
    // A Sunday that failed isn't promised: the next premiere is December's first.
    expect(await nextPremiere(t.db, NOV(29, 22, 25), ENV)).toMatchObject({ sunday: "2026-12-06", kind: "weekly", state: "scheduled" });
    // One of the house's own agent-made characters (ours, lib/our-traffic.ts) fills an empty shortlist, as it fills the cast.
    await person("ours-1", "Mira Quell", "agent-ours", { createdVia: "mcp" });
    const pilot = (await premiereSlots(t.db, NOV(29, 12), ENV)).find((s) => s.kind === "pilot")!;
    expect(await premiereSuitor(t.db, pilot, NOV(29, 12))).toBe("ours-1");
    // Before the pass, the admin's line says who it would be.
    await t.db.query(`delete from premieres`);
    expect((await premiereAdminView(t.db, NOV(28, 12), ENV)).would_pick).toEqual({ id: "ours-1", name: "Mira Quell" });
  });
});

describe("off", () => {
  it("a classic month holds nothing: no premiere, no row, no room, no notice", async () => {
    expect(await nextPremiere(t.db, NOV(16), ENV)).toBeNull();
    expect(await runSundayPremiere(t.db, NOV(22, 22, 20), ENV)).toBeNull();
    expect(await runSundayPremiere(t.db, NOV(29, 22, 20), ENV)).toBeNull(); // December not picked: no pilot either
    expect(await premiereAdminView(t.db, NOV(29, 12), ENV)).toMatchObject({ switched_on: true, next: null, last: null });
    expect([await count("premieres"), await count("watch_parties"), await count("notifications")]).toEqual([0, 0, 0]);
  });

  it("SUNDAY_PREMIERE=0 turns all of it off and leaves the ceremony at its old hour", async () => {
    setSeasonFormatForTests("botchelor");
    await house(5);
    const OFF = { ...ENV, SUNDAY_PREMIERE: "0" };
    expect(await premiereSlots(t.db, DEC(6, 12), OFF)).toEqual([]);
    expect(await nextPremiere(t.db, DEC(6, 12), OFF)).toBeNull();
    expect(await runSundayPremiere(t.db, DEC(6, 22, 20), OFF)).toBeNull();
    expect(await premiereAdminView(t.db, DEC(6, 12), OFF)).toEqual({ switched_on: false, pilot_on: false, hour: 23, next: null, would_pick: null, last: null });
    expect(ceremonyRunsAt("2026-12-06", OFF).toISOString()).toBe("2026-12-06T20:20:00.000Z");
    expect(ceremonyRunsAt("2026-12-06", ENV).toISOString()).toBe("2026-12-06T23:20:00.000Z");
    expect(await count("premieres")).toBe(0);
  });
});

describe("where it shows", () => {
  const face = { id: LEAD, name: LEAD_NAME, hue: null, portrait: null, house: true };
  const premiere = (over: Partial<NextPremiere> = {}): NextPremiere => ({
    sunday: "2026-11-29",
    at: "2026-11-29T23:00:00.000Z",
    time_words: "23:00 UTC (6 pm ET, 3 pm PT)",
    kind: "pilot",
    season_id: SEASON,
    lead: face,
    suitor: null,
    room_path: null,
    episode_id: null,
    roses_at: null,
    finale: false,
    state: "scheduled",
    ...over,
  });
  const band = (props: Partial<Parameters<typeof TonightBand>[0]>) =>
    renderToStaticMarkup(createElement(TonightBand, { rooms: [], airing: [], situation: null, latest: null, now: Date.parse("2026-11-29T15:00:00Z"), ...props }));

  it("home's tonight band has a slot on the day until the room opens, and nothing on any other day", () => {
    const html = band({ premiere: premiere() });
    expect(html).toContain("Tonight&#x27;s pilot");
    expect(html).toContain(`Meet ${LEAD_NAME}`);
    expect(html).toContain("Starts in 8h 0m · 23:00 UTC (6 pm ET, 3 pm PT)");
    expect(html).toContain('href="/watch#on-now"');
    expect(band({ premiere: premiere(), now: Date.parse("2026-11-28T15:00:00Z") })).toBe("");
    const weekly = band({ premiere: premiere({ kind: "weekly", sunday: "2026-12-06", at: "2026-12-06T23:00:00.000Z" }), now: Date.parse("2026-12-06T21:00:00Z") });
    expect(weekly).toContain("Tonight&#x27;s premiere");
    expect(weekly).toContain(`${LEAD_NAME}&#x27;s last-chance date`);
    expect(weekly).toContain('href="/watch#rose-ceremony"');
    // Once built it is the room's own slot (an upcoming room in the lobby), not this one.
    expect(band({ premiere: premiere({ state: "built", room_path: "/watch/r1" }) })).toBe("");
  });

  it("the Botchelor card's line: when, whose last-chance date, then the roses; the room once it's built", async () => {
    setSeasonFormatForTests("botchelor");
    await house(5);
    const board = (await ceremonyBoard(t.db, null, DEC(2)))!;
    const card = (p: NextPremiere) => renderToStaticMarkup(createElement(BotchelorCard, { board, now: DEC(2).getTime(), premiere: p }));
    const weekly = premiere({ kind: "weekly", sunday: "2026-12-06", at: "2026-12-06T23:00:00.000Z", roses_at: "2026-12-06T23:20:00.000Z" });
    const before = card(weekly);
    expect(before).toContain("Sunday&#x27;s premiere");
    expect(before).toContain("23:00 UTC (6 pm ET, 3 pm PT), in 4 days");
    expect(before).toContain("last-chance date, with the suitor in most danger, live in one room for everyone, then the roses.");
    expect(before).toContain("Its room opens on Watch about 40 minutes before.");
    const built = card({ ...weekly, state: "built", suitor: { id: "suitor-5", name: "Elin", hue: null, portrait: null, house: false }, room_path: "/watch/r1" });
    expect(built).toContain('href="/characters/suitor-5"');
    expect(built).toContain('href="/watch/r1"');
    // A pilot never shows on the card (a lead season's card is about its own Sundays), nor does it without a premiere.
    expect(card(premiere())).not.toContain("premiere");
    expect(renderToStaticMarkup(createElement(BotchelorCard, { board, now: DEC(2).getTime() }))).not.toContain("data-premiere");
  });

  it("the Sunday letter says when next Sunday's premiere is, and whose", async () => {
    await setSeasonFormat(t.db, SEASON, "botchelor");
    await setLeadOverride(t.db, SEASON, LEAD);
    expect(await letterPremiere(t.db, "2026-11-15", NOV(15, 21), ENV)).toBeNull();
    const p = (await letterPremiere(t.db, "2026-11-22", NOV(22, 21), ENV))!;
    expect(p).toMatchObject({ sunday: "2026-11-29", kind: "pilot", lead: LEAD_NAME, month: "December", format_title: seasonFormat("botchelor").title });
    const letter = renderLetter({ week_id: "2026-11-22", reveal: null, dates: [], callers: null, premiere: p }, "https://botchelor.com");
    expect(letter.text).toContain(
      `Next Sunday 29 November: the pilot. Meet ${LEAD_NAME}, December's lead on ${seasonFormat("botchelor").title}, on a first date live in one room on Watch at 23:00 UTC (6 pm ET, 3 pm PT).`,
    );
    expect(renderLetter({ week_id: "2026-11-22", reveal: null, dates: [], callers: null }, "https://botchelor.com").text).not.toContain("pilot");
  });
});
