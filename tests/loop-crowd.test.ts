import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { setModelForTests } from "@/lib/model";
import { setSwipeGateForTests } from "@/lib/swipe-gate";
import { setMatchChatEnabledForTests } from "@/lib/swipes";
import {
  brainFromEnv,
  checkLocalAlias,
  cleanReply,
  createBrain,
  bestLineCandidates,
  crowdRound,
  isLogisticsLine,
  echoesProfile,
  mergeLastLines,
  nearDuplicate,
  scriptedText,
  scriptedTurn,
  seedCrowd,
  speak,
  CROWD,
  type CrowdAgent,
  type CrowdBrain,
  type Transport,
} from "../scripts/loop/crowd.mjs";
import { startTestDb, validCharacter } from "./helpers";

// The loop arena's crowd (scripts/loop/crowd.mjs, David 2026-10-20: "busier, longer sims"): background agents that make
// the world feel inhabited before visitors connect and keep it moving while they're there, for nothing.
let t: Awaited<ReturnType<typeof startTestDb>>;
let modelCalls = 0;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  // Like the arena: the swipe gate and a match's opening chat are on. Any model call would be spend, so the model throws.
  setSwipeGateForTests(true);
  setMatchChatEnabledForTests(true);
  modelCalls = 0;
  setModelForTests({
    async complete() {
      modelCalls++;
      throw new Error("the crowd must never reach a model");
    },
  });
});
afterEach(() => {
  setSwipeGateForTests(false);
  setMatchChatEnabledForTests(false);
  setModelForTests(null);
  vi.restoreAllMocks();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
/** The crowd's MCP, in process: the same handler /api/mcp runs. */
const transport: Transport = async (body, sessionId, userAgent) => {
  const ctx: McpContext = { sessionId, userAgent };
  const json = await handleMcpMessage(body as Parameters<typeof handleMcpMessage>[0], ctx);
  return { json, sessionId: ctx.issuedSessionId ?? sessionId };
};
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> =>
  (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx))!.result;
async function visitor(): Promise<McpContext> {
  const ctx: McpContext = {};
  await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code" } } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}
const profile = { prompts: [{ id: "simple_pleasures", answer: "Rain on a tin roof." }, { id: "geek_out", answer: "Old maps." }], hobbies: ["maps", "tea"] };

describe("the loop arena's crowd", () => {
  it("seeds an inhabited world before visitors arrive, for nothing, run by bots labelled house-run", async () => {
    const { agents, world } = await seedCrowd(transport);
    expect(world).toEqual({ agents: 6, characters: 10, dates_finished: 4, dates_in_progress: 2, matches: 5, matches_agreed: 3, texts: 10, texts_waiting: 4 });
    expect(modelCalls).toBe(0);

    // Finished dates have transcripts and the agent's recap; the second dates are half played.
    const { rows } = await t.db.query<{ status: string; lines: number; setting: string }>(
      `select status, jsonb_array_length(transcript)::int as lines, setting from episodes where performed_by = 'agent' order by status`,
    );
    expect(rows.filter((r) => r.status === "ready").map((r) => r.lines > 6 && r.setting.length > 0)).toEqual([true, true, true, true]);
    expect(rows.filter((r) => r.status === "generating").map((r) => r.lines)).toEqual([6, 6]);
    // Each agent its own client name, one per personality, under the loop's "botchelor-loop-" prefix: house-run, and said so.
    const clients = (await t.db.query<{ client_name: string }>(`select distinct client_name from mcp_sessions where client_name is not null`)).rows.map((r) => r.client_name);
    expect(clients.sort()).toEqual([
      "botchelor-loop-crowd-fieldnote",
      "botchelor-loop-crowd-lanternfish",
      "botchelor-loop-crowd-nightjar",
      "botchelor-loop-crowd-orrery",
      "botchelor-loop-crowd-quillon",
      "botchelor-loop-crowd-tessellate",
    ]);
    expect(agents.map((a: CrowdAgent) => a.userAgent)).toContain("botchelor-loop-crowd-lanternfish/2.1.0 (house-run: Lanternfish)");

    const v = await visitor();
    const mine = (await call("create_character", validCharacter({ name: "Vera Atlas", extras: profile, open_to_dates: true }), v)).structuredContent.character.id;
    const deck = (await call("swipe_deck", { character_id: mine, limit: 30 }, v)).structuredContent.cards as Any[];
    const crowd = deck.filter((c) => agents.some((a: CrowdAgent) => a.chars.some((x) => x.id === c.id)));
    expect(crowd.length).toBeGreaterThanOrEqual(6);
    // Cards: house_bot: true, run by a house bot, never "another agent".
    expect(crowd.every((c) => c.run_by === "house_bot" && c.made_by === "house_bot" && c.house_bot === true)).toBe(true);
    // A swipe says the same, and "live agents" leaves them out.
    const swiped = (await call("swipe", { character_id: mine, target_id: crowd[0].id, like: false }, v)).structuredContent;
    expect(swiped).toMatchObject({ run_by: "house_bot", house_bot: true });
    const live = (await call("swipe_deck", { character_id: mine, limit: 30, only: "live_agents" }, v)).structuredContent.cards as Any[];
    expect(live.filter((c) => crowd.some((x) => x.id === c.id))).toEqual([]);
    // my_status doesn't count them as other agents on now.
    const status = (await call("my_status", {}, v)).structuredContent;
    expect(status.agents_on_now ?? status.you?.agents_on_now ?? 0).toBe(0);
  }, 120_000); // a whole crowd over MCP: about a second alone, much longer on a loaded machine

  it("keeps it moving while a visitor's there: likes, answers, texts back and plays its side of their date", async () => {
    const { agents } = await seedCrowd(transport, { agents: 3, secondDates: 0 });
    const v = await visitor();
    const mine = (await call("create_character", validCharacter({ name: "Vera Atlas", extras: profile, open_to_dates: true }), v)).structuredContent.character.id;

    // A round: most of the crowd likes the visitor's character (about seven in ten; all six passing is a 1-in-1,400 chance),
    // so a like back is a match at once.
    const first = await crowdRound(agents);
    expect(first.likes).toBeGreaterThan(0);
    const likers = (await t.db.query<{ swiper: string }>(`select swiper from swipes where target = $1 and liked`, [mine])).rows.map((r) => r.swiper);
    const odile = agents.flatMap((a) => a.chars).find((c) => likers.includes(c.id))!;
    const liked = (await call("swipe", { character_id: mine, target_id: odile.id, like: true }, v)).structuredContent;
    expect(liked.matched).toBe(true);

    // A beat later it says yes and opens the thread; the visitor answers, and it texts back the round after.
    await crowdRound(agents);
    await crowdRound(agents);
    const match = (await call("my_matches", { character_id: mine }, v)).structuredContent.matches.find((m: Any) => m.with.id === odile.id);
    expect(match.them).toBe(true);
    const opened = (await call("read_texts", { character_id: mine, with: odile.id }, v)).structuredContent.items.filter((i: Any) => i.text);
    expect(opened.map((i: Any) => i.from)).toEqual(["them"]);
    await call("send_text", { character_id: mine, to: odile.id, text: "Ha! Want to go out for a drink tomorrow?" }, v);
    await crowdRound(agents);
    await crowdRound(agents);
    const thread = (await call("read_texts", { character_id: mine, with: odile.id }, v)).structuredContent.items.filter((i: Any) => i.text);
    expect(thread.map((i: Any) => i.from)).toEqual(["them", "this_character", "them"]);
    expect(thread[2].text).toMatch(/pick the place|say yes|free tonight/);

    // The visitor books a two-agent date; the crowd plays its turns as they come.
    await call("answer_match", { character_id: mine, with: odile.id, yes: true }, v);
    const started = (await call("start_own_date", { character_id: mine, partner_id: odile.id }, v)).structuredContent.step;
    const line = { dialogue: "Hello. I nearly brought a map, which tells you everything.", action: "smiles", emotion: "nervous", interest_signal: 0.6 };
    await call("submit_own_date_step", { episode_id: started.episode_id, output: line }, v);
    await crowdRound(agents);
    const lines = (await t.db.query<{ n: number }>(`select jsonb_array_length(transcript)::int as n from episodes where id = $1`, [started.episode_id])).rows[0].n;
    expect(lines).toBe(2);
    expect(modelCalls).toBe(0);
  }, 120_000);

  it("never quotes a logistics line as a recap's best_line (the server refuses it, and a round used to throw: ~15% flaky)", () => {
    const said = [{ text: "Hi." }, { text: "Same time next week?" }, { text: "Thursday at seven, then." }, { text: "You laugh like a kettle." }, { text: "Bye." }];
    expect(isLogisticsLine("Same time next week?")).toBe(true);
    const picks = bestLineCandidates(said);
    expect(picks).not.toContain("Same time next week?");
    expect(picks).not.toContain("Thursday at seven, then.");
    expect(picks[0]).toBe("You laugh like a kettle.");
  });

  it("never repeats a text in a thread, and stops when it runs out", () => {
    const me = { sheet: { name: "Test Person" }, lines: [], texts: ["Hi {them}.", "One more thing."] };
    const thread: { from: string; text: string }[] = [];
    const sent = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const text = scriptedText(me, { them: "Vera Atlas", thread });
      if (!text) break;
      expect(sent.has(text)).toBe(false);
      sent.add(text);
      thread.push({ from: "this_character", text }, { from: "them", text: `reply ${i}` });
    }
    expect([...sent][0]).toBe("Hi Vera.");
    expect(sent.size).toBeLessThan(20);
  });

  it("never opens a later date with its first date's line", () => {
    const me = CROWD[0].characters[0];
    const step = { episode_id: "e3", turn: 0, of: 12, act_index: 0, ending: "second_date" };
    const first = scriptedTurn(step, me, { them: "Feodor Plaskett" }).dialogue;
    expect(first).toBe(me.lines[0]);
    const third = scriptedTurn({ ...step, episode_id: "e9" }, me, { them: "Vera Atlas", said: [first] }).dialogue;
    expect(nearDuplicate(third, first)).toBe(false);
  });
});

/* -------------------------- the brain: a free local model through LiteLLM, or the script -------------------------- */

// A fake LiteLLM (an OpenAI-compatible HTTP stub on 127.0.0.1) so nothing real is called. `reply` decides each answer.
type Reply = { status?: number; content?: string; headers?: Record<string, string> };
const LOCAL_HEADERS = { "x-litellm-model-name": "ollama_chat/qwen2.5:7b", "x-litellm-model-api-base": "http://host.docker.internal:11434", "x-litellm-attempted-fallbacks": "0" };
let server: Server;
let base = "";
let requests: Any[] = [];
let reply: (body: Any, n: number) => Reply = () => ({ content: "Hello there, nice to meet you." });
const readBody = (req: IncomingMessage) => new Promise<string>((r) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => r(s)); });
const KEY = ["fake", "litellm", "key"].join("-");
const CONFIG = [
  "model_list:",
  "  - model_name: local-chat",
  "    litellm_params:",
  "      model: ollama_chat/qwen2.5:7b",
  "      api_base: http://host.docker.internal:11434",
  "  - model_name: local-coder",
  "    litellm_params:",
  "      model: ollama_chat/qwen2.5:7b-coding",
  "      api_base: http://host.docker.internal:11434",
  "  - model_name: cloud-smart",
  "    litellm_params:",
  "      model: anthropic/claude-sonnet-4-6",
  "      api_key: os.environ/ANTHROPIC_API_KEY",
  "  - model_name: ollama-cloud",
  "    litellm_params:",
  "      model: ollama_chat/gpt-oss:120b-cloud",
  "      api_base: http://localhost:11434",
  "  - model_name: remote-ollama",
  "    litellm_params:",
  "      model: ollama_chat/qwen2.5:7b",
  "      api_base: https://ollama.example.com",
  "router_settings:",
  "  fallbacks:",
  '    - local-coder: ["cloud-smart"]',
].join("\n");
// Distinct small talk for every other request (no two alike, so the repeat guard lets each through).
const SMALL_TALK = [
  "Just got back from the night market and my hands smell of oranges.",
  "The kettle broke this morning, so I'm running on pure stubbornness.",
  "Spent the afternoon untangling fairy lights for a stranger's wedding.",
  "There's a fox outside my window judging my life choices.",
  "I burned toast twice today, which might be a personal record.",
  "Found a postcard from 1974 inside a secondhand coat pocket.",
  "My neighbour taught me a card trick and now I can't stop doing it.",
  "Rode the last bus home and the driver was singing opera.",
  "Bought a fern on impulse and named it Gerald.",
  "Somebody left a piano on the street corner and I played chopsticks on it.",
  "The bakery gave me a free bun because it was a bit squashed.",
  "Watched two seagulls fight over a chip for ten whole minutes.",
];
const smallTalk = (n: number) => SMALL_TALK[(n - 1) % SMALL_TALK.length];
const lastSaid = (body: Any): string => String(body.messages.at(-1)?.content ?? "");
const brainOn = (o: Partial<Parameters<typeof createBrain>[0]> = {}) =>
  createBrain({ baseUrl: `${base}/v1`, key: KEY, configText: CONFIG, warm: false, probeMs: 500, timeoutMs: 2_000, ...o });

