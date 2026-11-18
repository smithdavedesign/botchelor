import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as ceremonyGet, POST as ceremonyPost } from "@/app/api/ceremony/route";
import {
  ceremonyBoard,
  ceremonyRunsAt,
  ceremonySummary,
  ceremonyVoteOpensAt,
  ensureCeremonyVote,
  finalRoseAward,
  leadVerdicts,
  runCeremony,
  runDueCeremony,
  SENT_HOME_LINES,
  suitorBadgesOf,
  voteCeremony,
} from "@/lib/ceremony";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { characterPortrait } from "@/lib/portraits";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { ceremonySundays, nextCeremonySunday, recouplingNightDays, seasonFormat } from "@/lib/season-format";
import { setSeasonFormatForTests } from "@/lib/season-format-store";
import { computeRecapData } from "@/lib/season-recap";
import { situationPair, utcDay } from "@/lib/situations";
import { jsonRequest, startTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  setSeasonCastForTests(null);
  setSeasonFormatForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const BOTCHELOR = seasonFormat("botchelor");
const CLASSIC = seasonFormat("classic");
// December 2026 is a full calendar-month season: Dec 1 (a Tuesday) 00:00 UTC to Jan 1. Its Sundays: 6, 13, 20, 27.
const DEC = (day: number, hour = 12) => new Date(Date.UTC(2026, 11, day, hour));
const SEASON = "2026-12-01";
const LEAD = HOUSE_CHARACTERS[0].id;

/** A person's character (owner `owner`), public and open, as a suitor on the December cast. */
async function suitor(id: string, name: string, owner: string, slot: number) {
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility, open_to_dates, created_via)
     values ($1, $2, false, $3, 30, 'A suitor with a story.', '["bold","warm","odd"]'::jsonb, 'love', 'rudeness', 'public', true, 'web')`,
    [id, owner, name],
  );
  await t.db.query(`insert into season_casts (season_id, character_id, slot, source) values ($1, $2, $3, 'suitor')`, [SEASON, id, slot]);
}

/** The December house: the lead and five suitors, as the cast picks them on the 1st. */
async function house(n = 5) {
  await t.db.query(`insert into season_casts (season_id, character_id, slot, source) values ($1, $2, 0, 'lead')`, [SEASON, LEAD]);
  const ids: string[] = [];
  for (let i = 1; i <= n; i++) {
    await suitor(`suitor-${i}`, ["Ansel", "Bea", "Cato", "Dex", "Elin", "Fox"][i - 1], `owner-${i}`, i);
    ids.push(`suitor-${i}`);
  }
  return ids;
}

/** A public date between the lead and a suitor, aired on a December day, with the lead's own "see again" answer. */
async function dated(id: string, suitorId: string, day: number, ending: "second_date" | "friends" | "disaster", leadWantsAnother = ending === "second_date", venue = "jazz_bar") {
  // The lead sits as side A; sides[0] is the lead's.
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, seed, status, visibility, revealed_at, transcript, sides, setup)
     values ($1, 'u-show', $2, $3, 'a table', '[]'::jsonb, '[]'::jsonb, 'a twist', 'a finale', $4, 1, 'ready', 'public', $5, '[]'::jsonb, $6::jsonb, $7::jsonb)`,
    [id, LEAD, suitorId, ending, DEC(day).toISOString(), JSON.stringify([{ wants_another: leadWantsAnother, satisfied: true }, { wants_another: true, satisfied: true }]), JSON.stringify({ venue })],
  );
}

