/**
 * Character tags (lib/character-tags.ts, lib/character-tags-shared.ts, docs/tags.md): read from the traits, the
 * house's by hand, an owner's pick over both, keyed to the character and gone with it; status from the public graph
 * only; the directory, companions, the export and MCP carry them.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { exportAccount } from "@/lib/account";
import { characterStatuses, characterTags, fillCharacterTags, HOUSE_TAGS, refreshAutoTags, setOwnerTags, statusSql } from "@/lib/character-tags";
import { autoTags, CHARACTER_TAG_IDS, CHARACTER_TAGS_MAX, isCharacterTag, parseOwnerTags, shownTags } from "@/lib/character-tags-shared";
import { listCompanions } from "@/lib/companion";
import { searchDirectory } from "@/lib/directory";
import { HOUSE_CHARACTERS, PREMIUM_HOUSE_CHARACTERS } from "@/lib/house";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { api, newUserCookie, startTestDb, userIdOf, validCharacter } from "./helpers";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.unstubAllEnvs();
});

async function makeCharacter(cookie: string, overrides: Record<string, unknown> = {}): Promise<{ status: number; body: Any }> {
  const res = await api.createCharacter(validCharacter({ name: `Tag Test ${Math.random().toString(36).slice(2, 7)}`, ...overrides }), cookie);
  return { status: res.status, body: await res.json() };
}

/** A public (aired) pair at this stage, or a private one (only the all-layer columns set). */
async function pair(a: string, b: string, stage: string, opts: { private?: boolean } = {}) {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  await t.db.query(
    `insert into relationships (character_a, character_b, dates, stage, shown_stage, public_stage, public_shown_stage) values ($1, $2, 1, $3, $3, $4, $4)`,
    [lo, hi, stage, opts.private ? null : stage],
  );
}

describe("reading tags from a character's own words", () => {
  it("reads types from traits, and only plain nouns from a bio", () => {
    expect(autoTags({ traits: ["Stoic", "bookish", "warm"] })).toEqual(["cold", "nerd", "sweet"]);
    expect(autoTags({ traits: ["dry", "patient", "odd"], bio: "A vampire who runs a night bakery." })).toEqual(["not_human"]);
    // Everyday words in a bio never tag anyone ("the kind of person who…").
    expect(autoTags({ traits: ["dry", "patient", "odd"], bio: "The kind of person who is warm to strangers." })).toEqual([]);
    expect(autoTags({ traits: ["grumpy", "gruff", "loyal"] })[0]).toBe("grump");
    expect(autoTags({ traits: ["charming", "playful", "romantic", "loyal"] }).length).toBeLessThanOrEqual(3);
  });

  it("only ever gives type tags, and refuses an owner's unknown or too many", () => {
    for (const id of CHARACTER_TAG_IDS) expect(isCharacterTag(id)).toBe(true);
    expect(isCharacterTag("rivals")).toBe(false); // a setup belongs to a pair
    expect(isCharacterTag("dom_sub")).toBe(false); // After Dark's own, never the show's
    expect(parseOwnerTags(["Cold", "cold", "nerd"])).toEqual({ ok: true, tags: ["cold", "nerd"] });
    const bad = parseOwnerTags(["cold", "rivals"]);
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toContain("rivals");
    expect(!bad.ok && bad.error).toContain("hard_to_get");
    expect(parseOwnerTags(CHARACTER_TAG_IDS.slice(0, CHARACTER_TAGS_MAX + 1)).ok).toBe(false);
    expect(shownTags([{ tag: "nerd", source: "auto" }, { tag: "cold", source: "owner" }])).toEqual(["cold"]);
  });

  it("hand-tags the house's own cast with type tags", () => {
    const ids = new Set([...HOUSE_CHARACTERS, ...PREMIUM_HOUSE_CHARACTERS].map((c) => c.id));
    for (const [id, tags] of Object.entries(HOUSE_TAGS)) {
      expect(ids.has(id), id).toBe(true);
      expect(tags.length, id).toBeGreaterThan(0);
      expect(tags.length, id).toBeLessThanOrEqual(CHARACTER_TAGS_MAX);
      for (const tag of tags) expect(isCharacterTag(tag), `${id}: ${tag}`).toBe(true);
    }
  });
});

