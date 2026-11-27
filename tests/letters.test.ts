import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deleteAccount } from "@/lib/account";
import { LETTERS_PER_DAY, listLetters, markLettersRead, penPals, POST_HOURS, readLetter, sendLetter } from "@/lib/letters";
import { handleMcpMessage } from "@/lib/mcp";
import { startTestDb } from "./helpers";

// Letters (lib/letters.ts): slow mail between characters who've met, read only by their two owners.
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

const NOW = new Date("2026-12-03T10:00:00Z");
const later = (hours: number) => new Date(NOW.getTime() + hours * 60 * 60 * 1000);
const BODY = "Dear Bo,\n\nI keep thinking about the pier. Write back when the tide lets you.";

async function character(id: string, owner: string, opts: { house?: boolean } = {}) {
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility, open_to_dates)
     values ($1, $2, $3, $4, 30, 'b', '["a","b","c"]'::jsonb, 'w', 'd', 'public', true)`,
    [id, owner, opts.house ?? false, `Char ${id}`],
  );
}
async function met(a: string, b: string) {
  const [x, y] = a < b ? [a, b] : [b, a];
  await t.db.query(`insert into relationships (character_a, character_b, dates) values ($1, $2, 1)`, [x, y]);
}

async function cast() {
  await character("ada", "alice");
  await character("bo", "bob");
  await character("cy", "cara");
  await character("house1", "house", { house: true });
  await met("ada", "bo");
  await met("ada", "house1");
}

describe("sending", () => {
  it("goes only to a character yours has dated, owned by someone else, not the house", async () => {
    await cast();
    expect((await penPals(t.db, "alice", "ada")).map((p) => p.id)).toEqual(["bo"]);
    expect(await sendLetter(t.db, "alice", { from_character: "ada", to_character: "cy", body: BODY }, NOW)).toMatchObject({ ok: false, code: "not_met" });
    expect(await sendLetter(t.db, "alice", { from_character: "ada", to_character: "house1", body: BODY }, NOW)).toMatchObject({ ok: false, code: "house" });
    expect(await sendLetter(t.db, "bob", { from_character: "ada", to_character: "bo", body: BODY }, NOW)).toMatchObject({ ok: false, code: "not_your_character" });
    expect(await sendLetter(t.db, "alice", { from_character: "ada", to_character: "bo", body: BODY }, NOW)).toMatchObject({ ok: true });
  });

  it("is checked: long enough, no links, PG", () => {
    expect(readLetter("hi")).toMatchObject({ ok: false, code: "too_short" });
    expect(readLetter("Come and find me at www.example.com tonight, my love.")).toMatchObject({ ok: false, code: "link" });
    expect(readLetter("Dear Bo,\n\n\n\nsee   you soon, and bring the map.")).toEqual({ ok: true, body: "Dear Bo,\n\nsee you soon, and bring the map." });
  });

  it("stops after a block either way, and after a few a day", async () => {
    await cast();
    const ep = crypto.randomUUID();
    await t.db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, status, visibility) values ($1, 'alice', 'ada', 'bo', 'x', '[]'::jsonb, '[]'::jsonb, '', '', 'friends', 'ready', 'public')`,
      [ep],
    );
    for (let i = 0; i < LETTERS_PER_DAY; i++) expect((await sendLetter(t.db, "alice", { from_character: "ada", to_character: "bo", body: BODY }, later(i))).ok).toBe(true);
    expect(await sendLetter(t.db, "alice", { from_character: "ada", to_character: "bo", body: BODY }, later(4))).toMatchObject({ ok: false, code: "daily_limit" });
    await t.db.query(`insert into blocks (blocker_id, via_episode_id, blocked_id) values ('bob', $1, 'alice')`, [ep]);
    expect(await sendLetter(t.db, "alice", { from_character: "ada", to_character: "bo", body: BODY }, later(30))).toMatchObject({ ok: false, code: "not_met" });
  });
});

describe("arriving", () => {
  it("arrives hours later, for the recipient's owner only, and can be answered", async () => {
    await cast();
    const sent = await sendLetter(t.db, "alice", { from_character: "ada", to_character: "bo", body: BODY }, NOW);
    if (!sent.ok) throw new Error(sent.error);
    expect((await listLetters(t.db, "bob", {}, later(1))).letters).toEqual([]);
    expect((await listLetters(t.db, "alice", {}, later(1))).letters[0]).toMatchObject({ box: "out", delivered: false });
    const arrived = await listLetters(t.db, "bob", {}, later(POST_HOURS));
    expect(arrived.unread).toBe(1);
    expect(arrived.letters[0]).toMatchObject({ box: "in", from: { id: "ada" }, body: BODY, read: false });
    expect((await listLetters(t.db, "cara", {}, later(POST_HOURS))).letters).toEqual([]);
    expect(await markLettersRead(t.db, "bob", null, later(POST_HOURS))).toBe(1);
    const reply = await sendLetter(t.db, "bob", { from_character: "bo", to_character: "ada", body: "Dear Ada, the tide says yes. Same pier, Friday?", reply_to: sent.letter.id }, later(POST_HOURS + 1));
    expect(reply).toMatchObject({ ok: true, letter: { reply_to: sent.letter.id } });
    // Not a reply to a letter that hasn't arrived for you.
    expect(await sendLetter(t.db, "alice", { from_character: "ada", to_character: "bo", body: BODY, reply_to: sent.letter.id }, later(POST_HOURS + 1))).toMatchObject({ ok: false, code: "reply_to" });
  });

  it("goes with either account when it's deleted", async () => {
    await cast();
    await sendLetter(t.db, "alice", { from_character: "ada", to_character: "bo", body: BODY }, NOW);
    await deleteAccount(t.db, "bob");
    expect((await t.db.query(`select count(*)::int as n from letters`)).rows[0]).toEqual({ n: 0 });
  });

  it("works over MCP for an agent's characters", async () => {
    await cast();
    const rpc = async (name: string, args: Record<string, unknown>) =>
      ((await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, {})) as { result: { isError?: boolean; content: { text: string }[]; structuredContent: Record<string, unknown> } }).result;
    const refused = await rpc("send_letter", { character_id: "ada", to_character_id: "bo", body: BODY });
    expect(refused.isError).toBe(true);
    const list = await rpc("read_letters", {});
    expect(list.isError, list.content?.[0]?.text).toBeFalsy();
    expect(list.structuredContent).toMatchObject({ letters: [], unread: 0 });
  });
});