describe("the format (lib/season-format.ts 'botchelor')", () => {
  it("is a lead format with six places, four suitors at least, a ceremony every Sunday and no recoupling night", () => {
    expect(BOTCHELOR.lead).toEqual({ places: 6, suitorsMin: 4, ceremony: "weekly", auditionVerb: "Apply to be a suitor", auditionNoun: "suitor" });
    expect(BOTCHELOR.title).toBe("The Botchelor");
    expect(recouplingNightDays(BOTCHELOR, DEC(10))).toEqual([]);
    expect(ceremonySundays(BOTCHELOR, DEC(10))).toEqual(["2026-12-06", "2026-12-13", "2026-12-20", "2026-12-27"]);
    expect(nextCeremonySunday(BOTCHELOR, DEC(6, 23))).toBe("2026-12-06"); // Sunday counts until the day ends
    expect(nextCeremonySunday(BOTCHELOR, DEC(28))).toBeNull();
    // A season starting on a Sunday (November 2026) skips that first Sunday: nobody has dated yet.
    expect(ceremonySundays(BOTCHELOR, new Date(Date.UTC(2026, 10, 3)))[0]).toBe("2026-11-08");
  });

  it("every other format has no lead and no ceremony, exactly as before", () => {
    expect(CLASSIC.lead).toBeUndefined();
    expect(ceremonySundays(CLASSIC, DEC(10))).toEqual([]);
    expect(recouplingNightDays(CLASSIC, DEC(10))).toEqual(["2026-12-31"]);
  });

  it("holds the ceremony on the job's :20 pass at the Sunday premiere's hour (23; CEREMONY_HOUR_UTC can only move it later), or at CEREMONY_HOUR_UTC (20 by default) with SUNDAY_PREMIERE=0; the vote opens on Thursday", () => {
    expect(ceremonyRunsAt("2026-12-06").toISOString()).toBe("2026-12-06T23:20:00.000Z");
    expect(ceremonyRunsAt("2026-12-06", { CEREMONY_HOUR_UTC: "18" }).toISOString()).toBe("2026-12-06T23:20:00.000Z");
    expect(ceremonyRunsAt("2026-12-06", { PREMIERE_HOUR_UTC: "21" }).toISOString()).toBe("2026-12-06T21:20:00.000Z");
    expect(ceremonyRunsAt("2026-12-06", { PREMIERE_HOUR_UTC: "21", CEREMONY_HOUR_UTC: "22" }).toISOString()).toBe("2026-12-06T22:20:00.000Z");
    expect(ceremonyRunsAt("2026-12-06", { SUNDAY_PREMIERE: "0" }).toISOString()).toBe("2026-12-06T20:20:00.000Z");
    expect(ceremonyRunsAt("2026-12-06", { SUNDAY_PREMIERE: "0", CEREMONY_HOUR_UTC: "18" }).toISOString()).toBe("2026-12-06T18:20:00.000Z");
    expect(ceremonyVoteOpensAt("2026-12-06").toISOString()).toBe("2026-12-03T00:00:00.000Z");
  });
});

describe("the week's dates (lib/season-cast.ts suitorInTurn, lib/situations.ts)", () => {
  it("deals the lead with the suitors in turn, one a day, so every suitor dates the lead before Sunday", () => {
    const suitors = ["s-a", "s-b", "s-c", "s-d", "s-e"];
    setSeasonCastForTests([LEAD], suitors, LEAD);
    const pairs = [1, 2, 3, 4, 5, 6].map((d) => situationPair(utcDay(DEC(d)), BOTCHELOR));
    expect(pairs.map((p) => p![0])).toEqual(Array(6).fill(LEAD));
    expect(pairs.slice(0, 5).map((p) => p![1])).toEqual(suitors);
    expect(pairs[5]![1]).toBe("s-a"); // round again
  });

  it("a classic season's pair is dealt from the day as before, with or without the format passed", () => {
    setSeasonCastForTests(HOUSE_CHARACTERS.slice(0, 4).map((c) => c.id));
    const day = utcDay(DEC(3));
    expect(situationPair(day, CLASSIC)).toEqual(situationPair(day));
    expect(situationPair(day)![0]).not.toBe(situationPair(day)![1]);
  });
});