describe("the table", () => {
  it("fills the house's hand tags and everyone's read, once, then leaves an owner's pick alone", async () => {
    const cookie = newUserCookie();
    const { body } = await makeCharacter(cookie, { traits: ["stoic", "bookish", "kind"] });
    await t.db.query(`delete from character_tags`);
    expect(await fillCharacterTags(t.db)).toBeGreaterThan(0);
    const tags = await characterTags(t.db, [body.id, "house-wally"]);
    expect(tags.get("house-wally")).toEqual({ tags: ["cold", "loyal", "protective"], source: "house" });
    expect(tags.get(body.id)).toEqual({ tags: ["cold", "nerd", "sweet"], source: "auto" });
    expect(await fillCharacterTags(t.db)).toBe(0);

    expect(await setOwnerTags(t.db, body.id, ["sunshine"])).toEqual({ ok: true, tags: ["sunshine"] });
    await refreshAutoTags(t.db, body.id);
    expect((await characterTags(t.db, [body.id])).get(body.id)).toEqual({ tags: ["sunshine"], source: "owner" });
    // An empty pick hands them back to the read.
    expect(await setOwnerTags(t.db, body.id, [])).toEqual({ ok: true, tags: ["cold", "nerd", "sweet"] });
  });

  it("goes with its character", async () => {
    const cookie = newUserCookie();
    const { body } = await makeCharacter(cookie, { tags: ["grump"] });
    expect((await t.db.query(`select 1 from character_tags where character_id = $1`, [body.id])).rows.length).toBe(1);
    await t.db.query(`delete from characters where id = $1`, [body.id]);
    expect((await t.db.query(`select 1 from character_tags where character_id = $1`, [body.id])).rows.length).toBe(0);
  });
});

describe("the character routes", () => {
  it("takes an owner's tags on create and edit, reads them otherwise, and refuses unknown ones before saving", async () => {
    const cookie = newUserCookie();
    const picked = await makeCharacter(cookie, { tags: ["takes_charge", "flirt"] });
    expect(picked.status).toBe(201);
    expect(picked.body.tags).toEqual(["takes_charge", "flirt"].sort((a, b) => CHARACTER_TAG_IDS.indexOf(a as never) - CHARACTER_TAG_IDS.indexOf(b as never)));

    const read = await makeCharacter(cookie, { traits: ["gruff", "loyal", "quiet"] });
    expect(read.body.tags).toContain("grump");

    const before = (await t.db.query(`select count(*)::int as n from characters`)).rows[0] as { n: number };
    const bad = await makeCharacter(cookie, { tags: ["rivals"] });
    expect(bad.status).toBe(400);
    expect(bad.body.field).toBe("tags");
    expect(((await t.db.query(`select count(*)::int as n from characters`)).rows[0] as { n: number }).n).toBe(before.n);

    // Edit: a new pick replaces; new traits are read again only while nobody picked; [] hands them back.
    const edited = await api.editCharacter(read.body.id, { tags: ["nerd"] }, cookie);
    expect(edited.status).toBe(200);
    expect((await edited.json()).tags).toEqual(["nerd"]);
    await api.editCharacter(read.body.id, { traits: ["cheerful", "bubbly", "kind"] }, cookie);
    expect((await characterTags(t.db, [read.body.id])).get(read.body.id)?.tags).toEqual(["nerd"]);
    await api.editCharacter(read.body.id, { tags: [] }, cookie);
    expect((await characterTags(t.db, [read.body.id])).get(read.body.id)).toMatchObject({ source: "auto" });
    expect((await characterTags(t.db, [read.body.id])).get(read.body.id)?.tags).toContain("sunshine");
  });

  it("exports a person's characters with their tags and whose they are", async () => {
    const cookie = newUserCookie();
    const { body } = await makeCharacter(cookie, { tags: ["moody"] });
    const out = (await exportAccount(t.db, userIdOf(cookie))) as Any;
    const mine = out.characters.find((c: Any) => c.id === body.id);
    expect(mine.tags).toEqual([{ tag: "moody", source: "owner" }]);
  });
});

