import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deleteAccount } from "@/lib/account";
import { CLUBS_PER_CHARACTER, clubsOf, clubView, foundClub, joinClub, leaveClub, listClubs, readClub } from "@/lib/clubs";
import { handleMcpMessage } from "@/lib/mcp";
import { startTestDb } from "./helpers";

// Clubs (lib/clubs.ts): characters band together, and each season the clubs race on their members' public dates.
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

async function character(id: string, owner: string, visibility = "public") {
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility, open_to_dates)
     values ($1, $2, false, $3, 30, 'b', '["a","b","c"]'::jsonb, 'w', 'd', $4, true)`,
    [id, owner, `Char ${id}`, visibility],
  );
}
async function aired(a: string, b: string, ending: string) {
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, status, visibility)
     values ($1, 'x', $2, $3, 'pier', '[]'::jsonb, '[]'::jsonb, '', '', $4, now(), 'ready', 'public')`,
    [randomUUID(), a, b, ending],
  );
}

describe("clubs", () => {
  it("are founded by a public character, joined by others, and close when empty", async () => {
    await character("ada", "alice");
    await character("bo", "bob");
    await character("priv", "bob", "private");
    const f = await foundClub(t.db, "alice", { character_id: "ada", name: "The Late Arrivals", motto: "Fashionably late.", emoji: "🌙" });
    if (!f.ok) throw new Error(f.error);
    expect(await foundClub(t.db, "bob", { character_id: "bo", name: "the late arrivals" })).toMatchObject({ ok: false, code: "name_taken" });
    expect(await joinClub(t.db, "bob", f.id, "priv")).toMatchObject({ ok: false, code: "private" });
    expect(await joinClub(t.db, "alice", f.id, "bo")).toMatchObject({ ok: false, code: "not_your_character" });
    expect(await joinClub(t.db, "bob", f.id, "bo")).toEqual({ ok: true, members: 2 });
    expect(await joinClub(t.db, "bob", f.id, "bo")).toMatchObject({ ok: false, code: "already_in" });
    const v = (await clubView(t.db, f.id, "bob"))!;
    expect(v.members.map((m) => [m.id, m.founder, m.yours ?? false])).toEqual([
      ["ada", true, false],
      ["bo", false, true],
    ]);
    expect((await clubsOf(t.db, "bo")).map((c) => c.name)).toEqual(["The Late Arrivals"]);
    await leaveClub(t.db, "bob", f.id, "bo");
    expect(await leaveClub(t.db, "alice", f.id, "ada")).toEqual({ ok: true, closed: true });
    expect(await listClubs(t.db)).toEqual([]);
  });

  it("checks names and keeps a character to a few clubs", async () => {
    expect(readClub({ name: "ab" })).toMatchObject({ ok: false, code: "name" });
    expect(readClub({ name: "Visit club.com" })).toMatchObject({ ok: false, code: "link" });
    await character("ada", "alice");
    for (let i = 0; i < CLUBS_PER_CHARACTER; i++) expect((await foundClub(t.db, "alice", { character_id: "ada", name: `Club number ${i}` })).ok).toBe(true);
    await character("cy", "cara");
    const other = await foundClub(t.db, "cara", { character_id: "cy", name: "Another one" });
    if (!other.ok) throw new Error(other.error);
    expect(await joinClub(t.db, "alice", other.id, "ada")).toMatchObject({ ok: false, code: "too_many_clubs" });
  });

  it("race on this season's public dates, second dates first", async () => {
    for (const [id, owner] of [["ada", "alice"], ["bo", "bob"], ["cy", "cara"], ["di", "dan"]] as const) await character(id, owner);
    const a = await foundClub(t.db, "alice", { character_id: "ada", name: "Second Yes Society" });
    const b = await foundClub(t.db, "cara", { character_id: "cy", name: "Many Dates Guild" });
    if (!a.ok || !b.ok) throw new Error("found");
    await aired("ada", "bo", "second_date");
    await aired("cy", "di", "friends");
    await aired("cy", "bo", "disaster");
    const board = await listClubs(t.db);
    expect(board.map((c) => [c.name, c.place, c.season.second_dates, c.season.dates])).toEqual([
      ["Second Yes Society", 1, 1, 1],
      ["Many Dates Guild", 2, 0, 2],
    ]);
  });

  it("forget who founded one when that account goes, and the club stays", async () => {
    await character("ada", "alice");
    await character("bo", "bob");
    const f = await foundClub(t.db, "alice", { character_id: "ada", name: "Stays Open" });
    if (!f.ok) throw new Error(f.error);
    await joinClub(t.db, "bob", f.id, "bo");
    await deleteAccount(t.db, "alice");
    expect((await t.db.query(`select created_by from clubs where id = $1`, [f.id])).rows[0]).toEqual({ created_by: "deleted" });
    expect((await clubView(t.db, f.id, null))?.members.map((m) => m.id)).toEqual(["bo"]);
  });

  it("list over MCP for anyone", async () => {
    await character("ada", "alice");
    await foundClub(t.db, "alice", { character_id: "ada", name: "Open Book Club" });
    const r = ((await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_clubs", arguments: {} } }, {})) as { result: { isError?: boolean; structuredContent: { clubs: { name: string }[] } } }).result;
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.clubs.map((c) => c.name)).toEqual(["Open Book Club"]);
  });
});
