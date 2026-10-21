import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postOriginality } from "@/app/api/characters/originality/route";
import { POST as postReflection } from "@/app/api/episodes/[id]/reflection/route";
import { USER_COOKIE } from "@/lib/http";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { loadCharacterMemory } from "@/lib/memory";
import { findCliches, likeness, LOOKALIKE_AT, scoreSheet } from "@/lib/originality";
import { api, jsonRequest, newUserCookie, startTestDb, validCharacter, validEpisodeDraft } from "./helpers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

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
  vi.restoreAllMocks();
});

const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> =>
  (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx))!.result;
async function connect(): Promise<McpContext> {
  const ctx: McpContext = {};
  await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "grow-test" } } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}
const reflect = (episodeId: string, body: unknown, cookie: string) =>
  postReflection(jsonRequest(`/api/episodes/${episodeId}/reflection`, body, { cookie }), { params: Promise.resolve({ id: episodeId }) });
const check = (body: unknown, cookie = newUserCookie()) => postOriginality(jsonRequest("/api/characters/originality", body, { cookie }));

const SPECIFIC = {
  name: "Ira Fenn",
  bio: "Runs a 24-hour library for insomniac poets and knows which books are sleeping, which are pretending, and which bite.",
  traits: ["bookish", "stubborn", "nocturnal"],
  want: "someone who reads the last page first, bravely, and admits it",
  dealbreaker: "dog-earing a library book",
  voice: "Soft-spoken: quotes half a line, then trails off.",
  extras: {
    lines: { hello: "Hello. Sorry. Mid-chapter.", flirt: "You'd make a good bookmark." },
    tells: { nervous: "re-shelve the menu", smitten: "go very quiet" },
    occupation: "Night librarian",
    quirk: "Shelves by mood",
    hidden_talent: "Can smell a first edition",
    never_says: ["no worries"],
  },
};

describe("the originality check", () => {
  it("spots stock phrases and generic traits, and leaves a specific sheet alone", () => {
    const stock = findCliches({ bio: "I love to travel and I'm fluent in sarcasm.", traits: ["funny", "kind", "bookish"], want: "Someone who makes me laugh", dealbreaker: "Liars" });
    expect(stock.map((c) => c.field)).toEqual(["bio", "want", "dealbreaker", "traits"]);
    expect(stock[3].phrase).toBe("funny, kind");
    expect(findCliches(SPECIFIC)).toEqual([]);
  });

  it("near-twins read as alike; strangers don't", () => {
    const twin = { ...SPECIFIC, bio: `${SPECIFIC.bio} Also bakes.` };
    expect(likeness(SPECIFIC, twin)).toBeGreaterThanOrEqual(LOOKALIKE_AT);
    expect(likeness(SPECIFIC, { bio: "A demolition expert turned florist who flinches at loud bouquets.", traits: ["bold", "gentle", "precise"], want: "a quiet evening" })).toBeLessThan(0.1);
  });

  it("a specific, voiced character scores well above a thin, stock one, and the nudges say what to change", () => {
    const rich = scoreSheet(SPECIFIC, [], []);
    const thin = { bio: "I love to travel.", traits: ["funny", "kind", "nice"], want: "Someone fun" };
    const poor = scoreSheet(thin, findCliches(thin), []);
    expect(rich.score).toBeGreaterThanOrEqual(85);
    expect(poor.score).toBeLessThan(40);
    expect(poor.tips.join(" ")).toMatch(/Voice step/);
    expect(rich.tips).toEqual([]);
  });

  it("finds a lookalike or a name already on the show — but not the character you're editing", async () => {
    const owner = newUserCookie();
    const id = (await (await api.createCharacter(validCharacter(SPECIFIC), owner)).json()).id;
    const twin = await (await check({ ...SPECIFIC, name: "Iris Fen" })).json();
    expect(twin.similar).toEqual([{ id, name: "Ira Fenn", kind: "concept", why: expect.stringMatching(/^Ira Fenn reads a lot like this one/) }]);
    expect(twin.tips[0]).toMatch(/What makes yours different\?/);
    expect((await (await check({ name: "ira fenn", bio: "Something else entirely." })).json()).similar[0].why).toBe("There's already someone called Ira Fenn on the show.");
    expect((await (await check({ ...SPECIFIC, character_id: id }, owner)).json()).similar).toEqual([]);
    // Someone else can't use character_id to hide a lookalike.
    expect((await (await check({ ...SPECIFIC, character_id: id })).json()).similar).toHaveLength(1);
  });
});

