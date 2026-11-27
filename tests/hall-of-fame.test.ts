import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { championLine, hallForAgents, hallOfFame, SHARPEST_MIN_CALLS } from "@/lib/hall-of-fame";
import { handleMcpMessage } from "@/lib/mcp";
import { closedSeasons } from "@/lib/season-ref";
import { startTestDb } from "./helpers";

// The Hall of Fame (lib/hall-of-fame.ts): all-time records from what the show already records, public rules kept.
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

const NOW = new Date("2026-12-15T12:00:00Z");

async function character(id: string, name: string, opts: { owner?: string; visibility?: string; house?: boolean } = {}) {
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility, open_to_dates)
     values ($1, $2, $3, $4, 30, 'b', '["a","b","c"]'::jsonb, 'w', 'd', $5, true)`,
    [id, opts.owner ?? `owner-${id}`, opts.house ?? false, name, opts.visibility ?? "public"],
  );
}

async function aired(a: string, b: string, ending: "second_date" | "friends" | "disaster", visibility = "public"): Promise<string> {
  const id = randomUUID();
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, status, visibility)
     values ($1, 'creator', $2, $3, 'a pier', '[]'::jsonb, '[]'::jsonb, '', '', $4, $5, 'ready', $6)`,
    [id, a, b, ending, new Date("2026-11-10T20:00:00Z").toISOString(), visibility],
  );
  return id;
}

async function couple(a: string, b: string, dates: number, seconds: number) {
  const [x, y] = a < b ? [a, b] : [b, a];
  await t.db.query(`insert into relationships (character_a, character_b, dates, second_dates, public_dates, public_second_dates) values ($1, $2, $3, $4, $3, $4)`, [x, y, dates, seconds]);
}

async function seed() {
  await character("ada", "Ada Lune");
  await character("bo", "Bo Fennick");
  await character("cy", "Cy Marlow", { visibility: "private" });
  await character("gone", "Gone Test", { owner: "deleted" });
  const season = closedSeasons(NOW)[0]!;
  await t.db.query(
    `insert into ceremonies (season_id, held_on, week, lead_id, choices, finale, final_rose) values ($1, '2026-11-29', 4, 'ada', '[]'::jsonb, true, 'bo')`,
    [season.id],
  );
  await t.db.query(
    `insert into season_recaps (season_id, data, frozen_at) values ($1, $2::jsonb, now())`,
    [season.id, JSON.stringify({ golden: { a: { id: "ada" }, b: { id: "bo" }, dates: 3, second_dates: 2 } })],
  );
  await t.db.query(
    `insert into season_awards (season_id, award, title, character_id) values ($1, 'charm', 'Most charming', 'bo'), ($1, 'chaos', 'Biggest disaster', 'bo'), ($1, 'fan', 'Fan favourite', 'gone')`,
    [season.id],
  );
  await couple("ada", "bo", 3, 2);
  await couple("cy", "ada", 2, 0);
  await couple("gone", "bo", 5, 0);
  const e1 = await aired("ada", "bo", "second_date");
  const e2 = await aired("ada", "bo", "second_date");
  await aired("ada", "cy", "friends");
  await aired("gone", "bo", "disaster");
  await aired("gone", "bo", "disaster");
  await aired("gone", "bo", "disaster");
  await aired("ada", "bo", "friends", "private");
  await t.db.query(`insert into profiles (user_id, name) values ('caller-1', 'Rosa')`);
  await t.db.query(`insert into predictions (episode_id, user_id, pick) values ($1, 'caller-1', 'second_date'), ($2, 'caller-1', 'second_date'), ($1, 'caller-2', 'friends'), ($2, 'caller-2', 'second_date')`, [e1, e2]);
  return season;
}

describe("the Hall of Fame", () => {
  it("names each closed season's final rose and golden couple", async () => {
    const season = await seed();
    const h = await hallOfFame(t.db, NOW);
    const first = h.champions.find((c) => c.season.id === season.id)!;
    expect(first.final_rose?.lead.name).toBe("Ada Lune");
    expect(first.final_rose?.winner.name).toBe("Bo Fennick");
    expect([first.golden?.a.id, first.golden?.b.id]).toEqual(["ada", "bo"]);
    expect(championLine(first)).toContain("Ada Lune gave the final rose to Bo Fennick; golden couple Ada Lune × Bo Fennick");
  });

  it("never lists a deleted account's character, and names a private one without a face", async () => {
    await seed();
    const h = await hallOfFame(t.db, NOW);
    expect(h.most_awarded.map((r) => [r.character.id, r.awards])).toEqual([["bo", 2]]);
    expect(h.longest_couples.map((r) => [r.a.id, r.b.id, r.dates])).toEqual([
      ["ada", "bo", 3],
      ["ada", "cy", 2],
    ]);
    const cy = h.longest_couples[1]!.b;
    expect(cy).toMatchObject({ name: "Cy Marlow", private: true, portrait: null });
    expect(h.most_dates.some((r) => r.character.id === "gone")).toBe(false);
  });

  it("counts only dates that aired publicly", async () => {
    await seed();
    const h = await hallOfFame(t.db, NOW);
    // Ada: two second dates with Bo and one with Cy aired publicly; the private one doesn't count.
    expect(h.most_dates.find((r) => r.character.id === "ada")).toMatchObject({ dates: 3, second_dates: 2 });
    expect(h.numbers).toMatchObject({ dates_aired: 6, second_dates: 2, calls: 4 });
  });

  it("ranks callers by right calls, by display name only, and keeps the sharpest board for regulars", async () => {
    await seed();
    const h = await hallOfFame(t.db, NOW);
    expect(h.best_callers).toEqual([
      { name: "Rosa", right: 2, called: 2, accuracy: 100 },
      { name: null, right: 1, called: 2, accuracy: 50 },
    ]);
    expect(h.sharpest_callers).toEqual([]);
    expect(SHARPEST_MIN_CALLS).toBeGreaterThan(2);
    expect(JSON.stringify(hallForAgents(h))).not.toContain("caller-");
  });

  it("is an MCP tool anyone can call", async () => {
    await seed();
    const reply = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_hall_of_fame", arguments: {} } }, {});
    const r = (reply as { result: { isError?: boolean; structuredContent: unknown } }).result;
    expect(r.isError).toBeFalsy();
    const s = r.structuredContent as { best_callers: { name: string }[]; note: string };
    expect(s.best_callers.map((c) => c.name)).toEqual(["Rosa", "A viewer"]);
    expect(s.note).toContain("hall-of-fame");
  });

  it("is empty, not broken, before anything has happened", async () => {
    const h = await hallOfFame(t.db, NOW);
    expect(h.most_awarded).toEqual([]);
    expect(h.best_callers).toEqual([]);
    expect(h.champions.every((c) => c.final_rose === null && c.golden === null)).toBe(true);
  });
});
