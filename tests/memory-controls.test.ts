import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getMemory } from "@/app/api/characters/[id]/memory/route";
import { DELETE as rememberRoute, POST as forgetRoute } from "@/app/api/characters/[id]/memory/forget/route";
import { POST as postReflection } from "@/app/api/episodes/[id]/reflection/route";
import { GET as evalGet, POST as evalPost } from "@/app/api/jobs/eval/route";
import { deleteCharacter, exportAccount } from "@/lib/account";
import { continuity } from "@/lib/continuity";
import type { Turn } from "@/lib/conversation";
import type { SideOutcome } from "@/lib/engine";
import { buildSagaStep, EVAL_SAGAS, runSagaStep } from "@/lib/eval";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { loadCharacterMemory, metBefore, updateCharacterMemory } from "@/lib/memory";
import { fallbackModel, ModelError, modelId, openAICompatibleModel, setModelForTests, type Model } from "@/lib/model";
import { PROMPT_VERSION } from "@/lib/pipeline";
import { CONVERSATION_TURNS, type Ending } from "@/lib/rules";
import { format } from "@/lib/formats";
import { api, episodeJson, HOUSE_PARTNER_ID, jsonRequest, newUserCookie, planJson, startTestDb, validCharacter, validEpisodeDraft } from "./helpers";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));
const { default: LearnedPanel } = await import("@/app/characters/[id]/LearnedPanel");

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
  vi.unstubAllEnvs();
});