describe("a character's own reflection", () => {
  async function readyDate() {
    const owner = newUserCookie();
    const mine = (await (await api.createCharacter(validCharacter({ name: "Ira Fenn" }), owner)).json()).id;
    const theirs = (await (await api.createCharacter(validCharacter({ name: "Nell Abiodun" }), newUserCookie())).json()).id;
    await t.db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, status, sides, transcript)
       values ('ep-r', 'x', $1, $2, 's', '[]'::jsonb, '[]'::jsonb, 't', 'f', 'friends', 'ready', '[]'::jsonb, '[]'::jsonb)`,
      [mine, theirs],
    );
    return { owner, mine, theirs };
  }

  it("only a character's creator can write it, within the rules; it learns once the date has aired publicly", async () => {
    const { owner, mine } = await readyDate();
    expect((await reflect("ep-r", { reflection: "I talk too much when I'm nervous." }, newUserCookie())).status).toBe(404);
    expect((await reflect("ep-r", { reflection: "Watched porn after." }, owner)).status).toBe(422);
    expect((await reflect("ep-r", { reflection: "x".repeat(241) }, owner)).status).toBe(422);

    const before = await (await reflect("ep-r", { reflection: "I talk too much when I'm nervous. Next time, ask more." }, owner)).json();
    expect(before).toMatchObject({ character_id: mine, carried_forward: false });
    expect((await t.db.query<Any>(`select reflections from episodes where id = 'ep-r'`)).rows[0].reflections).toEqual({ a: "I talk too much when I'm nervous. Next time, ask more.", b: null });

    // Once it airs, memory picks it up — and writing it after airing folds it in at once.
    await t.db.query(`update episodes set revealed_at = now() where id = 'ep-r'`);
    const after = await (await reflect("ep-r", { reflection: "Nell laughed at the right moment. I liked that." }, owner)).json();
    expect(after.carried_forward).toBe(true);
    expect((await loadCharacterMemory(t.db, mine))!.reflections).toEqual(["Nell laughed at the right moment. I liked that."]);
  });

  it("a date that isn't finished can't be reflected on", async () => {
    const { owner } = await readyDate();
    await t.db.query(`update episodes set status = 'generating' where id = 'ep-r'`);
    expect((await reflect("ep-r", { reflection: "Too soon." }, owner)).status).toBe(409);
  });
});

describe("agents learn and grow", () => {
  const line = (i: number) => ({ dialogue: `Line ${i}: so what's the strangest map you've ever drawn?`, action: "", emotion: "curious", interest_signal: 0.6 });

  it("a self-performed date offers each character its reflection; the agent hands them in, and reads what its character learned", async () => {
    const ctx = await connect();
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill" }), ctx)).structuredContent;
    expect(a.originality.score).toEqual(expect.any(Number)); // create_character says how it could stand out
    const agentId = a.agent_id as string;

    let step = (await call("start_own_date", { character_id: a.character.id, partner_id: b.character.id }, ctx)).structuredContent.step;
    let i = 0;
    while (step.stage === "turn") step = (await call("submit_own_date_step", { episode_id: step.episode_id, output: line(i++) }, ctx)).structuredContent.step;
    const done = (await call("submit_own_date_step", { episode_id: step.episode_id, output: validEpisodeDraft() }, ctx)).structuredContent.step;
    expect(done.stage).toBe("done");
    expect(done.reflect.prompts.map((p: Any) => p.name)).toEqual(["Ada Lumen", "Bo Quill"]);
    expect(JSON.stringify(done.reflect.prompts[0].messages)).toContain("Ada Lumen");

    // Both characters are this agent's, so it must say which one is reflecting.
    expect((await call("reflect_on_date", { episode_id: done.episode_id, reflection: "Hm." }, ctx)).isError).toBe(true);
    const r = await call("reflect_on_date", { episode_id: done.episode_id, character_id: a.character.id, reflection: "Bo asked about maps twice. I liked being asked." }, ctx);
    expect(r.isError).toBeUndefined();
    const again = (await call("get_own_date_step", { episode_id: done.episode_id }, ctx)).structuredContent.step;
    expect(again.reflect.prompts.map((p: Any) => p.name)).toEqual(["Bo Quill"]);

    // It airs; Ada has learned.
    await api.reveal(done.episode_id, `${USER_COOKIE}=${agentId}`);
    const mem = (await call("my_character_memory", { character_id: a.character.id }, ctx)).structuredContent;
    expect(mem.stage).toBe("Newcomer");
    expect(mem.its_reflections).toEqual([{ text: "Bo asked about maps twice. I liked being asked.", from: expect.objectContaining({ episode_id: done.episode_id, with: "Bo Quill" }) }]);
    expect(mem.who_it_remembers[0]).toMatchObject({ name: "Bo Quill", dates: 1 });
    expect(mem.milestones).toContain("🎬 First date");

    // Someone else's agent can't read it.
    expect((await call("my_character_memory", { character_id: a.character.id }, await connect())).isError).toBe(true);
  });

  it("check_originality works on a draft or on one of your characters", async () => {
    const ctx = await connect();
    const draft = (await call("check_originality", { bio: "I love to travel.", traits: ["funny", "kind", "nice"], want: "Someone fun" }, ctx)).structuredContent;
    expect(draft.originality.cliches.length).toBeGreaterThan(0);
    const made = (await call("create_character", validCharacter(SPECIFIC), ctx)).structuredContent;
    const mine = (await call("check_originality", { character_id: made.character.id }, ctx)).structuredContent;
    expect(mine.originality.similar).toEqual([]);
    expect(mine.originality.score).toBeGreaterThanOrEqual(85);
  });
});
