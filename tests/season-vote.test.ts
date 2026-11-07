// Next season's format, by the viewers (lib/season-vote.ts; David 2026-11-07): one vote a viewer for the season after
// the one running, a winner only past SEASON_VOTE_MIN votes, and the admin's pick always first.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/season-vote/route";
import { seasonFormatNow, seasonFormatSlug, setSeasonFormat } from "@/lib/season-format-store";
import { ballotSeasonId, ballotWinner, seasonBallot, SEASON_VOTE_MIN, voteSeasonFormat } from "@/lib/season-vote";
import { seasonIdOf } from "@/lib/season-window";
import { jsonRequest, newUserCookie, startTestDb } from "./helpers";

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

const NOV = (day: number) => new Date(Date.UTC(2026, 10, day, 12));
const DEC = seasonIdOf(new Date(Date.UTC(2026, 11, 5)));

describe("the ballot (lib/season-vote.ts)", () => {
  it("is for the season after the one running, and a second vote changes the first", async () => {
    expect(ballotSeasonId(NOV(5))).toBe(DEC);
    expect(await voteSeasonFormat(t.db, "u1", "last_standing", NOV(5))).toEqual({ ok: true, pick: "last_standing", season_id: DEC });
    await voteSeasonFormat(t.db, "u1", "ex_files", NOV(6));
    const rows = (await t.db.query(`select season_id, pick from season_format_votes`)).rows;
    expect(rows).toEqual([{ season_id: DEC, pick: "ex_files" }]);
  });

  it("refuses a format that isn't on the ballot", async () => {
    const r = await voteSeasonFormat(t.db, "u1", "mars_colony", NOV(5));
    expect(r).toMatchObject({ ok: false, status: 400, error: "not_on_the_ballot" });
  });

  it("needs SEASON_VOTE_MIN votes for a winner; ties go to the format listed first", () => {
    expect(ballotWinner(new Map([["island", SEASON_VOTE_MIN - 1]]))).toBeNull();
    expect(ballotWinner(new Map([["island", SEASON_VOTE_MIN]]))).toBe("island");
    expect(ballotWinner(new Map([["ex_files", 2], ["island", 2]]))).toBe("island");
    expect(ballotWinner(new Map([["ex_files", 3], ["island", 2]]))).toBe("ex_files");
  });

  it("shows the counts only once you've voted", async () => {
    await voteSeasonFormat(t.db, "u1", "sight_unseen", NOV(5));
    await voteSeasonFormat(t.db, "u2", "sight_unseen", NOV(5));
    await voteSeasonFormat(t.db, "u3", "island", NOV(5));
    const before = await seasonBallot(t.db, "u4", "classic", NOV(5));
    expect(before.total).toBe(0);
    expect(before.choices.every((c) => c.votes === 0)).toBe(true);
    expect(before.leading).toBeNull();
    const after = await seasonBallot(t.db, "u1", "classic", NOV(5));
    expect(after.my_pick).toBe("sight_unseen");
    expect(after.total).toBe(3);
    expect(after.leading).toBe("sight_unseen");
    expect(after.choices.find((c) => c.slug === "sight_unseen")!.votes).toBe(2);
    expect(after.season_label).toBe("December 2026");
  });
});

describe("the winner runs the next season (lib/season-format-store.ts)", () => {
  it("a season with no admin row runs its ballot's winner; under the minimum it's classic", async () => {
    await voteSeasonFormat(t.db, "u1", "meet_the_folks", NOV(5));
    await voteSeasonFormat(t.db, "u2", "meet_the_folks", NOV(5));
    expect(await seasonFormatSlug(t.db, DEC)).toBe("classic");
    await voteSeasonFormat(t.db, "u3", "meet_the_folks", NOV(5));
    expect(await seasonFormatSlug(t.db, DEC)).toBe("meet_the_folks");
    expect((await seasonFormatNow(t.db, new Date(Date.UTC(2026, 11, 3)))).slug).toBe("meet_the_folks");
    // November itself is untouched: its own ballot was cast in October.
    expect((await seasonFormatNow(t.db, NOV(20))).slug).toBe("classic");
  });

  it("the admin's pick wins over the ballot, classic included", async () => {
    for (const u of ["u1", "u2", "u3"]) await voteSeasonFormat(t.db, u, "ex_files", NOV(5));
    await setSeasonFormat(t.db, DEC, "island");
    expect(await seasonFormatSlug(t.db, DEC)).toBe("island");
    await setSeasonFormat(t.db, DEC, "classic");
    expect(await seasonFormatSlug(t.db, DEC)).toBe("classic");
  });
});

describe("/api/season-vote", () => {
  it("takes a vote and gives back the ballot with it", async () => {
    const cookie = newUserCookie();
    expect((await POST(jsonRequest("/api/season-vote", { pick: "island" }, { cookie }))).status).toBe(201);
    expect((await POST(jsonRequest("/api/season-vote", { pick: "nope" }, { cookie }))).status).toBe(400);
    const get = await GET(new Request("http://localhost:3000/api/season-vote", { headers: { cookie } }));
    const body = await get.json();
    expect(body.my_pick).toBe("island");
    expect(body.choices).toHaveLength(6);
  });
});