const so = (wants: boolean, over: Partial<SideOutcome> = {}): SideOutcome => ({ wants_another: wants, agenda_met: true, satisfied: wants, dealbreaker_hit: null, want_met: null, note_followed: null, ...over });
const line = (side: "a" | "b", dialogue: string, interest = 0.5): Turn => ({ side, act: 1, dialogue, action: "", emotion: "", interest });
let n = 0;
async function aired(o: { a: string; b: string; ending: Ending; sides?: [SideOutcome, SideOutcome]; transcript?: Turn[]; reflections?: { a: string | null; b: string | null } }): Promise<string> {
  const id = `ep-${++n}`;
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, status, sides, transcript, reflections, setup, created_at, revealed_at)
     values ($1, 'sys', $2, $3, 's', '[]'::jsonb, '[]'::jsonb, 't', 'f', $4, 'ready', $5::jsonb, $6::jsonb, $7::jsonb, '{"venue":"rooftop_bar"}'::jsonb, to_timestamp($8), to_timestamp($8))`,
    [id, o.a, o.b, o.ending, JSON.stringify(o.sides ?? [so(true), so(true)]), JSON.stringify(o.transcript ?? []), o.reflections ? JSON.stringify(o.reflections) : null, 1_800_000_000 + n * 3600],
  );
  return id;
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const forget = (id: string, body: unknown, cookie: string) => forgetRoute(jsonRequest(`/api/characters/${id}/memory/forget`, body, { cookie }), ctx(id));
const remember = (id: string, body: unknown, cookie: string) => rememberRoute(jsonRequest(`/api/characters/${id}/memory/forget`, body, { cookie, method: "DELETE" }), ctx(id));

/** An owned character with two aired dates: a second date with Nell, then a disaster with Teo. */
async function withMemory() {
  const owner = newUserCookie();
  const ira = (await (await api.createCharacter(validCharacter({ name: "Ira Fenn", want: "someone who reads the last page first", dealbreaker: "dog-earing a page" }), owner)).json()).id;
  const nell = (await (await api.createCharacter(validCharacter({ name: "Nell Abiodun" }), newUserCookie())).json()).id;
  const teo = (await (await api.createCharacter(validCharacter({ name: "Teo Brandt" }), newUserCookie())).json()).id;
  const withNell = await aired({
    a: ira, b: nell, ending: "second_date", sides: [so(true), so(true)],
    transcript: [line("a", "I read the ending first. Every time.", 0.9), line("b", "So you know how this ends?", 0.8)],
    reflections: { a: "Nell asked a second question. I want more of that.", b: null },
  });
  const withTeo = await aired({ a: teo, b: ira, ending: "disaster", sides: [so(false), so(false)], reflections: { a: null, b: "I talked too much about bookbinding." } });
  await updateCharacterMemory(t.db, ira);
  return { owner, ira, nell, teo, withNell, withTeo };
}

describe("1. forgetting — the one change an owner can make to what a character learned", () => {
  it("forgets a reflection, a line, a like, a turnoff and a moment, and none come back on the next rebuild", async () => {
    const { owner, ira, nell, withNell } = await withMemory();
    const before = (await loadCharacterMemory(t.db, ira))!;
    expect(before.reflections).toContain("Nell asked a second question. I want more of that.");
    expect(before.memorable_lines).toContain("I read the ending first. Every time.");
    expect(before.likes).toEqual(["reads the last page first"]);
    expect(before.turnoffs).toEqual(["dog-earing a page"]);

    for (const body of [
      { kind: "reflection", item: withNell },
      { kind: "line", item: "I read the ending first. Every time." },
      { kind: "like", item: "reads the last page first" },
      { kind: "turnoff", item: "dog-earing a page" },
      { kind: "moment", item: nell },
    ]) {
      expect((await forget(ira, body, owner)).status, JSON.stringify(body)).toBe(200);
    }
    const after = (await loadCharacterMemory(t.db, ira))!;
    expect(after.reflections).toEqual(["I talked too much about bookbinding."]);
    expect(after.memorable_lines).not.toContain("I read the ending first. Every time.");
    expect(after.likes).toEqual([]);
    expect(after.turnoffs).toEqual([]);
    const nellMem = after.people!.find((p) => p.id === nell)!;
    expect(nellMem).toMatchObject({ status: "seeing", wanted_more: null, they_said: null, you_said: null }); // status is public record
    expect(metBefore(after, nell)).not.toHaveProperty("how_you_left_it");

    // A later date airs and memory rebuilds from everything: the forgotten items stay forgotten.
    await aired({ a: ira, b: nell, ending: "friends", sides: [so(true), so(true)] });
    const rebuilt = await updateCharacterMemory(t.db, ira);
    expect(rebuilt.reflections).not.toContain("Nell asked a second question. I want more of that.");
    expect(rebuilt.likes).not.toContain("reads the last page first");
  });

  it("remember it again undoes a forget", async () => {
    const { owner, ira, withNell } = await withMemory();
    await forget(ira, { kind: "reflection", item: withNell }, owner);
    expect((await remember(ira, { kind: "reflection", item: withNell }, owner)).status).toBe(200);
    expect((await loadCharacterMemory(t.db, ira))!.reflections).toContain("Nell asked a second question. I want more of that.");
    expect((await remember(ira, { kind: "reflection", item: withNell }, owner)).status).toBe(404); // nothing to undo
  });

  it("owner only, and only things it actually remembers", async () => {
    const { owner, ira, withNell } = await withMemory();
    expect((await forget(ira, { kind: "reflection", item: withNell }, newUserCookie())).status).toBe(404);
    expect((await forget(ira, { kind: "line", item: "Something it never said." }, owner)).status).toBe(404);
    expect((await forget(ira, { kind: "soul", item: "x" }, owner)).status).toBe(422);
    expect(await t.count("memory_forgets")).toBe(0);
    expect((await getMemory(new Request(`http://localhost:3000/api/characters/${ira}/memory`, { headers: { cookie: newUserCookie() } }), ctx(ira))).status).toBe(404);
  });

  it("writing a fresh reflection on a date un-forgets that date's reflection", async () => {
    const { owner, ira, withNell } = await withMemory();
    await forget(ira, { kind: "reflection", item: withNell }, owner);
    const res = await postReflection(jsonRequest(`/api/episodes/${withNell}/reflection`, { reflection: "Second thoughts: Nell was lovely." }, { cookie: owner }), ctx(withNell));
    expect(res.status).toBe(200);
    expect((await loadCharacterMemory(t.db, ira))!.reflections).toContain("Second thoughts: Nell was lovely.");
    expect(await t.count("memory_forgets")).toBe(0);
  });

  it("agents forget and remember through MCP", async () => {
    const mctx: McpContext = {};
    await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18" } }, mctx);
    const session: McpContext = { sessionId: mctx.issuedSessionId };
    const call = async (name: string, args: Record<string, unknown>): Promise<Any> =>
      (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, session))!.result;
    const made = (await call("create_character", validCharacter({ name: "Ada Lumen" }))).structuredContent;
    const ada = made.character.id;
    const ep = await aired({ a: ada, b: HOUSE_PARTNER_ID, ending: "friends", reflections: { a: "I liked how calm it was.", b: null } });
    await updateCharacterMemory(t.db, ada);

    const mem = (await call("my_character_memory", { character_id: ada })).structuredContent;
    expect(mem.its_reflections).toEqual([{ text: "I liked how calm it was.", from: { episode_id: ep, with: expect.any(String), aired: expect.any(String) } }]);
    expect((await call("forget_memory", { character_id: ada, kind: "reflection", item: ep })).isError).toBeUndefined();
    const after = (await call("my_character_memory", { character_id: ada })).structuredContent;
    expect(after.its_reflections).toEqual([]);
    expect(after.forgotten).toEqual([{ kind: "reflection", item: ep }]);
    expect((await call("forget_memory", { character_id: ada, kind: "reflection", item: ep, remember_again: true })).isError).toBeUndefined();
    expect((await call("my_character_memory", { character_id: ada })).structuredContent.its_reflections).toHaveLength(1);
  });
});

