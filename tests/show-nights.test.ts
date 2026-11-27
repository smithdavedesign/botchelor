import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as fantasyGet, POST as fantasyPost } from "@/app/api/fantasy/route";
import { bombshellBoard, runDueBombshell, voteBombshell } from "@/lib/bombshell";
import { ceremonyBoard, ensureCeremonyVote, runCeremony, runDueCeremony, voteCeremony } from "@/lib/ceremony";
import { exitInterview, revealSteps, type NightFace } from "@/lib/ceremony-night";
import { draftFantasy, draftPoints, fantasyBoard, suitorPoints } from "@/lib/fantasy";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { seasonFormat } from "@/lib/season-format";
import { setSeasonFormatForTests } from "@/lib/season-format-store";
import { ceremonyRecapLine, seasonPreviously, teaBoard } from "@/lib/season-story";
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
const DEC = (day: number, hour = 12) => new Date(Date.UTC(2026, 11, day, hour));
const SEASON = "2026-12-01";
const LEAD = HOUSE_CHARACTERS[0].id;
const NAMES = ["Ansel", "Bea", "Cato", "Dex", "Elin", "Fox", "Gil", "Hana"];

async function character(id: string, name: string, owner: string, extras: Record<string, unknown> = {}) {
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility, open_to_dates, created_via, extras)
     values ($1, $2, false, $3, 30, 'A suitor with a story.', '["bold","warm","odd"]'::jsonb, 'love', 'rudeness', 'public', true, 'web', $4::jsonb)`,
    [id, owner, name, JSON.stringify(extras)],
  );
}

async function house(n = 5, extras: Record<string, Record<string, unknown>> = {}) {
  await t.db.query(`insert into season_casts (season_id, character_id, slot, source) values ($1, $2, 0, 'lead')`, [SEASON, LEAD]);
  for (let i = 1; i <= n; i++) {
    await character(`suitor-${i}`, NAMES[i - 1], `owner-${i}`, extras[`suitor-${i}`] ?? {});
    await t.db.query(`insert into season_casts (season_id, character_id, slot, source) values ($1, $2, $3, 'suitor')`, [SEASON, `suitor-${i}`, i]);
  }
}

async function dated(id: string, a: string, b: string, day: number, ending: "second_date" | "friends" | "disaster", venue = "jazz_bar") {
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, seed, status, visibility, revealed_at, transcript, sides, setup)
     values ($1, 'u-show', $2, $3, 'a table', '[]'::jsonb, '[]'::jsonb, 'a twist', 'a finale', $4, 1, 'ready', 'public', $5, '[]'::jsonb, $6::jsonb, $7::jsonb)`,
    [id, a, b, ending, DEC(day).toISOString(), JSON.stringify([{ wants_another: ending === "second_date", satisfied: true }, { wants_another: true, satisfied: true }]), JSON.stringify({ venue })],
  );
}

/** Week one: five suitors, Bea voted out, Dex's disaster sends him home. */
async function weekOne() {
  setSeasonFormatForTests("botchelor");
  await house(5, { "suitor-4": { lines: { upset: "Well. That's a plot twist I didn't order." } } });
  await dated("d1", LEAD, "suitor-1", 2, "second_date");
  await dated("d2", LEAD, "suitor-2", 3, "friends");
  await dated("d3", LEAD, "suitor-3", 3, "friends");
  await dated("d4", LEAD, "suitor-4", 4, "disaster", "cooking_class");
  await dated("d5", LEAD, "suitor-5", 5, "friends");
  await ensureCeremonyVote(t.db, BOTCHELOR, DEC(3, 1));
  await voteCeremony(t.db, "fan-1", "suitor-2", DEC(4));
  return runDueCeremony(t.db, DEC(6, 23));
}

const face = (id: string): NightFace => ({ id, name: id, hue: null, portrait: null, house: false });