describe("the crowd's brain", () => {
  beforeAll(async () => {
    server = createServer(async (req, res) => {
      if (req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id: "local-chat" }, { id: "local-coder" }] }));
        return;
      }
      if (req.url?.startsWith("/v1/hang")) return; // never answers
      const body = JSON.parse(await readBody(req));
      requests.push(body);
      const r = reply(body, requests.length);
      res.writeHead(r.status ?? 200, { "content-type": "application/json", ...LOCAL_HEADERS, ...(r.headers ?? {}) });
      res.end(JSON.stringify({ model: body.model, choices: [{ message: { role: "assistant", content: r.content ?? "" } }] }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  beforeEach(() => {
    requests = [];
    reply = () => ({ content: "Hello there, nice to meet you." });
  });

  /** A crowd character matched with a visitor's, the thread opened: what the reply tests start from. */
  async function matched(brain: CrowdBrain) {
    const { agents } = await seedCrowd(transport, { agents: 3, secondDates: 0 });
    const v = await visitor();
    const mine = (await call("create_character", validCharacter({ name: "Vera Atlas", extras: profile, open_to_dates: true }), v)).structuredContent.character.id;
    await crowdRound(agents);
    const likers = (await t.db.query<{ swiper: string }>(`select swiper from swipes where target = $1 and liked`, [mine])).rows.map((r) => r.swiper);
    const them = agents.flatMap((a) => a.chars).find((c) => likers.includes(c.id))!;
    await call("swipe", { character_id: mine, target_id: them.id, like: true }, v);
    for (const a of agents) a.brain = brain; // from here on the crowd talks through the brain
    await crowdRound(agents);
    await crowdRound(agents);
    const texts = async () => ((await call("read_texts", { character_id: mine, with: them.id }, v)).structuredContent.items as Any[]).filter((i) => i.text);
    return { agents, v, mine, them, texts };
  }

  it("labels: every crowd agent connects under the house-run prefix, with its own name", () => {
    expect(CROWD.every((d) => d.client.startsWith("botchelor-loop-crowd-") && d.name.length > 0)).toBe(true);
    expect(new Set(CROWD.map((d) => d.client)).size).toBe(CROWD.length);
  });

  it("answers what was actually said, from the last messages of that thread, in character", async () => {
    reply = (body, n) =>
      lastSaid(body).includes("teapot")
        ? { content: "Vera: A fossil shaped like a teapot? Bring it next time, I want to see it under good light. 😄" }
        : { content: smallTalk(n) };
    const brain = await brainOn();
    expect(brain.enabled).toBe(true);
    const { v, mine, them, agents, texts } = await matched(brain);
    expect((await texts()).map((i) => i.from)).toEqual(["them"]); // its opener, from the model
    await call("send_text", { character_id: mine, to: them.id, text: "I found a fossil shaped like a teapot on the beach today." }, v);
    await crowdRound(agents);
    await crowdRound(agents);
    const thread = await texts();
    expect(thread.map((i) => i.from)).toEqual(["them", "this_character", "them"]);
    // Cleaned (no name prefix, no emoji), and it's the model's answer to the teapot.
    expect(thread[2].text).toBe("A fossil shaped like a teapot? Bring it next time, I want to see it under good light.");
    const asked = requests.find((b) => lastSaid(b).includes("teapot"))!;
    expect(asked.model).toBe("local-chat");
    expect(asked.disable_fallbacks).toBe(true);
    const [system, user] = asked.messages;
    const who = agents.flatMap((a) => a.chars).find((c) => c.id === them.id)!;
    expect(system.content).toContain(who.entry.sheet.name);
    expect(system.content).toContain(String(who.entry.sheet.voice));
    expect(system.content).toContain("Vera Atlas");
    expect(system.content).toMatch(/Don't quote Vera's dating profile back/);
    expect(system.content).toContain("Never repeat yourself. You've already said: ");
    expect(system.content).toContain(`"${thread[0].text}"`);
    expect(user.content).toContain(`${who.name}: ${thread[0].text}\nVera Atlas: I found a fossil shaped like a teapot on the beach today.`);
    // Every crowd reply in the meantime (to the visitor and to each other) came from the model.
    expect(brain.summary()).toMatchObject({ model: "local-chat", fallback_replies: 0, reason_if_fallback: null });
    expect(brain.summary().model_replies).toBeGreaterThanOrEqual(2);
    expect(modelCalls).toBe(0); // and never the show's model
  }, 120_000);

  it("never quotes the partner's profile prompts back (their profile isn't even in the prompt)", async () => {
    let echoed = 0;
    reply = (body, n) => {
      if (!lastSaid(body).includes("teapot")) return { content: smallTalk(n) };
      return echoed++ === 0 ? { content: "Rain on a tin roof is the best sound, you said so yourself." } : { content: "Bring the teapot fossil to the arch and I'll light it properly." };
    };
    const brain = await brainOn();
    const { v, mine, them, agents, texts } = await matched(brain);
    await call("send_text", { character_id: mine, to: them.id, text: "I found a fossil shaped like a teapot on the beach today." }, v);
    await crowdRound(agents);
    await crowdRound(agents);
    const thread = await texts();
    expect(thread.at(-1).text).toBe("Bring the teapot fossil to the arch and I'll light it properly.");
    expect(thread.some((i) => /tin roof/i.test(i.text))).toBe(false);
    expect(requests.some((b) => JSON.stringify(b.messages).includes("Rain on a tin roof"))).toBe(false);
    // The retry told the model why.
    expect(requests.some((b) => b.messages[0].content.includes("Your last try was refused (echoed the partner's profile)"))).toBe(true);
    expect(echoesProfile("A thermos of tea and what the sea did last night", ["My thermos, and what the sea did last night."])).toBeTruthy();
    expect(echoesProfile("I love a quiet night in with tea", ["Old maps."], "")).toBeNull();
    // A word they actually said in the thread may come back: that's answering, not echoing.
    expect(echoesProfile("Tell me about the thermos", ["My thermos."], "I brought my thermos")).toBeNull();
  }, 120_000);

  it("guards against repeats: never the same line twice, or nearly, from one character", async () => {
    expect(nearDuplicate("I'll tell you, but you have to promise not to use it against me.", "Ha. I'll tell you, but you have to promise not to use it against me!")).toBe(true);
    expect(nearDuplicate("So, Vera, are you a window seat person?", "So, Feodor, are you a window seat person?")).toBe(true);
    expect(nearDuplicate("Warm white or cool white?", "What's your bread order?")).toBe(false);
    reply = () => ({ content: "I fixed a sign today, and it hummed!" });
    const brain = await brainOn();
    const me = { id: "c1", name: "Odile Brannock", entry: CROWD[0].characters[0] };
    const agent = { brain, said: new Map([["c1", ["I fixed a sign today and it hummed."]]]), def: CROWD[0] } as unknown as CrowdAgent;
    const sent: string[] = [];
    const out = await speak(agent, {
      kind: "text",
      me,
      partner: { name: "Vera Atlas", profile: [] },
      history: [{ name: "Vera Atlas", text: "What did you do today?" }],
      send: async (line) => (sent.push(line), { ok: true, result: line }),
      fallback: () => "Warm white or cool white? Important question.",
    });
    expect(requests).toHaveLength(2); // one try and one retry
    expect(out).toBe("Warm white or cool white? Important question.");
    expect(sent).toEqual(["Warm white or cool white? Important question."]);
    expect(agent.said.get("c1")).toHaveLength(2);
    expect(brain.summary()).toMatchObject({ model: "local-chat", model_replies: 0, fallback_replies: 1, reason_if_fallback: "repeat of its own line" });
  });

  it("falls back to the script when the model fails, and counts every path with its reason", async () => {
    reply = () => ({ status: 500, content: "" });
    const brain = await brainOn();
    const me = { id: "c1", name: "Odile Brannock", entry: CROWD[0].characters[0] };
    const agent = { brain, said: new Map(), def: CROWD[0] } as unknown as CrowdAgent;
    const say = (n: number) =>
      speak(agent, { kind: "text", me, partner: { name: "Vera Atlas" }, send: async (line) => ({ ok: true, result: line }), fallback: () => `Scripted line number ${n}.` });
    expect(await say(1)).toBe("Scripted line number 1.");
    expect(brain.summary()).toMatchObject({ model: "local-chat", model_replies: 0, fallback_replies: 1, reason_if_fallback: "model error" });
    // Three failures in a row: the brain switches itself off and the rest of the run is scripted, without calling it.
    expect(await say(2)).toBe("Scripted line number 2.");
    const calls = requests.length;
    expect(await say(3)).toBe("Scripted line number 3.");
    expect(requests.length).toBe(calls);
    expect(brain.summary()).toMatchObject({ model: null, model_was: "local-chat", model_replies: 0, fallback_replies: 3, reason_if_fallback: "LiteLLM keeps failing (HTTP 500)" });

    // LOOP_STUB=1, or LiteLLM not there within the probe: scripted for the whole run, and crowd_brain says so.
    expect((await brainFromEnv({ LOOP_STUB: "1" })).summary()).toEqual({ model: null, model_replies: 0, fallback_replies: 0, reason_if_fallback: "LOOP_STUB=1", fallback_reasons: {} });
    const hanging = await brainOn({ baseUrl: `${base}/v1/hang`, probeMs: 200 });
    expect(hanging.enabled).toBe(false);
    expect(hanging.summary().reason_if_fallback).toMatch(/^LiteLLM unreachable at startup/);
    const closed = await brainOn({ baseUrl: "http://127.0.0.1:9/v1" });
    expect(closed.summary().reason_if_fallback).toMatch(/^LiteLLM unreachable at startup/);
  });

  it("refuses an alias that isn't local Ollama, or that has fallbacks, and any reply from a non-local deployment", async () => {
    expect(checkLocalAlias(CONFIG, "local-chat")).toMatchObject({ ok: true });
    expect(checkLocalAlias(CONFIG, "local-coder").reason).toMatch(/fallbacks/);
    expect(checkLocalAlias(CONFIG, "cloud-smart").reason).toMatch(/not a local Ollama model/);
    expect(checkLocalAlias(CONFIG, "ollama-cloud").reason).toMatch(/cloud model/);
    expect(checkLocalAlias(CONFIG, "remote-ollama").reason).toMatch(/not this Mac/);
    expect(checkLocalAlias(CONFIG, "free-agent").reason).toMatch(/isn't in the LiteLLM config/);
    expect(checkLocalAlias(`${CONFIG}\n  default_fallbacks: ["cloud-smart"]`, "local-chat").reason).toMatch(/default_fallbacks/);

    const refused = await brainOn({ model: "local-coder" });
    expect(refused.enabled).toBe(false);
    expect(refused.summary()).toMatchObject({ model: null, reason_if_fallback: expect.stringMatching(/^alias refused: local-coder has fallbacks/) });
    expect((await brainOn({ baseUrl: "https://litellm.example.com/v1" })).summary().reason_if_fallback).toMatch(/isn't this Mac/);
    expect(requests).toHaveLength(0);

    // A response that came from a cloud deployment (or after a fallback) switches the brain off for the run.
    reply = () => ({ content: "Hello from far away.", headers: { "x-litellm-model-name": "anthropic/claude-sonnet-4-6", "x-litellm-model-api-base": "https://api.anthropic.com" } });
    const brain = await brainOn();
    await expect(brain.complete([{ role: "user", content: "hi" }])).rejects.toMatchObject({ reason: "non-local deployment refused" });
    expect(brain.enabled).toBe(false);
    expect(brain.summary().reason_if_fallback).toMatch(/non-local deployment/);
  });

  it("keeps a date's own record from its steps' last lines, and cleans model replies", () => {
    const lines = [{ name: "Odile Brannock", text: "Hello." }];
    mergeLastLines(lines, ["Odile Brannock: Hello. (smiles)", "Vera Atlas: Hi! What's that hum? (leans in)"]);
    mergeLastLines(lines, ["Vera Atlas: Hi! What's that hum? (leans in)", "Odile Brannock: The sign. It's old."]);
    expect(lines.map((l) => l.text)).toEqual(["Hello.", "Hi! What's that hum?", "The sign. It's old."]);
    expect(cleanReply("<think>plan</think>\n**Odile:** \"*laughs* It's the argon. Honestly. You'd love it. Truly. More.\"", { name: "Odile Brannock" })).toBe(
      "It's the argon. Honestly. You'd love it.",
    );
  });
});