describe("2. where each memory came from", () => {
  it("every learned item names the aired date behind it", async () => {
    const { ira, withNell, withTeo, owner } = await withMemory();
    const m = (await loadCharacterMemory(t.db, ira))!;
    expect(m.sources!.reflections.map((r) => [r.episode_id, r.with])).toEqual([[withTeo, "Teo Brandt"], [withNell, "Nell Abiodun"]]);
    expect(m.sources!.lines.find((l) => l.text === "I read the ending first. Every time.")!.episode_id).toBe(withNell);
    expect(m.sources!.likes[0].from.map((f) => f.episode_id)).toEqual([withNell]);
    expect(m.sources!.turnoffs[0].from.map((f) => f.episode_id)).toEqual([withTeo]);
    expect(m.people!.find((p) => p.name === "Nell Abiodun")!.last_episode_id).toBe(withNell);
    // The owner's API returns it all.
    const res = await getMemory(new Request(`http://localhost:3000/api/characters/${ira}/memory`, { headers: { cookie: owner } }), ctx(ira));
    expect((await res.json()).memory.sources.reflections).toHaveLength(2);
  });

  it("the owner's panel links each item to its date and offers Forget", () => {
    const html = renderToStaticMarkup(
      createElement(LearnedPanel, {
        characterId: "ira",
        name: "Ira Fenn",
        sections: [{ title: "Lines it carries into new dates:", quote: true, items: [{ kind: "line", item: "Hi.", label: "Hi.", from: [{ episode_id: "ep-9", with: "Nell Abiodun", at: "2026-10-12T20:00:00.000Z" }] }] }],
        drift: [],
        people: [],
        forgotten: [{ kind: "like", item: "maps", label: "Warming to “maps”" }],
      }),
    );
    expect(html).toContain('href="/episodes/ep-9"');
    expect(html).toContain("your date with Nell, Oct 12");
    expect(html).toContain(">Forget<");
    expect(html).toContain("Remember it again");
  });

  it("memories from before provenance existed rebuild once on read", async () => {
    const { ira } = await withMemory();
    await t.db.query(`update character_memory set sources = null where character_id = $1`, [ira]);
    expect((await loadCharacterMemory(t.db, ira))!.sources!.reflections).toHaveLength(2);
  });
});

