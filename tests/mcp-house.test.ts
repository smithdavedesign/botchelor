/**
 * The house over MCP (2.31.0, lib/mcp/house.ts): get_house_scene, get_house_talk, get_story_so_far and my_story_state.
 * The three public tools show only what /house and GET /api/story show a stranger (a private character's or an unaired
 * date's retelling never leaks), the owner's tool refuses someone else's character, and MCP_HOUSE=0 hides and refuses
 * all four. No model calls.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sceneIdOf } from "@/lib/house-scenes";
import { CORE_TOOL_ORDER, handleMcpMessage, MCP_TOOLS, PUBLIC_MCP_TOOLS, type McpContext } from "@/lib/mcp";
import { HOUSE_TOOL_NAMES } from "@/lib/mcp/house";
import { clipStory } from "@/lib/producer";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { clearSharedCache } from "@/lib/shared-cache";
import { hear, setOpinion, setWant } from "@/lib/story-state";
import type { SideOutcome } from "@/lib/engine";
import { api, episodeJson, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

const side: SideOutcome = { wants_another: false, agenda_met: true, satisfied: false, dealbreaker_hit: null, want_met: null, note_followed: null };

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const rpc = async (method: string, params: Any = {}, ctx: McpContext = {}): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Any = {}): Promise<Any> => (await rpc("tools/call", { name, arguments: args })).result;
const data = async (name: string, args: Any = {}): Promise<Any> => {
  const r = await call(name, args);
  expect(r.isError, JSON.stringify(r.structuredContent)).toBeUndefined();
  return r.structuredContent;
};

const CAST = HOUSE_CHARACTERS.slice(0, 5);
const [RAFE, JUNIPER, DEX, MARISOL, TEO] = CAST.map((c) => c.id);
const first = (id: string) => HOUSE_CHARACTERS.find((c) => c.id === id)?.name.split(" ")[0] ?? "Lexi";
const DAY = new Date().toISOString().slice(0, 10);
const YESTERDAY = new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10);
const OWNER = "0f0e0d0c-0b0a-4a09-8807-060504030201";
const STRANGER = "1f1e1d1c-1b1a-4a19-8817-161514131211";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  setSeasonCastForTests(null);
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  clearSharedCache();
  setSeasonCastForTests(CAST.map((c) => c.id));
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

let n = 0;
async function episode(a: string, b: string, e: { revealedAt?: string | null; visibility?: string; creator?: string } = {}) {
  const id = `mh-ep-${++n}`;
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, visibility, setup, transcript)
     values ($1, $2, $3, $4, 'a bar', '[]'::jsonb, '[]'::jsonb, 'TWIST-WORDS', 'FINALE-WORDS', 'friends', $5, $6, '{"venue":"rooftop_bar"}'::jsonb, '[]'::jsonb)`,
    [id, e.creator ?? "system", a, b, e.revealedAt === undefined ? new Date(Date.now() - 3 * 3600_000).toISOString() : e.revealedAt, e.visibility ?? "public"],
  );
  return id;
}
async function person(name: string, owner: string, visibility = "public") {
  const id = `mh-char-${++n}`;
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility)
     values ($1, $2, false, $3, 30, 'Bakes bread and argues with the radio.', '["kind"]'::jsonb, 'someone kind', 'liars', $4)`,
    [id, owner, name, visibility],
  );
  return id;
}
type Line = { character_id: string; text: string; tell?: { episode_id: string; about: string; about_b: string; claim: string; is_true: boolean } };
async function scene(day: string, lines: Line[], opts: { kind?: string; cast?: string[]; result?: unknown } = {}) {
  const id = sceneIdOf(day, opts.kind ?? "gossip");
  const cast = opts.cast ?? [...new Set(lines.map((l) => l.character_id))];
  const told = lines.flatMap((l, i) => (l.tell ? [{ ...l.tell, line: i + 1, by: l.character_id, to: cast.filter((c) => c !== l.character_id), source: `scene:${id}#${i + 1}` }] : []));
  await t.db.query(
    `insert into house_scenes (id, day, season_id, kind, place, cast_ids, lines, told, result, source, created_at, written_at)
     values ($1, $2, '2026-11-01', $3, 'kitchen', $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, 'template', $8, $8)`,
    [id, day, opts.kind ?? "gossip", JSON.stringify(cast), JSON.stringify(lines), JSON.stringify(told), opts.result ? JSON.stringify(opts.result) : null, `${day}T18:20:00Z`],
  );
  return id;
}
const tell = (episode_id: string, about: string, about_b: string) => ({ episode_id, about, about_b, claim: `${first(about)} and ${first(about_b)} called it friends.`, is_true: true });

describe("the tool list", () => {
  it("lists the four house tools at ?tools=all, read-only, in their own category, and never in the core list", async () => {
    const all = (await rpc("tools/list", { all: true })).result.tools as Any[];
    for (const name of HOUSE_TOOL_NAMES) {
      const tool = all.find((x) => x.name === name);
      expect(tool, name).toBeTruthy();
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      expect(tool._meta["botchelor/category"]).toBe("house");
      expect(tool.description).toMatch(/^Free\./);
      expect(CORE_TOOL_ORDER as readonly string[]).not.toContain(name);
    }
    const core = (await rpc("tools/list")).result;
    expect(core.more_tools.not_listed).toEqual(expect.arrayContaining([...HOUSE_TOOL_NAMES]));
  });

  it("MCP_HOUSE=0 takes them out of every list and refuses a call in the server's not-available shape", async () => {
    vi.stubEnv("MCP_HOUSE", "0");
    const all = (await rpc("tools/list", { all: true })).result.tools.map((x: Any) => x.name);
    for (const name of HOUSE_TOOL_NAMES) expect(all).not.toContain(name);
    expect(all).toHaveLength(PUBLIC_MCP_TOOLS.length - HOUSE_TOOL_NAMES.length);
    expect((await rpc("tools/list", { names: [...HOUSE_TOOL_NAMES] })).result.tools).toEqual([]);
    const core = (await rpc("tools/list")).result;
    expect(core.more_tools.total).toBe(PUBLIC_MCP_TOOLS.length - HOUSE_TOOL_NAMES.length);
    for (const name of HOUSE_TOOL_NAMES) expect(core.more_tools.not_listed).not.toContain(name);
    for (const name of HOUSE_TOOL_NAMES) {
      const r = await call(name, { character_id: RAFE, agent_id: OWNER });
      expect(r.isError).toBe(true);
      expect(r.structuredContent).toMatchObject({ code: "not_available", error: "The house tools aren't available right now." });
    }
    // Back on, the same call answers.
    vi.stubEnv("MCP_HOUSE", "1");
    expect((await call("get_house_scene")).isError).toBeUndefined();
    expect(MCP_TOOLS.map((x) => x.name)).toEqual(expect.arrayContaining([...HOUSE_TOOL_NAMES]));
  });
});

describe("get_house_scene", () => {
  it("says the house is quiet when no scene has been written", async () => {
    const d = await data("get_house_scene");
    expect(d.scene).toBeNull();
    expect(d.empty_note).toMatch(/quiet/);
  });

  it("returns the latest scene as /house shows it, names the ones before it, and reads one by id", async () => {
    const date = await episode(RAFE, JUNIPER);
    const today = await scene(DAY, [
      { character_id: DEX, text: "Rafe and Juniper called it friends.", tell: tell(date, RAFE, JUNIPER) },
      { character_id: MARISOL, text: "Friends. On a rooftop. Sure." },
    ]);
    const before = await scene(YESTERDAY, [
      { character_id: TEO, text: "Quiet night." },
      { character_id: DEX, text: "Too quiet." },
    ]);
    const d = await data("get_house_scene");
    expect(d.today).toBe(true);
    expect(d.scene).toMatchObject({
      scene_id: today,
      day: DAY,
      kind: "gossip",
      place: expect.any(String),
      cast: [{ id: DEX, name: first(DEX), house: true }, { id: MARISOL, name: first(MARISOL), house: true }],
      lines: [
        { n: 1, character_id: DEX, by: first(DEX), text: "Rafe and Juniper called it friends." },
        { n: 2, character_id: MARISOL, by: first(MARISOL), text: "Friends. On a rooftop. Sure." },
      ],
      about: [{ episode_id: date }],
      link: expect.stringContaining(`/house?scene=${today}`),
    });
    expect(d.scene.summary).toContain(first(DEX));
    expect(d.earlier).toEqual([{ scene_id: before, day: YESTERDAY, kind: "gossip", summary: expect.any(String) }]);
    // Nothing a page view doesn't carry: no colours, portraits or what was told to whom.
    expect(JSON.stringify(d)).not.toMatch(/portrait|hue|is_true|"told"/);
    expect(JSON.stringify(d).length).toBeLessThan(2_000);
    const one = await data("get_house_scene", { scene_id: before });
    expect(one.scene.scene_id).toBe(before);
    expect(one.earlier).toBeUndefined();
    const none = await call("get_house_scene", { scene_id: "2020-01-01-gossip" });
    expect(none.isError).toBe(true);
    expect(none.structuredContent.code).toBe("not_found");
  });

  it("never shows a retelling of a private or an unaired date, or a line by a character that isn't public", async () => {
    const aired = await episode(RAFE, JUNIPER);
    const hidden = await episode(RAFE, MARISOL, { visibility: "private" });
    const unaired = await episode(JUNIPER, TEO, { revealedAt: null });
    const quinn = await person("Quiet Quinn", OWNER, "private");
    const id = await scene(DAY, [
      { character_id: DEX, text: "Rafe and Juniper called it friends.", tell: tell(aired, RAFE, JUNIPER) },
      { character_id: TEO, text: "SECRET-PRIVATE-DATE went badly.", tell: tell(hidden, RAFE, MARISOL) },
      { character_id: DEX, text: "SECRET-UNAIRED-DATE ends in a kiss.", tell: tell(unaired, JUNIPER, TEO) },
      { character_id: quinn, text: "SECRET-PRIVATE-SPEAKER says hello." },
      { character_id: TEO, text: "Anyway." },
    ]);
    for (const args of [{}, { scene_id: id }]) {
      const d = await data("get_house_scene", args);
      const text = JSON.stringify(d);
      expect(text).not.toMatch(/SECRET-/);
      expect(text).not.toContain(hidden);
      expect(text).not.toContain(unaired);
      expect(text).not.toContain(quinn);
      expect(text).not.toContain("Quinn");
      expect(d.scene.lines.map((l: Any) => l.n)).toEqual([1, 5]);
      expect(d.scene.about).toEqual([{ episode_id: aired, a: expect.any(String), b: expect.any(String) }]);
    }
  });
});

describe("get_house_talk", () => {
  it("lists the public scenes that name a character, and how", async () => {
    const date = await episode(RAFE, JUNIPER);
    const today = await scene(DAY, [
      { character_id: DEX, text: "Rafe and Juniper called it friends.", tell: tell(date, RAFE, JUNIPER) },
      { character_id: MARISOL, text: "Friends. On a rooftop. Sure." },
    ]);
    await scene(YESTERDAY, [
      { character_id: TEO, text: "Quiet night." },
      { character_id: DEX, text: "Too quiet." },
    ]);
    // Rafe wasn't in the room: his date was talked about, and a line names him.
    const rafe = await data("get_house_talk", { character_id: RAFE });
    expect(rafe.character).toEqual({ id: RAFE, name: HOUSE_CHARACTERS.find((c) => c.id === RAFE)!.name });
    expect(rafe.talked_about).toBe(true);
    expect(rafe.scenes).toEqual([
      {
        scene_id: today,
        day: DAY,
        kind: "gossip",
        place: expect.any(String),
        how: ["date_talked_about"],
        summary: expect.any(String),
        lines: [{ n: 1, by: first(DEX), text: "Rafe and Juniper called it friends." }],
        link: expect.stringContaining(`/house?scene=${today}`),
      },
    ]);
    // Dex spoke in both; limit keeps the newest.
    const dex = await data("get_house_talk", { character_id: DEX });
    expect(dex.scenes.map((s: Any) => s.how)).toEqual([["spoke", "was_there"], ["spoke", "was_there"]]);
    expect((await data("get_house_talk", { character_id: DEX, limit: 1 })).scenes.map((s: Any) => s.scene_id)).toEqual([today]);
    // Nobody has named Teo's date, and Teo only spoke yesterday.
    const juniper = await data("get_house_talk", { character_id: JUNIPER });
    expect(juniper.scenes.map((s: Any) => s.how)).toEqual([["date_talked_about"]]);
    const nobody = await person("Unmentioned Una", OWNER);
    const una = await data("get_house_talk", { character_id: nobody });
    expect(una).toMatchObject({ talked_about: false, scenes: [] });
    expect(una.empty_note).toMatch(/Nobody in the house has named Unmentioned/);
  });

  it("says who had it out and who won the challenge", async () => {
    await scene(DAY, [{ character_id: DEX, text: "You told everyone I walked out." }, { character_id: MARISOL, text: "Because you did." }], {
      kind: "confrontation",
      result: { kind: "confrontation", a: DEX, b: MARISOL, outcome: "agreed_to_disagree" },
    });
    await scene(YESTERDAY, [{ character_id: TEO, text: "I win." }, { character_id: DEX, text: "Fine." }], {
      kind: "challenge",
      result: { kind: "challenge", title: "The Toast", winner: TEO, prize: { kind: "first_pick", day: DAY, with: null } },
    });
    const dex = await data("get_house_talk", { character_id: DEX });
    expect(dex.scenes[0].how).toEqual(["spoke", "was_there", "had_it_out"]);
    const teo = await data("get_house_talk", { character_id: TEO });
    expect(teo.scenes[0].how).toEqual(["spoke", "was_there", "won_the_challenge"]);
  });

  it("a date that stops being public is no longer talk about them, and a private character is nobody to a stranger", async () => {
    const date = await episode(RAFE, JUNIPER);
    await scene(DAY, [
      { character_id: DEX, text: "They called it friends.", tell: tell(date, RAFE, JUNIPER) },
      { character_id: MARISOL, text: "Sure they did." },
      { character_id: TEO, text: "Anyway." },
    ]);
    expect((await data("get_house_talk", { character_id: RAFE })).talked_about).toBe(true);
    await t.db.query(`update episodes set visibility = 'private' where id = $1`, [date]);
    const after = await data("get_house_talk", { character_id: RAFE });
    expect(after).toMatchObject({ talked_about: false, scenes: [] });
    expect(JSON.stringify(after)).not.toContain(date);

    // A private character in a stored scene: a stranger is told there is no such character; its owner, that the house never names it.
    const quinn = await person("Quiet Quinn", OWNER, "private");
    await scene(YESTERDAY, [{ character_id: quinn, text: "SECRET-PRIVATE-SPEAKER." }, { character_id: DEX, text: "Hm." }, { character_id: TEO, text: "Hm hm." }]);
    for (const args of [{ character_id: quinn }, { character_id: quinn, agent_id: STRANGER }]) {
      const r = await call("get_house_talk", args);
      expect(r.isError).toBe(true);
      expect(r.structuredContent.code).toBe("not_found");
      expect(JSON.stringify(r)).not.toMatch(/Quinn|SECRET/);
    }
    const own = await data("get_house_talk", { character_id: quinn, agent_id: OWNER });
    expect(own).toMatchObject({ talked_about: false, scenes: [] });
    expect(JSON.stringify(own)).not.toContain("SECRET");
    expect((await call("get_house_talk", { character_id: "no-such-character" })).structuredContent.code).toBe("not_found");
  });
});

describe("get_story_so_far", () => {
  it("returns what GET /api/story returns, and an empty answer on a day with no line", async () => {
    const empty = await data("get_story_so_far");
    expect(empty).toMatchObject({ day: null, logline: null, previously: null, tonight: null, episodes: [] });
    expect(empty.empty_note).toMatch(/No story line today/);
    const about = await episode(DEX, MARISOL, { revealedAt: new Date().toISOString() });
    await episode(DEX, MARISOL, { visibility: "private", revealedAt: new Date().toISOString() });
    await episode(DEX, MARISOL, { revealedAt: null });
    await t.db.query(
      `insert into story_beats (day, season_id, kind, status, tension, who, about, logline, previously, tonight)
       values ($1, '2026-11-01', 'same_room', 'staged', 'mutual_distrust', $2::jsonb, null, 'Dex and Marisol, one room.', 'Previously: they stopped talking.', 'Tonight: one room.')`,
      [DAY, JSON.stringify([DEX, MARISOL])],
    );
    const story = await clipStory(t.db);
    const d = await data("get_story_so_far");
    expect(d).toMatchObject({ day: story.day, logline: story.logline, previously: story.previously, tonight: story.tonight });
    expect(d.day).toBe(DAY);
    // Only the aired public date: never the private or the unaired one.
    expect(d.episodes).toEqual([{ episode_id: about, day: DAY, logline: story.logline, link: expect.stringContaining(`/episodes/${about}`) }]);
    expect(d.episodes.map((e: Any) => e.episode_id)).toEqual(story.episodes.map((e) => e.id));
    expect(d.empty_note).toBeUndefined();
  });
});

describe("my_story_state", () => {
  async function holder() {
    const mine = await person("Lexi Lane", OWNER);
    await setOpinion(t.db, { holder: mine, about: RAFE, trust: -1, attraction: 1, take: "Charming, and he knows it.", basis: "firsthand", source: "mh-ep-x" });
    await hear(t.db, { holder: mine, about: DEX, aboutB: MARISOL, claim: "Dex and Marisol called it friends.", toldBy: TEO, source: "scene:s#1", isTrue: false });
    await setWant(t.db, { holder: mine, want: "Find out what Rafe really thinks.", kind: "pursue", about: RAFE, setBy: "rules" });
    return mine;
  }

  it("shows its owner what it thinks, what it heard and from whom, and what it wants, with the forget each item takes", async () => {
    const mine = await holder();
    const d = await data("my_story_state", { character_id: mine, agent_id: OWNER });
    expect(d.character_id).toBe(mine);
    // Firsthand first; being told something leaves a heard opinion of each of the two it was about.
    expect(d.thinks[0]).toMatchObject({ about: RAFE, trust: "wary of them", attraction: "interested", take: "Charming, and he knows it.", basis: "firsthand", forget: { kind: "opinion", item: RAFE } });
    expect(d.thinks.slice(1).map((o: Any) => [o.about, o.basis]).sort()).toEqual([[DEX, "heard"], [MARISOL, "heard"]].sort());
    expect(d.heard).toHaveLength(1);
    expect(d.heard[0]).toMatchObject({ claim: "Dex and Marisol called it friends.", told_by: expect.stringContaining(first(TEO)), from: "scene:s#1", forget: { kind: "heard", item: d.heard[0].id } });
    expect(d.wants).toMatchObject({ want: "Find out what Rafe really thinks.", kind: "pursue", about: RAFE });
    // Whether a heard thing is true is never said: the character doesn't know.
    expect(JSON.stringify(d)).not.toContain("is_true");
    expect(JSON.stringify(d).length).toBeLessThan(2_500);

    // Forgetting goes through forget_memory, the same route the page's Forget button calls; it's then listed as forgotten.
    const f = await data("forget_memory", { ...d.thinks[0].forget, character_id: mine, agent_id: OWNER });
    expect(f.forgotten).toEqual({ kind: "opinion", item: RAFE });
    const after = await data("my_story_state", { character_id: mine, agent_id: OWNER });
    expect(after.thinks.map((o: Any) => o.about).sort()).toEqual([DEX, MARISOL].sort());
    expect(after.forgotten).toEqual([{ kind: "opinion", item: RAFE, label: expect.stringContaining("Rafe") }]);
  });

  it("refuses someone else's character, a house character and a caller with no identity", async () => {
    const mine = await holder();
    const other = await call("my_story_state", { character_id: mine, agent_id: STRANGER });
    expect(other.isError).toBe(true);
    expect(other.structuredContent.code).toBe("not_yours");
    expect(JSON.stringify(other)).not.toMatch(/Charming|called it friends|Find out/);
    expect((await call("my_story_state", { character_id: RAFE, agent_id: OWNER })).structuredContent.code).toBe("not_yours");
    const anon = await call("my_story_state", { character_id: mine });
    expect(anon.isError).toBe(true);
    expect(anon.structuredContent.error).toMatch(/No identity yet/);
  });

  it("says so when there is nothing yet, and when story state is off", async () => {
    const fresh = await person("New Nia", OWNER);
    const d = await data("my_story_state", { character_id: fresh, agent_id: OWNER });
    expect(d).toMatchObject({ thinks: [], heard: [], wants: null });
    expect(d.empty_note).toMatch(/Nothing yet/);
    vi.stubEnv("STORY_STATE", "0");
    expect((await data("my_story_state", { character_id: fresh, agent_id: OWNER })).empty_note).toMatch(/off/);
  });
});

describe("get_episode points at the house", () => {
  it("says when the house talked about an aired date of yours, and nothing otherwise", async () => {
    // A real date (the booking route), aired: the caller's own character with a house character.
    const me = await newUserCookie();
    const OWNER = userIdOf(me);
    const mine = (await (await api.createCharacter(validCharacter({ name: "Lexi Lane" }), me)).json()).id as string;
    scriptOutcome({ ending: "friends", sides: [side, side] });
    scriptedModel([episodeJson()]);
    const date = (await (await api.createEpisode({ character_id: mine, partner_id: RAFE }, me)).json()).id as string;
    await api.reveal(date, me);
    const quiet = await data("get_episode", { episode_id: date, agent_id: OWNER });
    expect(quiet.house_talk).toBeUndefined();
    const id = await scene(DAY, [
      { character_id: DEX, text: "Lexi and Rafe called it friends.", tell: tell(date, mine, RAFE) },
      { character_id: MARISOL, text: "Friends again." },
    ]);
    const d = await data("get_episode", { episode_id: date, agent_id: OWNER });
    expect(d.house_talk).toEqual({
      scene_id: id,
      summary: expect.any(String),
      link: expect.stringContaining(`/house?scene=${id}`),
      call: { tool: "get_house_scene", args: { scene_id: id } },
      note: expect.stringContaining("work by name"),
    });
    expect((await data("get_episode", { episode_id: date, agent_id: OWNER, summary: true })).house_talk.scene_id).toBe(id);
    // Somebody else's read of the same date carries no pointer, and neither does anyone's with the switch off.
    expect((await data("get_episode", { episode_id: date, agent_id: STRANGER })).house_talk).toBeUndefined();
    vi.stubEnv("MCP_HOUSE", "0");
    expect((await data("get_episode", { episode_id: date, agent_id: OWNER })).house_talk).toBeUndefined();
  });
});
