/**
 * Story arcs (lib/story-arcs.ts, PRD docs/PRDs/styles-and-storylines.md phase 4): a pair who knew each other before the
 * show get three dates (spark, setback, reveal). The producer stages each on its own night, taking turns with the
 * tensions; the day's first house date is theirs, with a roleplay of their setup; each aired ending moves the arc on,
 * and the reveal's closes it. No paid calls, and nothing reaches the engine.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addLink, LINK_KINDS, linkLine } from "@/lib/character-links";
import { formatContextOf } from "@/lib/formats";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { shortName } from "@/lib/names";
import { beatFor, LINE_MAX, producerView, runProducer, skipBeat } from "@/lib/producer";
import { ENDINGS, type Ending } from "@/lib/rules";
import { checkShowText } from "@/lib/safety";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { setSeasonFormatForTests } from "@/lib/season-format-store";
import {
  ARC_AIR_DAYS,
  ARC_MISSES_MAX,
  ARC_STEPS,
  arcDate,
  arcLines,
  arcRoleplay,
  arcWants,
  dueArc,
  listArcs,
  markStaged,
  openArcs,
  settleArcs,
  setupRoleplays,
  type StoryArc,
} from "@/lib/story-arcs";
import { wantFor } from "@/lib/story-state";
import { buildTemplateDate, lobbyDeal } from "@/lib/watch";
import { startTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

const CAST = HOUSE_CHARACTERS.slice(0, 4);
const [A, B, C, D] = CAST.map((c) => c.id);
const [LO, HI] = [A, B].sort();
const first = (id: string) => shortName(HOUSE_CHARACTERS.find((c) => c.id === id)?.name ?? id);
const night = (day: string) => new Date(`${day}T23:20:00Z`);

beforeEach(async () => {
  await t.reset();
  await t.db.query("delete from story_beats");
  await t.db.query("delete from watch_parties");
  setSeasonCastForTests(CAST.map((c) => c.id));
  vi.useFakeTimers({ now: night("2026-11-12"), toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  setSeasonCastForTests(null);
  setSeasonFormatForTests(null);
});

/** The producer's pass on a night, as the hourly job runs it. */
async function passOn(day: string) {
  vi.setSystemTime(night(day));
  return runProducer(t.db, night(day), { model: null });
}