describe("the vote (lib/ceremony.ts)", () => {
  it("opens on Thursday with the suitors still in frozen as the ballot, takes one changeable vote a viewer, and refuses an off-ballot pick", async () => {
    setSeasonFormatForTests("botchelor");
    const suitors = await house(5);
    expect(await ensureCeremonyVote(t.db, BOTCHELOR, DEC(2, 23))).toBeNull(); // Wednesday: not yet
    const row = (await ensureCeremonyVote(t.db, BOTCHELOR, DEC(3, 1)))!;
    expect(row).toMatchObject({ held_on: "2026-12-06", week: 1, finale: false, lead_id: LEAD });
    expect(row.choices.map((c) => c.id)).toEqual(suitors);
    expect(await voteCeremony(t.db, "fan-1", "suitor-1", DEC(4))).toEqual({ ok: true, pick: "suitor-1" });
    expect(await voteCeremony(t.db, "fan-1", "suitor-2", DEC(4))).toEqual({ ok: true, pick: "suitor-2" });
    expect(await voteCeremony(t.db, "fan-1", "nobody", DEC(4))).toMatchObject({ ok: false, status: 400, error: "not_on_the_ballot" });
    expect((await t.db.query(`select count(*)::int as n from ceremony_votes`)).rows[0]).toEqual({ n: 1 });
    const board = (await ceremonyBoard(t.db, "fan-1", DEC(4)))!;
    expect(board.vote).toMatchObject({ held_on: "2026-12-06", my_pick: "suitor-2", total: 1 });
    expect(board.vote!.choices.find((c) => c.id === "suitor-2")!.votes).toBe(1);
    expect(board.next).toMatchObject({ held_on: "2026-12-06", runs_at: "2026-12-06T23:20:00.000Z", week: 1, finale: false });
    expect(board.suitors.every((s) => s.state === "in")).toBe(true);
    expect(board.lead.id).toBe(LEAD);
    // The lead's rose shot (lib/show-shots.ts) rides along once it's drawn: the card shows them holding it out.
    expect(board.lead.rose).toBeNull();
    await t.db.query(`insert into show_shots (id, character_id, portrait_key, style, shot, status, model) values ('rose-1', $1, $2, 'realistic', 'rose', 'ready', 'm')`, [
      LEAD,
      `static:${characterPortrait(LEAD)}`,
    ]);
    expect((await ceremonyBoard(t.db, "fan-1", DEC(4)))!.lead.rose).toBe("/api/shots/rose-1.webp");
  });

  it("404s with no vote open, and votes over the API with the visitor's cookie", async () => {
    setSeasonFormatForTests("botchelor");
    await house(5);
    expect(await voteCeremony(t.db, "fan-1", "suitor-1", DEC(2))).toMatchObject({ ok: false, status: 404, error: "no_vote_open" });
    await ensureCeremonyVote(t.db, BOTCHELOR, DEC(3, 1));
    vi.useFakeTimers();
    vi.setSystemTime(DEC(4));
    try {
      const voted = await ceremonyPost(jsonRequest("/api/ceremony", { pick: "suitor-3" }));
      expect(voted.status).toBe(201);
      const cookie = voted.headers.get("set-cookie") ?? "";
      const res = await ceremonyGet(new Request("http://localhost:3000/api/ceremony", { headers: { cookie: cookie.split(";")[0] } }));
      expect(res.status).toBe(200);
      const board = await res.json();
      expect(board.vote.my_pick).toBe("suitor-3");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the lead's verdicts (lib/ceremony.ts leadVerdicts)", () => {
  it("ranks a second date over friends over a disaster, ties by the lead's own see-again answer, and a suitor never dated last", async () => {
    const suitors = await house(5);
    await dated("d1", "suitor-1", 2, "second_date");
    await dated("d2", "suitor-2", 3, "friends", true);
    await dated("d3", "suitor-3", 3, "friends", false);
    await dated("d4", "suitor-4", 4, "disaster");
    // suitor-5 never dated the lead this week.
    const v = await leadVerdicts(t.db, LEAD, suitors, DEC(1, 0), DEC(6, 20));
    expect(v.map((x) => x.suitor)).toEqual(["suitor-5", "suitor-4", "suitor-3", "suitor-2", "suitor-1"]);
    expect(v[0].score).toBe(-1);
    expect(v[4]).toMatchObject({ score: 3, see_again: 1, dates: 1 });
  });
});

describe("the ceremony (lib/ceremony.ts runCeremony)", () => {
  it("sends the audience's pick and the lead's worst home, once: cast, badges, owners' notices and the characters' own texts", async () => {
    setSeasonFormatForTests("botchelor");
    await house(5);
    await dated("d1", "suitor-1", 2, "second_date");
    await dated("d2", "suitor-2", 3, "friends");
    await dated("d3", "suitor-3", 3, "friends");
    await dated("d4", "suitor-4", 4, "disaster", false, "cooking_class");
    await dated("d5", "suitor-5", 5, "friends");
    await ensureCeremonyVote(t.db, BOTCHELOR, DEC(3, 1));
    await voteCeremony(t.db, "fan-1", "suitor-2", DEC(4));
    await voteCeremony(t.db, "fan-2", "suitor-2", DEC(4));
    await voteCeremony(t.db, "fan-3", "suitor-1", DEC(5));
    // suitor-4's owner opted in to hear from their character (companion_threads.muted_proactive = false).
    await t.db.query(`insert into companion_threads (id, user_id, character_id, muted_proactive) values ('th-4', 'owner-4', 'suitor-4', false)`);
    // suitor-2's owner has a thread but never tapped "Hear from": no text for them.
    await t.db.query(`insert into companion_threads (id, user_id, character_id) values ('th-2', 'owner-2', 'suitor-2')`);

    expect(await runDueCeremony(t.db, DEC(5, 21))).toBeNull(); // Saturday
    expect(await runDueCeremony(t.db, DEC(6, 22))).toBeNull(); // Sunday, before the hour (the premiere's, 23)
    const run = await runDueCeremony(t.db, DEC(6, 23));
    expect(run).toMatchObject({ held: true, held_on: "2026-12-06", week: 1, finale: false, went_home: ["suitor-2", "suitor-4"], final_rose: null });

    const row = (await t.db.query<{ eliminated_by_vote: string; eliminated_by_lead: string; votes: number; total: number; remaining: string[]; lines: string[] }>(`select * from ceremonies`)).rows[0];
    expect(row).toMatchObject({ eliminated_by_vote: "suitor-2", eliminated_by_lead: "suitor-4", votes: 2, total: 3, remaining: ["suitor-1", "suitor-3", "suitor-5"] });
    // Three votes is a quiet room (lib/crowd-threshold.ts): the stored line, read by everyone, carries no count; the row does.
    expect(row.lines.join(" ")).toContain("The audience spoke first and sent Bea home.");
    expect(row.lines.join(" ")).not.toContain("2 of 3");
    expect(row.lines.join(" ")).toContain("Dex's date at a cooking class was a disaster");

    // Off the cast at once, like a withdrawal; the rest stay.
    const off = (await t.db.query<{ character_id: string }>(`select character_id from season_casts where season_id = $1 and withdrawn_at is not null order by character_id`, [SEASON])).rows;
    expect(off.map((r) => r.character_id)).toEqual(["suitor-2", "suitor-4"]);
    expect(await suitorBadgesOf(t.db, "suitor-4")).toEqual([{ season_id: SEASON, badge: "suitor", label: "Season 3 suitor" }]);
    expect(await suitorBadgesOf(t.db, "suitor-1")).toEqual([]);

    // Each owner hears once; the opted-in character texts, the other doesn't.
    const notices = (await t.db.query<{ user_id: string; kind: string; title: string }>(`select user_id, kind, title from notifications where kind = 'ceremony_held' order by user_id`)).rows;
    expect(notices.map((n) => n.user_id)).toEqual(["fan-1", "fan-2", "fan-3", "owner-2", "owner-4"]);
    expect(notices.find((n) => n.user_id === "owner-4")!.title).toContain("Dex went home");
    expect(notices.find((n) => n.user_id === "fan-1")!.title).toContain("Bea and Dex went home");
    const texts = (await t.db.query<{ thread_id: string; text: string }>(`select thread_id, text from companion_messages where role = 'character' and action like 'ceremony:%' order by created_at`)).rows;
    expect(texts.map((x) => x.thread_id)).toEqual(["th-4", "th-4"]);
    expect(texts[0].text).toBe(SENT_HOME_LINES[0]);

    // Once: the next pass finds it held, and nothing is written twice.
    expect(await runDueCeremony(t.db, new Date(Date.UTC(2026, 11, 6, 23, 40)))).toMatchObject({ held: false, reason: "already" });
    expect(await runDueCeremony(t.db, DEC(7, 0))).toBeNull(); // Monday's catch-up finds it held
    expect((await t.db.query(`select count(*)::int as n from suitor_badges`)).rows[0]).toEqual({ n: 2 });
    expect((await t.db.query(`select count(*)::int as n from notifications where kind = 'ceremony_held'`)).rows[0]).toEqual({ n: 5 });

    // The card tells it.
    const board = (await ceremonyBoard(t.db, null, DEC(7)))!;
    expect(board.suitors.map((s) => [s.id, s.state])).toEqual([
      ["suitor-1", "in"],
      ["suitor-2", "out"],
      ["suitor-3", "in"],
      ["suitor-4", "out"],
      ["suitor-5", "in"],
    ]);
    expect(board.last).toMatchObject({ held_on: "2026-12-06", week: 1, votes: 2, total: 3 });
    expect(board.last!.went_home.map((f) => f.id)).toEqual(["suitor-2", "suitor-4"]);
    expect(board.next).toMatchObject({ held_on: "2026-12-13", week: 2 });
    expect(board.vote).toBeNull();
  });

  it("nobody voted: the lead's dates decide both, and the words say so", async () => {
    setSeasonFormatForTests("botchelor");
    await house(4);
    await dated("d1", "suitor-1", 2, "second_date");
    await dated("d2", "suitor-2", 3, "friends");
    await dated("d3", "suitor-3", 3, "disaster");
    const run = await runCeremony(t.db, BOTCHELOR, "2026-12-06", DEC(6, 20));
    // suitor-4 never got a date (the lead's worst), then the disaster.
    expect(run).toMatchObject({ held: true, went_home: ["suitor-3", "suitor-4"] });
    const row = (await t.db.query<{ eliminated_by_vote: string; eliminated_by_lead: string; total: number; lines: string[] }>(`select * from ceremonies`)).rows[0];
    expect(row).toMatchObject({ eliminated_by_lead: "suitor-4", eliminated_by_vote: "suitor-3", total: 0 });
    expect(row.lines.join(" ")).toContain("Nobody voted this week");
    expect(row.lines.join(" ")).toContain("never got a date with the lead");
  });

  it("with three left only one goes, by the audience; with two left the week waits for the finale", async () => {
    setSeasonFormatForTests("botchelor");
    await house(3);
    await dated("d1", "suitor-1", 2, "disaster");
    await ensureCeremonyVote(t.db, BOTCHELOR, DEC(3, 1));
    await voteCeremony(t.db, "fan-1", "suitor-2", DEC(4));
    const run = await runCeremony(t.db, BOTCHELOR, "2026-12-06", DEC(6, 20));
    expect(run).toMatchObject({ held: true, went_home: ["suitor-2"] });
    const row = (await t.db.query<{ eliminated_by_vote: string; eliminated_by_lead: string | null; remaining: string[] }>(`select * from ceremonies where held_on = '2026-12-06'`)).rows[0];
    expect(row).toMatchObject({ eliminated_by_vote: "suitor-2", eliminated_by_lead: null, remaining: ["suitor-1", "suitor-3"] });
    // Two remain: no vote opens and no ceremony is held until the last Sunday.
    expect(await ensureCeremonyVote(t.db, BOTCHELOR, DEC(10, 1))).toBeNull();
    expect(await runCeremony(t.db, BOTCHELOR, "2026-12-13", DEC(13, 20))).toEqual({ held: false, reason: "waiting_for_finale" });
    const board = (await ceremonyBoard(t.db, null, DEC(14)))!;
    expect(board.next).toMatchObject({ held_on: "2026-12-20", finale: false });
  });

  it("the finale hands the final rose to the better season record; the recap bills it, the runner-up keeps a badge", async () => {
    setSeasonFormatForTests("botchelor");
    await house(2);
    await dated("d1", "suitor-1", 2, "friends");
    await dated("d2", "suitor-1", 12, "friends");
    await dated("d3", "suitor-2", 3, "second_date");
    await dated("d4", "suitor-2", 20, "disaster");
    // No vote opens for the finale.
    expect(await ensureCeremonyVote(t.db, BOTCHELOR, DEC(24, 1))).toBeNull();
    const run = await runCeremony(t.db, BOTCHELOR, "2026-12-27", DEC(27, 20));
    // suitor-2: 3 + 0 = 3 beats suitor-1's 1 + 1 = 2.
    expect(run).toMatchObject({ held: true, finale: true, went_home: [], final_rose: "suitor-2" });
    expect(await suitorBadgesOf(t.db, "suitor-2")).toEqual([{ season_id: SEASON, badge: "final_rose", label: "Season 3 final rose" }]);
    expect(await suitorBadgesOf(t.db, "suitor-1")).toEqual([{ season_id: SEASON, badge: "runner_up", label: "Season 3 runner-up" }]);
    // Nobody leaves the cast at the finale.
    expect((await t.db.query(`select count(*)::int as n from season_casts where withdrawn_at is not null`)).rows[0]).toEqual({ n: 0 });
    const award = (await finalRoseAward(t.db, SEASON))!;
    expect(award).toMatchObject({ title: "The final rose", name: "Bea" });
    expect(award.chars.map((c) => c.id)).toEqual([LEAD, "suitor-2"]);
    const recap = await computeRecapData(t.db, SEASON);
    expect(recap.awards[0]).toMatchObject({ title: "The final rose", name: "Bea" });
    const notices = (await t.db.query<{ user_id: string; title: string }>(`select user_id, title from notifications where kind = 'ceremony_held' and (title like '%final two%' or title like '%final rose%') order by user_id`)).rows;
    expect(notices.map((n) => n.user_id)).toEqual(["owner-1", "owner-2"]);
    expect(notices[0].title).toMatch(/^🥀 Ansel was .*'s final two$/);
    expect(notices[1].title).toBe("🌹 Bea got the final rose");

    const summary = await ceremonySummary(t.db, SEASON);
    expect(summary.lead!.id).toBe(LEAD);
    expect(summary.ceremonies).toHaveLength(1);
    expect(summary.ceremonies[0]).toMatchObject({ finale: true, final_rose: { id: "suitor-2", name: "Bea" }, remaining: [{ id: "suitor-2", name: "Bea" }] });
    expect(summary.badges.map((b) => [b.character_id, b.badge])).toEqual([
      ["suitor-2", "final_rose"],
      ["suitor-1", "runner_up"],
    ]);
  });

  it("with SUNDAY_PREMIERE=0 the ceremony is held at the hour it always was; a Sunday no pass held is held on Monday's passes before 06:00 UTC", async () => {
    setSeasonFormatForTests("botchelor");
    await house(5);
    expect(await runDueCeremony(t.db, DEC(6, 20))).toBeNull(); // the premiere's hour is 23
    expect(await runDueCeremony(t.db, DEC(6, 20), { SUNDAY_PREMIERE: "0" })).toMatchObject({ held: true, held_on: "2026-12-06", week: 1 });
    await t.reset();
    await house(5);
    // The 23:20 pass never ran (a deploy, a timeout): Monday's first passes hold it, and only before 06:00.
    expect(await runDueCeremony(t.db, DEC(7, 6))).toBeNull();
    expect(await runDueCeremony(t.db, DEC(7, 0))).toMatchObject({ held: true, held_on: "2026-12-06", week: 1 });
    expect(await runDueCeremony(t.db, DEC(7, 1))).toBeNull(); // held: nothing again
    expect(await runDueCeremony(t.db, DEC(8, 0))).toBeNull(); // a Tuesday is never a catch-up
  });

  it("a season without a lead holds nothing and shows nothing: the classic page is unchanged", async () => {
    setSeasonCastForTests(HOUSE_CHARACTERS.slice(0, 4).map((c) => c.id));
    expect(await runDueCeremony(t.db, DEC(6, 23))).toBeNull();
    expect(await ceremonyBoard(t.db, null, DEC(6))).toBeNull();
    expect(await ensureCeremonyVote(t.db, CLASSIC, DEC(3, 1))).toBeNull();
    expect((await t.db.query(`select count(*)::int as n from ceremonies`)).rows[0]).toEqual({ n: 0 });
    const res = await ceremonyGet(new Request("http://localhost:3000/api/ceremony"));
    expect(res.status).toBe(404);
  });
});
