import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as adminTournaments } from "@/app/api/admin/tournaments/route";
import { showCalendar } from "@/lib/events-calendar";
import { hallOfFame } from "@/lib/hall-of-fame";
import { handleMcpMessage } from "@/lib/mcp";
import { bracketOrder, createTournament, roundName, tournamentView, voteTournament } from "@/lib/tournaments";
import { startTestDb } from "./helpers";

// Tournaments (lib/tournaments.ts): an audience-voted bracket computed from the votes and the clock.
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

const START = new Date("2026-12-05T20:00:00Z");
const H = 60 * 60 * 1000;
const at = (hours: number) => new Date(START.getTime() + hours * H);

async function character(id: string, opts: { owner?: string; visibility?: string } = {}) {
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility, open_to_dates)
     values ($1, $2, false, $3, 30, 'b', '["a","b","c"]'::jsonb, 'w', 'd', $4, true)`,
    [id, opts.owner ?? `owner-${id}`, `Char ${id.toUpperCase()}`, opts.visibility ?? "public"],
  );
}

/** A 4-character bracket: seeds 1–4 are a, b, c, d; 24-hour rounds from START. */
async function fourBracket(): Promise<string> {
  for (const id of ["a", "b", "c", "d"]) await character(id);
  const r = await createTournament(t.db, { title: "The December Bracket", size: 4, starts_at: START.toISOString(), round_hours: 24, character_ids: ["a", "b", "c", "d"] }, "admin");
  if (!r.ok) throw new Error(r.reason);
  return r.id;
}

describe("the bracket", () => {
  it("seeds so the top two can only meet in the final", () => {
    expect(bracketOrder(4)).toEqual([1, 4, 2, 3]);
    expect(bracketOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(roundName(2, 2)).toBe("The final");
    expect(roundName(1, 3)).toBe("Quarter-finals");
  });

  it("runs on the clock: waiting, open, then decided by the votes, a tie to the better seed", async () => {
    const id = await fourBracket();
    expect((await tournamentView(t.db, id, null, at(-1)))!.status).toBe("upcoming");
    // Round 1: a (1) v d (4), b (2) v c (3).
    expect(await voteTournament(t.db, "v1", id, 1, "d", at(1))).toMatchObject({ ok: true, votes: { a: 0, b: 1 } });
    await voteTournament(t.db, "v2", id, 1, "d", at(2));
    await voteTournament(t.db, "v3", id, 1, "a", at(3));
    await voteTournament(t.db, "v1", id, 2, "c", at(1));
    await voteTournament(t.db, "v2", id, 2, "b", at(1));
    const mid = (await tournamentView(t.db, id, "v4", at(4)))!;
    expect(mid.rounds[0]!.state).toBe("open");
    // Counts stay hidden until you vote.
    expect(mid.rounds[0]!.matches[0]!.votes).toBeNull();
    const r2 = (await tournamentView(t.db, id, null, at(25)))!;
    expect(r2.rounds[0]!.matches.map((m) => m.winner?.id)).toEqual(["d", "b"]);
    expect(r2.rounds[1]!.matches[0]).toMatchObject({ state: "open", a: { id: "d" }, b: { id: "b" } });
    await voteTournament(t.db, "v1", id, 1, "d", at(26));
    const done = (await tournamentView(t.db, id, null, at(49)))!;
    expect(done.status).toBe("finished");
    expect(done.champion?.id).toBe("d");
  });

  it("takes one vote a voter a match, changeable while open, never for your own, never once closed", async () => {
    const id = await fourBracket();
    await voteTournament(t.db, "v1", id, 1, "a", at(1));
    expect(await voteTournament(t.db, "v1", id, 1, "d", at(2))).toMatchObject({ ok: true, votes: { a: 0, b: 1 } });
    expect(await voteTournament(t.db, "owner-a", id, 1, "d", at(2))).toMatchObject({ ok: false, error: "own_character" });
    expect(await voteTournament(t.db, "v1", id, 1, "b", at(2))).toMatchObject({ ok: false, error: "not_in_match" });
    expect(await voteTournament(t.db, "v1", id, 9, "a", at(2))).toMatchObject({ ok: false, error: "no_such_match" });
    expect(await voteTournament(t.db, "v1", id, 1, "a", at(-1))).toMatchObject({ ok: false, error: "not_open_yet" });
    expect(await voteTournament(t.db, "v1", id, 1, "a", at(100))).toMatchObject({ ok: false, error: "voting_closed" });
  });
});

describe("making one", () => {
  it("refuses a private character, a repeat, or the wrong count", async () => {
    for (const id of ["a", "b", "c"]) await character(id);
    await character("p", { visibility: "private" });
    const base = { title: "Bad", size: 4 as const, starts_at: START.toISOString() };
    expect(await createTournament(t.db, { ...base, character_ids: ["a", "b", "c", "p"] }, "x")).toEqual({ ok: false, reason: expect.stringContaining("p") });
    expect(await createTournament(t.db, { ...base, character_ids: ["a", "b", "c", "a"] }, "x")).toEqual({ ok: false, reason: expect.stringContaining("once") });
    expect(await createTournament(t.db, { ...base, character_ids: ["a", "b", "c"] }, "x")).toEqual({ ok: false, reason: expect.stringContaining("needs 4") });
  });

  it("is admin-only over the API", async () => {
    const res = await adminTournaments(new Request("http://localhost:3000/api/admin/tournaments", { method: "POST", body: JSON.stringify({ action: "create", title: "X", starts_at: START.toISOString() }) }));
    expect(res.status).toBe(403);
  });
});

describe("around the show", () => {
  it("goes on the calendar, and its champion on the Hall of Fame", async () => {
    const id = await fourBracket();
    const cal = await showCalendar(t.db, at(-48), 10, {});
    expect(cal.events.filter((e) => e.kind === "tournament").map((e) => e.id)).toEqual([`tournament:${id}:1`, `tournament:${id}:2`]);
    await voteTournament(t.db, "v1", id, 1, "d", at(1));
    const hall = await hallOfFame(t.db, at(100));
    expect(hall.tournament_champions.map((x) => [x.title, x.champion.id])).toEqual([["The December Bracket", "b"]]);
  });

  it("agents read the bracket and vote over MCP", async () => {
    const id = await fourBracket();
    // A real clock is used over MCP, so this bracket starts now.
    await t.db.query(`update tournaments set starts_at = now() - interval '1 hour' where id = $1`, [id]);
    const rpc = async (name: string, args: Record<string, unknown>, ctx = {}) =>
      ((await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx)) as { result: { isError?: boolean; structuredContent: Record<string, unknown>; content: { text: string }[] } }).result;
    const view = await rpc("get_tournament", {});
    expect(view.structuredContent).toMatchObject({ id, status: "running" });
    expect(String(view.structuredContent.how_to_vote)).toContain("vote_tournament");
    const ctx = {};
    const vote = await rpc("vote_tournament", { match: 1, pick: "a" }, ctx);
    expect(vote.isError, vote.content?.[0]?.text).toBeFalsy();
    expect(vote.structuredContent).toMatchObject({ tournament_id: id, your_pick: "a", votes: { a: 1, b: 0 } });
  });
});