describe("the staged reveal (lib/ceremony-night.ts revealSteps)", () => {
  it("tells a week in TV order: the opening, the audience's pick, the roses one at a time, the last rose between two faces, who goes home, the limo", () => {
    const steps = revealSteps({
      held_on: "2026-12-06",
      week: 1,
      finale: false,
      lines: ["Sunday night at the house.", "The audience spoke first and sent b home.", "The lead's own week decided the rest: d's date was a disaster.", "Still in: a, c, e."],
      kept: [face("a"), face("c"), face("e")],
      voted_out: face("b"),
      lead_out: face("d"),
      final_rose: null,
      runners_up: [],
      exits: [{ id: "d", by: "lead", lines: ["That date was a disaster."] }],
    });
    expect(steps.map((s) => s.kind)).toEqual(["open", "vote", "rose", "rose", "last_rose", "goes_to", "home", "limo", "close"]);
    const last = steps.find((s) => s.kind === "last_rose")!;
    expect(last.kind === "last_rose" && last.faces.map((f) => f.id).sort()).toContain("d");
    // The same order for everyone, every replay.
    expect(JSON.stringify(revealSteps({ held_on: "2026-12-06", week: 1, finale: false, lines: [], kept: [face("a"), face("c"), face("e")], voted_out: null, lead_out: null, final_rose: null, runners_up: [], exits: [] }))).toBe(
      JSON.stringify(revealSteps({ held_on: "2026-12-06", week: 1, finale: false, lines: [], kept: [face("e"), face("a"), face("c")], voted_out: null, lead_out: null, final_rose: null, runners_up: [], exits: [] })),
    );
  });

  it("the finale: the last faces, the final rose, the runner-up's exit", () => {
    const steps = revealSteps({
      held_on: "2026-12-27",
      week: 4,
      finale: true,
      lines: ["The last Sunday.", "The final rose goes to a: 4 dates."],
      kept: [],
      voted_out: null,
      lead_out: null,
      final_rose: face("a"),
      runners_up: [face("c")],
      exits: [{ id: "c", by: "lead", lines: ["Final two. Not bad."] }],
    });
    expect(steps.map((s) => s.kind)).toEqual(["open", "last_rose", "goes_to", "home", "limo"]);
  });
});