describe("3. which models wrote each date", () => {
  it("a model reports itself by provider and name", () => {
    expect(modelId("https://generativelanguage.googleapis.com/v1beta/openai", "gemini-3.5-flash-lite")).toBe("google/gemini-3.5-flash-lite");
    expect(modelId("https://api.openai.com/v1", "gpt-4.1-mini")).toBe("openai/gpt-4.1-mini");
    expect(modelId("https://openrouter.ai/api/v1", "x/y")).toBe("openrouter/x/y");
    expect(modelId("not a url", "m")).toBe("custom/m");
  });

  it("the model that actually answered reports, fallbacks included", async () => {
    const ok = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
    const paid = openAICompatibleModel({ baseUrl: "https://api.openai.com/v1", apiKey: "k", model: "gpt-x", retryDelaysMs: [], fetchImpl: (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch });
    const free = openAICompatibleModel({ baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", apiKey: "k", model: "gemini-free", fetchImpl: ok({ choices: [{ message: { content: "hi" } }] }) });
    const served: string[] = [];
    await fallbackModel(paid, free).complete([{ role: "user", content: "x" }], { onModel: (id) => served.push(id) });
    expect(served).toEqual(["google/gemini-free"]);
    await expect(paid.complete([{ role: "user", content: "x" }])).rejects.toBeInstanceOf(ModelError);
  });

  it("a generated date stores which models wrote it and the prompt version; a self-performed one says the agent did", async () => {
    const outputs = [episodeJson()];
    const model: Model = {
      async complete(_m, options) {
        options?.onModel?.("google/test-model");
        const next = outputs.shift();
        if (!next) throw new Error("out of outputs");
        return next;
      },
    };
    setModelForTests(model);
    const creator = newUserCookie();
    const oc = (await (await api.createCharacter(validCharacter(), creator)).json()).id;
    const ep = await (await api.createEpisode({ character_id: oc, partner_id: HOUSE_PARTNER_ID }, creator)).json();
    const row = (await t.db.query<Any>(`select generated_with from episodes where id = $1`, [ep.id])).rows[0];
    expect(row.generated_with).toEqual({ actor: ["google/test-model"], director: ["google/test-model"], byok: [], prompts: PROMPT_VERSION });
    // Never in a viewer's episode view.
    expect(JSON.stringify(await (await api.getEpisode(ep.id, creator)).json())).not.toContain("google/test-model");
    setModelForTests(null);

    const mctx: McpContext = {};
    await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18" } }, mctx);
    const session: McpContext = { sessionId: mctx.issuedSessionId };
    const call = async (name: string, args: Record<string, unknown>): Promise<Any> =>
      ((await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, session))!.result as Any).structuredContent;
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen" }))).character.id;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill" }))).character.id;
    let step = (await call("start_own_date", { character_id: a, partner_id: b })).step;
    let i = 0;
    while (step.stage === "turn") step = (await call("submit_own_date_step", { episode_id: step.episode_id, output: { dialogue: `Line ${i++}: hello?` } })).step;
    await call("submit_own_date_step", { episode_id: step.episode_id, output: validEpisodeDraft() });
    const own = (await t.db.query<Any>(`select generated_with from episodes where id = $1`, [step.episode_id])).rows[0];
    expect(own.generated_with).toEqual({ actor: ["agent"], director: ["agent"], byok: [], prompts: PROMPT_VERSION });
  });
});

describe("4. the account export includes what characters learned; deleting a character takes it with it", () => {
  it("exports memory, forgets, reflections and key metadata (never a key)", async () => {
    const { owner, ira, withNell } = await withMemory();
    await forget(ira, { kind: "reflection", item: withNell }, owner);
    const userId = owner.split("=")[1];
    const out = await exportAccount(t.db, userId);
    expect(out.character_memory.map((m) => m.character_id)).toEqual([ira]);
    expect(out.memory_forgets).toEqual([expect.objectContaining({ character_id: ira, kind: "reflection", item: withNell })]);
    expect(out.reflections.map((r) => r.reflection).sort()).toEqual(["I talked too much about bookbinding.", "Nell asked a second question. I want more of that."]);
    expect(out.characters[0]).toHaveProperty("extras");
    expect(JSON.stringify(out.provider_keys)).not.toContain("ciphertext");
  });

  it("a deleted character kept as a tombstone keeps nothing it privately learned (the other side's reflection stays)", async () => {
    const { owner, ira, withNell, nell } = await withMemory();
    await t.db.query(`update episodes set reflections = '{"a": "Ira mine", "b": "Nell theirs"}'::jsonb where id = $1`, [withNell]);
    await forget(ira, { kind: "line", item: "I read the ending first. Every time." }, owner);
    expect(await deleteCharacter(t.db, owner.split("=")[1], ira)).toEqual({ deleted: false, anonymized: true });
    expect(await t.count("character_memory", `character_id = '${ira}'`)).toBe(0);
    expect(await t.count("memory_forgets", `character_id = '${ira}'`)).toBe(0);
    expect((await t.db.query<Any>(`select reflections from episodes where id = $1`, [withNell])).rows[0].reflections).toEqual({ a: null, b: "Nell theirs" });
    expect(nell).toBeTruthy();
  });
});

const TURNS = format("classic").turns ?? CONVERSATION_TURNS;

