import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as recouplingGet, POST as recouplingPost } from "@/app/api/recoupling/route";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { mixerNightView } from "@/lib/mixer-night";
import {
  ensureRecouplingVote,
  recouplingBallot,
  recouplingBoard,
  runDueRecoupling,
  stageRecouplingNight,
  voteRecoupling,
} from "@/lib/recoupling";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { seasonFormat } from "@/lib/season-format";
import { setSeasonFormatForTests } from "@/lib/season-format-store";
import { seasonIdOf } from "@/lib/season-window";
import { episodeJson, jsonRequest, scriptedModel, scriptOutcome, startTestDb } from "./helpers";

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
  setSeasonCastForTests(HOUSE_CHARACTERS.slice(0, 4).map((c) => c.id));
});
afterEach(() => {
  setSeasonCastForTests(null);
  setSeasonFormatForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const CLASSIC = seasonFormat("classic");
const NOV = (day: number, hour = 12) => new Date(Date.UTC(2026, 10, day, hour));
const cast = () => HOUSE_CHARACTERS.slice(0, 4).map((c) => c.id);

/** A public date between two of the cast, aired inside November 2026, so the ballot has couples. */
async function airedDate(id: string, a: string, b: string, day: number, ending = "second_date") {
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, seed, status, visibility, revealed_at, transcript)
     values ($1, 'u-show', $2, $3, 'a table', '[]'::jsonb, '[]'::jsonb, 'a twist', 'a finale', $4, 1, 'ready', 'public', $5, '[]'::jsonb)`,
    [id, a, b, ending, NOV(day).toISOString()],
  );
}

describe("the ballot and the vote (lib/recoupling.ts)", () => {
  it("bills the season's top couples, most second dates first", async () => {
    const [a, b, c, d] = cast();
    await airedDate("rc-1", a, b, 2);
    await airedDate("rc-2", a, b, 4);
    await airedDate("rc-3", c, d, 5, "friends");
    const ballot = await recouplingBallot(t.db, "couple_in_trouble", NOV(10));
    expect(ballot).toHaveLength(2);
    expect(ballot[0].id).toBe([a, b].sort().join("|"));
    expect(ballot[0].a).toBeTruthy();
    expect(ballot[0].label).toContain("×");
  });

  it("opens the vote only within three days of the night, with a frozen ballot", async () => {
    const [a, b, c, d] = cast();
    await airedDate("rc-1", a, b, 2);
    await airedDate("rc-2", c, d, 5);
    expect(await ensureRecouplingVote(t.db, CLASSIC, NOV(26))).toBeNull(); // Nov 30 is 4 days off
    const row = await ensureRecouplingVote(t.db, CLASSIC, NOV(27, 15));
    expect(row).toMatchObject({ night_at: "2026-11-30", question: "couple_in_trouble" });
    expect(row!.choices.length).toBe(2);
    // A date airing after the vote opened doesn't redraw the ballot.
    await airedDate("rc-4", a, c, 28);
    expect((await ensureRecouplingVote(t.db, CLASSIC, NOV(28)))!.choices).toEqual(row!.choices);
  });

  it("takes one changeable vote a viewer, refuses an off-ballot pick, and 404s with no vote open", async () => {
    const [a, b, c, d] = cast();
    await airedDate("rc-1", a, b, 2);
    await airedDate("rc-2", c, d, 5);
    expect(await voteRecoupling(t.db, "fan-1", "x|y", NOV(10))).toMatchObject({ ok: false, status: 404 });
    const row = (await ensureRecouplingVote(t.db, CLASSIC, NOV(28)))!;
    const [one, two] = row.choices;
    expect(await voteRecoupling(t.db, "fan-1", one.id, NOV(28))).toEqual({ ok: true, pick: one.id });
    expect(await voteRecoupling(t.db, "fan-1", two.id, NOV(28))).toEqual({ ok: true, pick: two.id });
    expect(await voteRecoupling(t.db, "fan-1", "not|real", NOV(28))).toMatchObject({ ok: false, status: 400, error: "not_on_the_ballot" });
    expect((await t.db.query(`select count(*)::int as n from recoupling_votes`)).rows[0]).toEqual({ n: 1 });

    const board = (await recouplingBoard(t.db, "fan-1", NOV(28)))!;
    expect(board.my_pick).toBe(two.id);
    expect(board.total).toBe(1);
    expect(board.runs_at).toBe("2026-11-30T20:20:00.000Z");
  });

  it("shows a countdown-only card before the vote opens", async () => {
    const board = await recouplingBoard(t.db, null, NOV(10));
    expect(board).toMatchObject({ night_at: "2026-11-30", choices: [], last: null });
  });
});

describe("the night (lib/recoupling.ts + lib/group-dates-run.ts)", () => {
  it("runs on the season's last night: one room, the cast seated, every rotation a house-paid speed date, the voted couple nudged", async () => {
    const [a, b, c, d] = cast();
    await airedDate("rc-1", a, b, 2);
    await airedDate("rc-2", c, d, 5);
    const row = (await ensureRecouplingVote(t.db, CLASSIC, NOV(28)))!;
    const coupleId = [a, b].sort().join("|");
    await voteRecoupling(t.db, "fan-1", coupleId, NOV(28));
    await voteRecoupling(t.db, "fan-2", coupleId, NOV(28));
    await voteRecoupling(t.db, "fan-3", row.choices[1].id, NOV(28));

    expect(await runDueRecoupling(t.db, NOV(29, 21))).toBeNull(); // not the night yet
    expect(await runDueRecoupling(t.db, NOV(30, 10))).toBeNull(); // the night, before the fill hour

    scriptOutcome({ ending: "friends" });
    scriptedModel(Array.from({ length: 4 }, () => episodeJson()));
    const run = await runDueRecoupling(t.db, NOV(30, 20));
    expect(run).toMatchObject({ ran: true, booked: 4, failed: 0, winner: coupleId });

    const night = (await t.db.query<{ id: string; theme: string; status: string }>(`select id, theme, status from group_nights where kind = 'mixer'`)).rows[0];
    expect(night).toMatchObject({ theme: "recoupling", status: "done" });
    const seats = (await t.db.query<{ character_id: string; house_fill: boolean }>(`select character_id, house_fill from group_night_seats where night_id = $1`, [night.id])).rows;
    expect(seats).toHaveLength(4);
    expect(seats.every((s) => s.house_fill)).toBe(true);

    // The audience's pick became a one-sided producer note on the voted couple's member, nobody else's.
    const notes = (await t.db.query<{ note: string | null }>(`select note from episodes where group_id = $1`, [night.id])).rows;
    expect(notes.filter((n) => n.note?.includes("couple in trouble"))).toHaveLength(1);

    // Once: the next hourly pass finds it claimed.
    expect(await runDueRecoupling(t.db, NOV(30, 21))).toMatchObject({ ran: false, reason: "already" });

    // The voters hear how it went, with the room to watch.
    const heard = (await t.db.query<{ user_id: string; kind: string; link: string }>(`select user_id, kind, link from notifications where kind = 'recoupling'`)).rows;
    expect(heard.map((h) => h.user_id).sort()).toEqual(["fan-1", "fan-2", "fan-3"]);
    expect(heard[0].link).toBe(`/mixers/${night.id}`);

    // The room bills itself as The Recoupling.
    const view = (await mixerNightView(t.db, night.id, null))!;
    expect(view.theme).toBe("recoupling");
  });

  it("an admin stages a night off-cycle, and it runs the same way", async () => {
    scriptOutcome({ ending: "friends" });
    scriptedModel(Array.from({ length: 4 }, () => episodeJson()));
    const run = await stageRecouplingNight(t.db, NOV(10, 15));
    expect(run).toMatchObject({ ran: true, booked: 4 });
    const night = (await t.db.query<{ theme: string }>(`select theme from group_nights where kind = 'mixer'`)).rows[0];
    expect(night.theme).toBe("recoupling");
    // Staying staged: the row is marked, and the season's real last night can still run its own.
    const row = (await t.db.query<{ staged: boolean; night_at: string }>(`select staged, night_at from recoupling_nights`)).rows[0];
    expect(row).toMatchObject({ staged: true, night_at: "2026-11-10" });
  });

  it("the island's final vote sends the audience's newcomer onto next season's cast", async () => {
    setSeasonFormatForTests("island");
    // Two candidates for December, checks passed, nobody reviewed them.
    const december = "2026-12-01";
    for (const [id, name] of [
      ["cand-a", "Vera Moss"],
      ["cand-b", "Juno Park"],
    ] as const) {
      await t.db.query(
        `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, appearance, avatar_hue, pronouns, voice, extras)
         values ($1, null, true, $2, 30, 'A newcomer with a story.', '["warm"]'::jsonb, 'a spark', 'liars', 'bright', 200, 'she/her', 'warm and quick', '{}'::jsonb)`,
        [id, name],
      );
      await t.db.query(`insert into season_candidates (character_id, season_id, archetype, portrait_asset, check_note) values ($1, $2, 'The newcomer', null, 'passed')`, [id, december]);
    }
    // The portrait bar: a candidate needs portrait_asset too, so give one a passed portrait row.
    await t.db.query(
      `insert into character_assets (id, character_id, kind, source_type, source_model, url, review_status) values ('asset-a', 'cand-a', 'portrait', 'generated', 'venice', 'data:image/png;base64,x', 'pending')`,
    );
    await t.db.query(`update season_candidates set portrait_asset = 'asset-a' where character_id = 'cand-a'`);

    const row = (await ensureRecouplingVote(t.db, seasonFormat("island"), NOV(28)))!;
    expect(row.question).toBe("newcomer");
    expect(row.choices.map((c) => c.id).sort()).toEqual(["cand-a", "cand-b"]);
    await voteRecoupling(t.db, "fan-1", "cand-a", NOV(28));

    scriptOutcome({ ending: "friends" });
    scriptedModel(Array.from({ length: 4 }, () => episodeJson()));
    const run = await runDueRecoupling(t.db, NOV(30, 21));
    expect(run).toMatchObject({ ran: true, winner: "cand-a" });
    const cand = (await t.db.query<{ status: string }>(`select status from season_candidates where character_id = 'cand-a'`)).rows[0];
    expect(cand.status).toBe("approved");
    // The unvoted candidate stays pending: nobody is auto-rejected by a vote.
    expect((await t.db.query<{ status: string }>(`select status from season_candidates where character_id = 'cand-b'`)).rows[0].status).toBe("pending");
  });
});

describe("/api/recoupling", () => {
  it("votes with the visitor's cookie and shows the board back", async () => {
    const [a, b, c, d] = cast();
    await airedDate("rc-1", a, b, 2);
    await airedDate("rc-2", c, d, 5);
    const row = (await ensureRecouplingVote(t.db, CLASSIC, NOV(28)))!;
    vi.useFakeTimers();
    vi.setSystemTime(NOV(28));
    try {
      const voted = await recouplingPost(jsonRequest("/api/recoupling", { pick: row.choices[0].id }));
      expect(voted.status).toBe(201);
      const cookie = voted.headers.get("set-cookie") ?? "";
      const res = await recouplingGet(new Request("http://localhost:3000/api/recoupling", { headers: { cookie: cookie.split(";")[0] } }));
      expect(res.status).toBe(200);
      const board = await res.json();
      expect(board.my_pick).toBe(row.choices[0].id);
      expect(board.total).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("forgets a viewer's recoupling votes with their account", async () => {
    const [a, b, c, d] = cast();
    await airedDate("rc-1", a, b, 2);
    await airedDate("rc-2", c, d, 5);
    const row = (await ensureRecouplingVote(t.db, CLASSIC, NOV(28)))!;
    await voteRecoupling(t.db, "fan-del", row.choices[0].id, NOV(28));
    const { deleteAccount } = await import("@/lib/account");
    await deleteAccount(t.db, "fan-del");
    expect((await t.db.query(`select 1 from recoupling_votes`)).rows).toHaveLength(0);
  });
});