describe("exit interviews (lib/ceremony-night.ts exitInterview)", () => {
  it("their own 'when something goes wrong' line, the week in a sentence, and who sent them home", () => {
    expect(exitInterview({ lead: "Mara", by: "vote", week: { dates: 0, best: null, worst: null } })).toEqual([
      "I never got a date with Mara this week. That's the part that stings.",
      "The audience sent me home. I hope they were watching closely.",
    ]);
    const lines = exitInterview({ lead: "Mara", by: "lead", week: { dates: 2, best: { ending: "second_date", venue: "x" }, worst: null }, extras: { lines: { upset: "Well, that happened." } }, place: () => "a rooftop" });
    expect(lines).toEqual(["Well, that happened.", "We had a second date at a rooftop. I really thought that meant something.", "Mara made the call. For the record, I'd have kept me."]);
  });

  it("is written when the ceremony is held, and the card's reveal reads it with who kept a rose", async () => {
    const run = await weekOne();
    expect(run).toMatchObject({ held: true, went_home: ["suitor-2", "suitor-4"] });
    const board = (await ceremonyBoard(t.db, null, DEC(7)))!;
    expect(board.staged).toBe(true);
    expect(board.season_path).toMatch(/^\/seasons\//);
    expect(board.last!.kept.map((f) => f.id)).toEqual(["suitor-1", "suitor-3", "suitor-5"]);
    expect(board.last!.voted_out?.id).toBe("suitor-2");
    expect(board.last!.lead_out?.id).toBe("suitor-4");
    const dex = board.last!.exits.find((e) => e.id === "suitor-4")!;
    expect(dex.by).toBe("lead");
    expect(dex.lines[0]).toBe("Well. That's a plot twist I didn't order.");
    expect(dex.lines[1]).toContain("disaster");
    expect(board.last!.exits.find((e) => e.id === "suitor-2")!.by).toBe("vote");
  });

  it("EXIT_INTERVIEWS=0 writes none", async () => {
    vi.stubEnv("EXIT_INTERVIEWS", "0");
    await weekOne();
    expect((await ceremonyBoard(t.db, null, DEC(7)))!.last!.exits).toEqual([]);
  });
});

describe("the bombshell (lib/bombshell.ts)", () => {
  async function auditions() {
    for (const [id, name] of [
      ["aud-1", "Gil"],
      ["aud-2", "Hana"],
    ]) {
      await character(id, name, `owner-${id}`);
      await t.db.query(`insert into cast_auditions (season_id, character_id, owner_id, status) values ($1, $2, $3, 'approved')`, [SEASON, id, `owner-${id}`]);
    }
  }

  it("opens after the first ceremony, takes one vote a viewer, walks the pick in after Thursday's ballot, and keeps them safe at their first ceremony", async () => {
    await auditions();
    expect(await runDueBombshell(t.db, DEC(5))).toBeNull(); // before any ceremony: nothing
    await weekOne();
    expect(await runDueBombshell(t.db, DEC(7))).toEqual({ opened: true });
    expect(await voteBombshell(t.db, "fan-1", "nobody", DEC(8))).toMatchObject({ ok: false, error: "not_on_ballot" });
    expect(await voteBombshell(t.db, "fan-1", "aud-2", DEC(8))).toEqual({ ok: true, pick: "aud-2" });
    expect(await voteBombshell(t.db, "fan-2", "aud-2", DEC(8))).toEqual({ ok: true, pick: "aud-2" });
    const open = (await bombshellBoard(t.db, "fan-1", DEC(8)))!;
    expect(open).toMatchObject({ state: "open", my_pick: "aud-2", total: 2 });
    expect((await bombshellBoard(t.db, null, DEC(8)))!.choices.every((c) => c.votes === 0)).toBe(true); // counts once you've voted

    // Thursday: Sunday's ballot opens first, then the bombshell walks in, off that ballot.
    const ballot = await ensureCeremonyVote(t.db, BOTCHELOR, new Date(Date.UTC(2026, 11, 10, 0, 30)));
    expect(ballot!.choices.map((c) => c.id)).toEqual(["suitor-1", "suitor-3", "suitor-5"]);
    expect(await runDueBombshell(t.db, new Date(Date.UTC(2026, 11, 10, 0, 30)))).toBeNull(); // not yet
    expect(await runDueBombshell(t.db, new Date(Date.UTC(2026, 11, 10, 1, 5)))).toEqual({ joined: "aud-2" });
    expect(await runDueBombshell(t.db, DEC(11))).toBeNull(); // once
    expect((await t.db.query(`select source from season_casts where season_id = $1 and character_id = 'aud-2'`, [SEASON])).rows[0]).toEqual({ source: "suitor" });
    expect((await t.db.query(`select title from notifications where user_id = 'owner-aud-2'`)).rows[0].title).toContain("Hana is The Botchelor's bombshell");
    expect((await bombshellBoard(t.db, null, DEC(11)))!).toMatchObject({ state: "joined", joined: { id: "aud-2" } });

    // Week two: Hana never dated the lead, and is still safe; one of the other three goes.
    await dated("w2-1", LEAD, "suitor-1", 11, "second_date");
    await dated("w2-3", LEAD, "suitor-3", 11, "disaster");
    await dated("w2-5", LEAD, "suitor-5", 12, "friends");
    const week2 = await runCeremony(t.db, BOTCHELOR, "2026-12-13", DEC(13, 23));
    expect(week2).toMatchObject({ held: true, week: 2 });
    expect(week2.held && week2.went_home).not.toContain("aud-2");
    expect(week2.held && week2.went_home).toHaveLength(1);
    const lines = (await t.db.query<{ lines: string[] }>(`select lines from ceremonies where held_on = '2026-12-13'`)).rows[0].lines;
    expect(lines.join(" ")).toContain("Hana, the bombshell, was safe this week");
  });

  it("opens nothing with fewer than two shortlisted auditions off the cast, or with BOMBSHELL=0", async () => {
    await weekOne();
    expect(await runDueBombshell(t.db, DEC(7))).toBeNull();
    await auditions();
    vi.stubEnv("BOMBSHELL", "0");
    expect(await runDueBombshell(t.db, DEC(7))).toBeNull();
  });
});

describe("the fantasy league (lib/fantasy.ts)", () => {
  it("scores a rose a week, the final two and the final rose", () => {
    const ceremonies = [
      { finale: false, remaining: ["a", "b", "c"], final_rose: null, finalists: [] },
      { finale: false, remaining: ["a", "b"], final_rose: null, finalists: [] },
      { finale: true, remaining: ["a"], final_rose: "a", finalists: ["a", "b"] },
    ];
    expect(suitorPoints("a", ceremonies)).toBe(7);
    expect(suitorPoints("b", ceremonies)).toBe(5);
    expect(suitorPoints("c", ceremonies)).toBe(1);
    expect(draftPoints(["a", "c", "z"], ceremonies)).toBe(8);
  });

  it("drafts three suitors until the first ceremony's vote opens, then scores them from the held ceremonies", async () => {
    setSeasonFormatForTests("botchelor");
    await house(5);
    expect(await draftFantasy(t.db, "fan-1", ["suitor-1", "suitor-2"], DEC(2))).toMatchObject({ ok: false, error: "pick_three" });
    expect(await draftFantasy(t.db, "fan-1", ["suitor-1", "suitor-1", "suitor-2"], DEC(2))).toMatchObject({ ok: false, error: "pick_three" });
    expect(await draftFantasy(t.db, "fan-1", ["suitor-1", "suitor-2", "x"], DEC(2))).toMatchObject({ ok: false, error: "not_a_suitor" });
    expect(await draftFantasy(t.db, "fan-1", ["suitor-1", "suitor-2", "suitor-4"], DEC(2))).toEqual({ ok: true, picks: ["suitor-1", "suitor-2", "suitor-4"] });
    expect(await draftFantasy(t.db, "fan-2", ["suitor-1", "suitor-3", "suitor-5"], DEC(2))).toMatchObject({ ok: true });
    expect(await draftFantasy(t.db, "fan-3", ["suitor-1", "suitor-3", "suitor-5"], DEC(3, 1))).toMatchObject({ ok: false, error: "draft_closed" });

    // Week one sends Bea (suitor-2) and Dex (suitor-4) home: fan-1 keeps one rose, fan-2 three.
    await dated("d1", LEAD, "suitor-1", 2, "second_date");
    await dated("d2", LEAD, "suitor-2", 3, "friends");
    await dated("d3", LEAD, "suitor-3", 3, "friends");
    await dated("d4", LEAD, "suitor-4", 4, "disaster");
    await dated("d5", LEAD, "suitor-5", 5, "friends");
    await ensureCeremonyVote(t.db, BOTCHELOR, DEC(3, 1));
    await voteCeremony(t.db, "fan-9", "suitor-2", DEC(4));
    await runDueCeremony(t.db, DEC(6, 23));
    const b1 = (await fantasyBoard(t.db, "fan-1", DEC(7)))!;
    expect(b1).toMatchObject({ open: false, players: 2, mine: { points: 1, rank: 2 } });
    expect((await fantasyBoard(t.db, "fan-2", DEC(7)))!.mine).toMatchObject({ points: 3, rank: 1 });
    expect(b1.suitors.find((s) => s.id === "suitor-1")).toMatchObject({ points: 1, drafted: 2 });
  });

  it("over the API with the visitor's cookie", async () => {
    setSeasonFormatForTests("botchelor");
    await house(4);
    vi.useFakeTimers({ toFake: ["Date"], now: DEC(2) });
    try {
      const res = await fantasyPost(jsonRequest("/api/fantasy", { picks: ["suitor-1", "suitor-2", "suitor-3"] }));
      expect(res.status).toBe(201);
      const cookie = res.headers.get("set-cookie")!.split(";")[0];
      const got = await fantasyGet(new Request("http://localhost:3000/api/fantasy", { headers: { cookie } }));
      expect(got.status).toBe(200);
      expect(((await got.json()) as { mine: { picks: string[] } }).mine.picks).toEqual(["suitor-1", "suitor-2", "suitor-3"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Previously on and the tea (lib/season-story.ts)", () => {
  it("recaps a ceremony in a sentence", () => {
    const name = (id: string) => id.toUpperCase();
    expect(ceremonyRecapLine({ week: 1, finale: false, voted: "b", lead: "d", final_rose: null, remaining: ["a", "c", "e"] }, name)).toBe("At the first rose ceremony, B and D went home. 3 suitors are still in.");
    expect(ceremonyRecapLine({ week: 4, finale: true, voted: null, lead: null, final_rose: "a", remaining: ["a"] }, name)).toBe("The finale: A took the final rose.");
  });

  it("opens the night on last Sunday and the latest storyline; the tea links each storyline to the date it played out on", async () => {
    await weekOne();
    await dated("rivals-1", "suitor-1", "suitor-3", 8, "disaster");
    await t.db.query(
      `insert into story_beats (day, season_id, kind, status, tension, who, logline, previously, tonight)
       values ('2026-12-08', $1, 'rival_date', 'played', 'rivals', '["suitor-1","suitor-3"]'::jsonb, 'Ansel and Cato want the same rose, and only one of them is pretending not to.', 'Ansel and Cato kept score.', 'Tonight they share a table.')`,
      [SEASON],
    );
    const prev = (await seasonPreviously(t.db, SEASON, DEC(9)))!;
    expect(prev[0]).toBe("At the first rose ceremony, Bea and Dex went home. 3 suitors are still in.");
    expect(prev[1]).toContain("Ansel and Cato want the same rose");
    const tea = await teaBoard(t.db, SEASON, DEC(9));
    expect(tea).toHaveLength(1);
    expect(tea[0]).toMatchObject({ day: "2026-12-08", episode_id: "rivals-1" });
    expect(tea[0].faces.map((f) => f.name)).toEqual(["Ansel", "Cato"]);
    expect(await teaBoard(t.db, SEASON, DEC(20))).toEqual([]); // a week on, it's old news
    vi.stubEnv("TEA_BOARD", "0");
    expect(await teaBoard(t.db, SEASON, DEC(9))).toEqual([]);
    vi.stubEnv("SEASON_PREVIOUSLY", "0");
    expect(await seasonPreviously(t.db, SEASON, DEC(9))).toBeNull();
  });
});