describe("status, from the public graph only", () => {
  it("is the most committed public stage, and a private date never counts", async () => {
    const cookie = newUserCookie();
    const a = (await makeCharacter(cookie)).body.id;
    const b = (await makeCharacter(cookie)).body.id;
    const c = (await makeCharacter(cookie)).body.id;
    const d = (await makeCharacter(cookie)).body.id;
    await pair(a, b, "sparks");
    await pair(a, c, "going_steady");
    await pair(c, d, "married", { private: true });
    const statuses = await characterStatuses(t.db, [a, b, c, d]);
    expect(Object.fromEntries(statuses)).toEqual({ [a]: "taken", [b]: "seeing", [c]: "taken", [d]: "single" });
    // The SQL reads the same as the code.
    const { rows } = await t.db.query<{ id: string; status: string }>(`select c.id, ${statusSql("c.id")} as status from characters c where c.id = any($1)`, [[a, b, c, d]]);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.status]))).toEqual(Object.fromEntries(statuses));
  });
});

describe("finding people by tag", () => {
  it("narrows /characters by type and love life, with or without words", async () => {
    const cookie = newUserCookie();
    const grump = (await makeCharacter(cookie, { name: "Gus Grumbleton", tags: ["grump"] })).body.id;
    const sunny = (await makeCharacter(cookie, { name: "Sol Brightly", tags: ["sunshine"] })).body.id;
    await t.db.query(`update characters set visibility = 'public'`);
    await pair(grump, sunny, "dating");
    const byType = await searchDirectory(t.db, "", 48, { type: "grump" });
    expect(byType.entries.map((e) => e.id)).toContain(grump);
    expect(byType.entries.map((e) => e.id)).not.toContain(sunny);
    expect(byType.entries.find((e) => e.id === grump)?.tags).toEqual(["grump"]);
    const seeing = await searchDirectory(t.db, "", 48, { status: "seeing" });
    expect(seeing.entries.map((e) => e.id).sort()).toEqual([grump, sunny].sort());
    expect((await searchDirectory(t.db, "Brightly", 48, { type: "grump" })).entries).toEqual([]);
    expect((await searchDirectory(t.db, "", 48, {})).entries).toEqual([]);
  });

  it("gives the companions list each one's tags and love life", async () => {
    await fillCharacterTags(t.db);
    const { cast } = await listCompanions(t.db, "someone");
    const wally = cast.find((c) => c.id === "house-wally");
    expect(wally?.tags).toEqual(["cold", "loyal", "protective"]);
    expect(wally?.status).toBe("single");
  });
});

describe("over MCP (2.36.0)", () => {
  const rpc = async (method: string, params: Any, c: McpContext): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, c);
  const call = async (name: string, args: Any, c: McpContext): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, c)).result;
  const data = (r: Any): Any => JSON.parse(r.content[0].text);

  it("reads tags and love life, and searches by them", async () => {
    await fillCharacterTags(t.db);
    const c: McpContext = {};
    await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "tags-test" } }, c);
    const ctx = { sessionId: c.issuedSessionId };
    const got = data(await call("get_character", { character_id: "house-wally" }, ctx));
    expect(got).toMatchObject({ tags: ["cold", "loyal", "protective"], tags_from: "house", love_life: "single" });
    const found = data(await call("search_characters", { type: "cold", open_only: false }, ctx));
    expect(found.characters.length).toBeGreaterThan(0);
    for (const ch of found.characters) expect(ch.tags).toContain("cold");
    expect(found.type).toBe("cold");
    const wrong = await call("search_characters", { type: "rivals" }, ctx);
    expect(wrong.isError).toBe(true);
  });
});