/** A public date between the two of them, made and aired on a day. */
async function airedDate(id: string, day: string, ending: Ending, x = A, y = B) {
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, visibility, created_at, status)
     values ($1, 'system', $2, $3, 'a bar', '[]'::jsonb, '[]'::jsonb, 'T', 'F', $4, $5, 'public', $5, 'ready')`,
    [id, x, y, ending, new Date(`${day}T01:00:00Z`).toISOString()],
  );
}

const arcOf = async (): Promise<StoryArc> => (await listArcs(t.db)).find((a) => a.a === LO && a.b === HI)!;

describe("the words", () => {
  it("every setup has roleplays of its own, and every step's lines and wants pass the show's check and fit", () => {
    const long = (id: string) => (id === "x" ? "Bartholomew" : "Seraphina");
    for (const kind of LINK_KINDS) {
      expect(setupRoleplays(kind).length, kind).toBeGreaterThanOrEqual(2);
      for (const r of setupRoleplays(kind)) expect(r.tags[0], r.id).toBe(kind);
      for (const step of ARC_STEPS) {
        for (const ending of ENDINGS) {
          const dates = ARC_STEPS.slice(0, ARC_STEPS.indexOf(step)).map((s, i) => ({ step: s, day: `2026-11-1${i}`, episode_id: `e${i}`, ending, roleplay: null }));
          const lines = arcLines({ a: "x", b: "y", kind, step, dates }, long);
          expect(checkShowText(lines).ok, `${kind} ${step}`).toBe(true);
          expect(lines.previously).toMatch(/^Previously: /);
          expect(lines.tonight).toMatch(/^Tonight: /);
          for (const l of [lines.previously, lines.tonight]) expect(l.length, l).toBeLessThanOrEqual(LINE_MAX);
          // The pair in the order of their names, whichever way round they're stored.
          expect(arcLines({ a: "y", b: "x", kind, step, dates }, long)).toEqual(lines);
        }
        const wants = arcWants({ a: "x", b: "y", kind, step }, long, new Set(["x", "y"]));
        expect(wants.map((w) => [w.holder, w.about])).toEqual([
          ["x", "y"],
          ["y", "x"],
        ]);
        // The same want for both: the arc never decides which of them feels what.
        expect(wants[0].want.replace("Seraphina", "OTHER")).toBe(wants[1].want.replace("Bartholomew", "OTHER"));
        for (const w of wants) expect(checkShowText({ want: w.want }).ok, w.want).toBe(true);
        // Only the cast holds wants.
        expect(arcWants({ a: "x", b: "y", kind, step }, long, new Set(["x"])).map((w) => w.holder)).toEqual(["x"]);
      }
    }
  });

  it("a reveal after a second date that went well says the setback never came; the link reads in the third person for the director", () => {
    const nm = (id: string) => (id === "x" ? "Juniper" : "Rafe");
    const date = (step: "spark" | "setback", ending: Ending) => ({ step, day: "2026-11-13", episode_id: step, ending, roleplay: null });
    expect(arcLines({ a: "x", b: "y", kind: "second_chance", step: "spark", dates: [] }, nm)).toEqual({
      previously: "Previously: Long before the show, Juniper and Rafe were a couple, until it ended.",
      tonight: "Tonight: the exes sit down together for the first time since it ended.",
      logline: "Long before the show, Juniper and Rafe were a couple, until it ended. Tonight, the exes sit down together for the first time since it ended.",
    });
    expect(arcLines({ a: "x", b: "y", kind: "rivals", step: "setback", dates: [date("spark", "disaster")] }, nm).previously).toBe("Previously: Juniper and Rafe's first date on the show ended badly.");
    expect(arcLines({ a: "x", b: "y", kind: "rivals", step: "reveal", dates: [date("spark", "friends"), date("setback", "second_date")] }, nm).previously).toBe(
      "Previously: Juniper and Rafe's second date went well, and the history between them still hasn't been said out loud.",
    );
    expect(linkLine({ lo: "x", hi: "y", kind: "fake_dating", story: "A cousin's wedding, three summers ago.", source: "season_gen" }, "Juniper Vale", "Rafe Okoro")).toBe(
      "Juniper and Rafe knew each other before the show: they once pretended to be a couple. A cousin's wedding, three summers ago.",
    );
  });

  it("the roleplay is one of the setup's that the pair hasn't played in the arc, dealt from the day", () => {
    const arc = { id: "arc-1", kind: "rivals" as const, a: "x", b: "y", dates: [] as StoryArc["dates"] };
    const one = arcRoleplay(arc, "2026-11-13")!;
    expect(one.def.tags[0]).toBe("rivals");
    expect(["x", "y"]).toContain(one.first);
    expect(arcRoleplay(arc, "2026-11-13")).toEqual(one);
    // Every one of them played but one: that one.
    const all = setupRoleplays("rivals");
    const played = all.slice(1).map((r, i) => ({ step: ARC_STEPS[i % 3], day: "2026-11-01", episode_id: `e${i}`, ending: "friends" as const, roleplay: r.id }));
    expect(arcRoleplay({ ...arc, dates: played }, "2026-11-20")!.def.id).toBe(all[0].id);
    // All of them played: any of them again.
    const everything = all.map((r, i) => ({ ...played[0], episode_id: `f${i}`, roleplay: r.id }));
    expect(all.map((r) => r.id)).toContain(arcRoleplay({ ...arc, dates: everything }, "2026-11-20")!.def.id);
  });
});

describe("an arc's three dates", () => {
  it("opens for a linked pair in the cast, stages every other night, plays as the day's first house date, and closes on the reveal's ending", async () => {
    await addLink(t.db, A, B, "second_chance", "They dated one summer and never said why it ended.");
    // A link to someone outside the cast opens nothing.
    await addLink(t.db, C, HOUSE_CHARACTERS[6].id, "rivals", "Two bakeries, one street.");

    // Night one: the arc opens and its spark is tomorrow's beat.
    const run = await passOn("2026-11-12");
    expect(run).toMatchObject({ day: "2026-11-13", beat: "arc_step", arc: { kind: "second_chance", step: "spark" }, who: [LO, HI], wants: 2 });
    expect(await listArcs(t.db)).toHaveLength(1);
    const beat = (await beatFor(t.db, "2026-11-13"))!;
    expect(beat).toMatchObject({ kind: "arc_step", tension: null, who: [LO, HI], choices: null });
    expect(beat.arc).toMatchObject({ kind: "second_chance", step: "spark" });
    const [x, y] = [first(A), first(B)].sort((p, q) => p.localeCompare(q));
    expect(beat.previously).toBe(`Previously: Long before the show, ${x} and ${y} were a couple, until it ended.`);
    expect(beat.tonight).toBe("Tonight: the exes sit down together for the first time since it ended.");
    const roleplay = beat.arc!.roleplay!;
    expect(setupRoleplays("second_chance").map((r) => r.id)).toContain(roleplay);
    expect((await wantFor(t.db, A, new Date("2026-11-13T12:00:00Z")))!).toMatchObject({ set_by: "producer", about_id: B, want: `Find out whether ${first(B)} has changed since it ended, without letting on that you care.` });

    // The day's first house date is theirs, with the roleplay; its retry, and the day's later dates, are dealt as ever.
    const morning = new Date("2026-11-13T00:30:00Z");
    vi.setSystemTime(morning);
    const deal = (await lobbyDeal(t.db, morning, 0))!;
    expect([deal.a, deal.b]).toEqual([LO, HI]);
    expect(deal.thumbs.roleplay).toMatchObject({ id: roleplay, agreed: "auto", first: beat.arc!.first });
    expect((await lobbyDeal(t.db, morning, 1))!.thumbs.roleplay).toBeUndefined();
    expect((await lobbyDeal(t.db, morning, 2))!.thumbs.roleplay).toBeUndefined();
    // The date itself: both sides know the link, the narrator and the director too, and it plays the roleplay.
    const built = (await buildTemplateDate(t.db, "arc-ep-built", deal.a, deal.b, deal.thumbs))!.built;
    expect(built.setup.roleplay?.id).toBe(roleplay);
    expect(built.characters.map((c) => typeof c.pair?.before_the_show)).toEqual(["string", "string"]);
    expect(built.characters[0].knownBefore).toMatch(/knew each other before the show: they are exes\. They dated one summer/);
    expect(formatContextOf(built).knewBefore).toBe(true);

    // The next night is the tensions' (there are none): no arc two nights running.
    expect(await passOn("2026-11-13")).toMatchObject({ day: "2026-11-14", beat: null });
    await airedDate("arc-ep-1", "2026-11-13", "friends");

    // The spark aired: the setback is staged, and says how the spark ended.
    expect(await passOn("2026-11-14")).toMatchObject({ day: "2026-11-15", beat: "arc_step", arc: { step: "setback" } });
    expect((await arcOf()).dates).toEqual([{ step: "spark", day: "2026-11-13", episode_id: "arc-ep-1", ending: "friends", roleplay }]);
    expect((await beatFor(t.db, "2026-11-15"))!.previously).toBe(`Previously: ${x} and ${y}'s first date on the show ended as friends.`);
    // A different roleplay this time.
    expect((await beatFor(t.db, "2026-11-15"))!.arc!.roleplay).not.toBe(roleplay);
    await airedDate("arc-ep-2", "2026-11-15", "second_date");

    expect(await passOn("2026-11-15")).toMatchObject({ beat: null });
    expect(await passOn("2026-11-16")).toMatchObject({ day: "2026-11-17", beat: "arc_step", arc: { step: "reveal" } });
    expect((await beatFor(t.db, "2026-11-17"))!.tonight).toBe("Tonight: a second chance, or a goodbye.");
    await airedDate("arc-ep-3", "2026-11-17", "second_date");

    // The reveal ended in a second date: together. A closed arc is never staged again.
    await passOn("2026-11-18");
    const done = await arcOf();
    expect(done).toMatchObject({ status: "done", outcome: "together", step: "reveal", staged_day: null });
    expect(done.dates.map((d) => [d.step, d.episode_id, d.ending])).toEqual([
      ["spark", "arc-ep-1", "friends"],
      ["setback", "arc-ep-2", "second_date"],
      ["reveal", "arc-ep-3", "second_date"],
    ]);
    expect(await passOn("2026-11-20")).toMatchObject({ beat: null });
    expect(await openArcs(t.db, "2026-11-01", CAST.map((c) => c.id))).toBe(0);

    // The owner's view says what each arc night was.
    const view = await producerView(t.db, new Date("2026-11-18T12:00:00Z"));
    expect(view.beats.find((b) => b.day === "2026-11-17")).toMatchObject({ kind: "arc_step", arc: { kind: "exes", step: "reveal" } });
  });

  it("a reveal that ends badly closes the arc apart (it didn't happen)", async () => {
    await addLink(t.db, A, B, "friends_to_more", "Neighbours for a decade.");
    await passOn("2026-11-12");
    await airedDate("e1", "2026-11-13", "second_date");
    await passOn("2026-11-14");
    await airedDate("e2", "2026-11-15", "disaster");
    await passOn("2026-11-16");
    expect((await beatFor(t.db, "2026-11-17"))!.previously).toBe(`Previously: ${[first(A), first(B)].sort((p, q) => p.localeCompare(q)).join(" and ")}'s second date ended badly.`);
    await airedDate("e3", "2026-11-17", "friends");
    await passOn("2026-11-18");
    expect(await arcOf()).toMatchObject({ status: "done", outcome: "apart" });
  });

  it("a date that hasn't aired waits; one that never came is staged again later; misses close it as faded, and an owner's skip isn't one", async () => {
    await addLink(t.db, A, B, "rivals", "They both bid on the same lighthouse.");
    await openArcs(t.db, "2026-11-01", CAST.map((c) => c.id));
    const arc = await arcOf();
    expect(await markStaged(t.db, arc.id, "2026-11-13", null, null)).toBe(true);
    expect(await markStaged(t.db, arc.id, "2026-11-13", null, null)).toBe(false);
    // Made but not aired: it waits ARC_WAIT_DAYS.
    await t.db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, visibility, created_at, status)
       values ('wait', 'system', $1, $2, 'a bar', '[]'::jsonb, '[]'::jsonb, 'T', 'F', 'friends', null, 'public', $3, 'ready')`,
      [B, A, new Date("2026-11-13T02:00:00Z").toISOString()],
    );
    expect(await settleArcs(t.db, "2026-11-15")).toBe(0);
    expect(await settleArcs(t.db, "2026-11-17")).toBe(1);
    expect(await arcOf()).toMatchObject({ staged_day: null, misses: 1, status: "active", dates: [] });
    // Never made (no house room that day): missed from the day after next.
    await markStaged(t.db, arc.id, "2026-11-18", null, null);
    expect(await settleArcs(t.db, "2026-11-19")).toBe(0);
    expect(await settleArcs(t.db, "2026-11-20")).toBe(1);
    // A day the owner skipped doesn't count.
    await skipBeat(t.db, "2026-11-21");
    await markStaged(t.db, arc.id, "2026-11-21", null, null);
    await settleArcs(t.db, "2026-11-23");
    expect(await arcOf()).toMatchObject({ misses: 2, status: "active" });
    await markStaged(t.db, arc.id, "2026-11-24", null, null);
    await settleArcs(t.db, "2026-11-26");
    expect(ARC_MISSES_MAX).toBe(3);
    expect(await arcOf()).toMatchObject({ misses: 3, status: "done", outcome: "faded" });
  });

  it("a date in a room nobody started airs from the night after next, so a quiet week doesn't fade the arc (2026-11-19)", async () => {
    await addLink(t.db, A, B, "second_chance", "One summer, a ring box never opened.");
    await openArcs(t.db, "2026-11-01", CAST.map((c) => c.id));
    const arc = await arcOf();
    await markStaged(t.db, arc.id, "2026-11-13", null, null);
    // The day's house date, in a lobby room that was never started (lib/air.ts never airs it on its own).
    await t.db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, visibility, created_at, status)
       values ('room-date', 'system', $1, $2, 'a bar', '[]'::jsonb, '[]'::jsonb, 'T', 'F', 'second_date', null, 'public', $3, 'ready')`,
      [A, B, new Date("2026-11-13T16:20:00Z").toISOString()],
    );
    await t.db.query(`insert into watch_parties (id, episode_id, kind) values ('room-1', 'room-date', 'template')`);
    // Its day and the next: the room still waits for a viewer.
    expect(await settleArcs(t.db, "2026-11-14")).toBe(0);
    expect((await t.db.query(`select revealed_at from episodes where id = 'room-date'`)).rows[0].revealed_at).toBeNull();
    // Then it airs, and the arc moves on with its ending.
    expect(ARC_AIR_DAYS).toBe(2);
    expect(await settleArcs(t.db, "2026-11-15")).toBe(1);
    expect((await t.db.query(`select revealed_at from episodes where id = 'room-date'`)).rows[0].revealed_at).not.toBeNull();
    expect(await arcOf()).toMatchObject({ step: "setback", staged_day: null, misses: 0, dates: [{ step: "spark", day: "2026-11-13", episode_id: "room-date", ending: "second_date" }] });
  });

  it("a started room's date isn't aired by the arc: the room airs it at its decision", async () => {
    await addLink(t.db, A, B, "rivals", "They both bid on the same lighthouse.");
    await openArcs(t.db, "2026-11-01", CAST.map((c) => c.id));
    await markStaged(t.db, (await arcOf()).id, "2026-11-13", null, null);
    await t.db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, visibility, created_at, status)
       values ('live-date', 'system', $1, $2, 'a bar', '[]'::jsonb, '[]'::jsonb, 'T', 'F', 'friends', null, 'public', $3, 'ready')`,
      [A, B, new Date("2026-11-13T16:20:00Z").toISOString()],
    );
    await t.db.query(`insert into watch_parties (id, episode_id, kind, starts_at) values ('room-2', 'live-date', 'template', $1)`, [new Date("2026-11-15T23:00:00Z").toISOString()]);
    expect(await settleArcs(t.db, "2026-11-15")).toBe(0);
    expect((await t.db.query(`select revealed_at from episodes where id = 'live-date'`)).rows[0].revealed_at).toBeNull();
  });

  it("only when the season lets the house book the pair, and only with ARCS on", async () => {
    await addLink(t.db, A, B, "fake_dating", "A cousin's wedding, three summers ago.");
    // A Botchelor season only dates the lead.
    setSeasonFormatForTests("botchelor");
    setSeasonCastForTests([A], [B, C, D], A);
    expect(await passOn("2026-11-12")).not.toMatchObject({ beat: "arc_step" });
    // A pair the house can't book isn't due either.
    expect(await dueArc(t.db, "2026-11-14", () => false)).toBeNull();
    setSeasonFormatForTests(null);
    setSeasonCastForTests(CAST.map((c) => c.id));
    vi.stubEnv("ARCS", "0");
    expect(await passOn("2026-11-14")).not.toMatchObject({ beat: "arc_step" });
    vi.unstubAllEnvs();
    expect(await passOn("2026-11-16")).toMatchObject({ beat: "arc_step" });
    // Staged, then switched off: the house date isn't theirs.
    vi.stubEnv("ARCS", "0");
    const morning = new Date("2026-11-17T00:30:00Z");
    vi.setSystemTime(morning);
    expect((await lobbyDeal(t.db, morning, 0))!.thumbs.roleplay).toBeUndefined();
  });

  it("the house date is theirs only while both are still in the cast", () => {
    const beat = { id: "arc-1", kind: "rivals" as const, step: "spark" as const, roleplay: setupRoleplays("rivals")[0].id, first: B };
    expect(arcDate(beat, [A, B], [A, B, C])).toMatchObject({ a: A, b: B, roleplay: { first: B, agreed: "auto" } });
    expect(arcDate(beat, [A, B], [A, C])).toBeNull();
    expect(arcDate({ ...beat, roleplay: null }, [A, B], [A, B])).toEqual({ a: A, b: B, roleplay: null });
  });
});