describe("5. continuity: one character's run of dates", () => {
  it("strangers who claim a past are inventing it; a rematch that picks up last time is a callback", () => {
    const first = continuity([line("a", "Remember when we met last time? Oh wait."), line("b", "Hi.")], null);
    expect(first).toEqual({ met_before: false, history_claims: 1, invented_history: 1, callbacks: 0, called_back: false });
    const rematch = continuity([line("a", "Still carrying that thermos?"), line("b", "Hello again.")], { a: "a cold beach at night; It's soup. It's always soup in the thermos", b: "" });
    expect(rematch).toMatchObject({ met_before: true, invented_history: 0, callbacks: 1, called_back: true });
  });

  it("a saga carries memory forward: the rematch remembers last time, the date in between knows its dating life", () => {
    const saga = EVAL_SAGAS[0];
    const prior = [[line("a", "Your hands are enormous. In a good way.", 0.9), line("b", "I've been set on fire nineteen times.", 0.9)], [line("a", "Do museums get lonely?", 0.7)]];
    const step0 = buildSagaStep(saga, 0, []);
    expect(step0.built.characters[0].memory).toBeNull();
    const step1 = buildSagaStep(saga, 1, prior.slice(0, 1));
    expect(step1.built.input.history).toBeUndefined(); // a new partner
    expect(step1.built.characters[0].memory!.people!.map((p) => p.name)).toEqual(["Dex Okafor"]);
    const step2 = buildSagaStep(saga, 2, prior);
    expect(step2.built.input.history).toEqual({ dates: 1, last_ending: step0.outcome.ending });
    expect(metBefore(step2.built.characters[0].memory, "house-dex")).toMatchObject({ times: 1, something_they_said: "I've been set on fire nineteen times." });
    expect(metBefore(step2.built.characters[1].memory, "eval-rich-oc")).toMatchObject({ times: 1 }); // Dex remembers Mira too
    // Deterministic: the same prior gives the same date.
    expect(buildSagaStep(saga, 2, prior).outcome).toEqual(step2.outcome);
  });

  it("a saga step runs through the eval route with its continuity measured", async () => {
    vi.stubEnv("CRON_SECRET", ["cron", "test", "secret"].join("-"));
    const auth = { authorization: `Bearer ${["cron", "test", "secret"].join("-")}` };
    expect(((await (await evalGet(new Request("http://localhost:3000/api/jobs/eval", { headers: auth }))).json()) as Any).sagas).toEqual([{ id: "mira-saga", steps: 3 }]);
    const post = (body: unknown) => evalPost(new Request("http://localhost:3000/api/jobs/eval", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(body) }));
    expect((await post({ saga: "nope", step: 0 })).status).toBe(400);
    expect((await post({ saga: "mira-saga", step: 2, prior: [] })).status).toBe(400); // step 2 needs two earlier transcripts

    const turn = (i: number) => JSON.stringify({ dialogue: `Line ${i}: so, the thermos — still soup?`, action: "", emotion: "curious", interest_signal: 0.6 });
    const outputs = [planJson(), ...Array.from({ length: TURNS }, (_, i) => turn(i)), episodeJson()];
    setModelForTests({ async complete() { const next = outputs.shift(); if (!next) throw new Error("out"); return next; } });
    const prior = [[line("a", "Hi.", 0.5), line("b", "It's soup. It's always soup in the thermos.", 0.9)], [line("a", "Museums at night?", 0.5)]];
    const res = await post({ saga: "mira-saga", step: 2, prior });
    setModelForTests(null);
    expect(res.status).toBe(200);
    const r = await res.json();
    expect(r.continuity.met_before).toBe(true);
    expect(r.continuity.called_back).toBe(true);
    expect(r.partner).toBe("house-dex");
  });

  it("runSagaStep works with any models (a model switch is just a different actor for the last step)", async () => {
    const turns = Array.from({ length: TURNS }, (_, i) => JSON.stringify({ dialogue: `Line ${i}: hello there.`, action: "", emotion: "", interest_signal: 0.5 }));
    const q = [planJson(), ...turns, episodeJson()];
    const m: Model = { async complete() { const next = q.shift(); if (!next) throw new Error("out"); return next; } };
    const r = await runSagaStep(EVAL_SAGAS[0], 0, [], { actor: m, director: m }, null);
    expect(r.continuity).toEqual({ met_before: false, history_claims: 0, invented_history: 0, callbacks: 0, called_back: false });
  });
});
